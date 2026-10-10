"""Standalone source-only UBW extraction experiment; no production integration."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time
from typing import Literal
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from app.config import settings
from scripts.jikan_feasibility import Client, resolve, utc_now
from scripts.episode_provider_feasibility import KITSU, JSON_API, body, kitsu_pages, match_kitsu, match_tvmaze, plain_text, KitsuEpisode

MODEL = 'Qwen/Qwen3-4B-Instruct-2507:nscale'
ROUTER = 'https://router.huggingface.co/v1/chat/completions'
class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
class Entity(Strict):
    name: str = Field(min_length=1, max_length=60)
    kind: Literal['character', 'faction']
    description: str = Field(min_length=1, max_length=180)
    evidence: str = Field(min_length=1)
    @field_validator('description')
    @classmethod
    def concise(cls, value: str) -> str:
        if len(value.split()) > 25 or re.search(r'[.!?]\s+\S', value):
            raise ValueError('Description must be one short sentence')
        return value
class Relationship(Strict):
    source: str
    target: str
    type: Literal['rescues', 'attacks', 'accompanies', 'informs', 'truce', 'hosts', 'commands', 'other']
    label: str = Field(min_length=1, max_length=40)
    evidence: str = Field(min_length=1)
    @field_validator('label')
    @classmethod
    def short(cls, value: str) -> str:
        if len(value.split()) > 5:
            raise ValueError('Label exceeds five words')
        return value
class Extraction(Strict):
    episode_key: str
    entities: list[Entity]
    relationships: list[Relationship]

PROMPT = '''Extract only explicit named characters/factions and interactions in the supplied description.
Never use prior anime knowledge, resolve unnamed people, expand names, or fill gaps.
A class list is not proof that each named class appears as a character. Do not invent factions.
Descriptions: one short sentence, at most 25 words. Labels: at most five words.
Evidence: exact contiguous substring of source sufficient to support the assertion.
Preserve direction, pronouns, uncertainty and chronology. A truce is temporary, not friendship.
If both named endpoints cannot be grounded, omit the relationship. Empty lists are acceptable.
Return required JSON, copying episode_key exactly. No reveal timing claims.'''

def validate_output(raw: str, text: str, key: str) -> dict:
    """Lexical rejection gate; semantic entailment and safety still require review."""
    parsed = Extraction.model_validate_json(raw)
    if parsed.episode_key != key:
        raise ValueError('Wrong episode identifier')
    entities, relationships, rejected = [], [], []
    for e in parsed.entities:
        if not re.search(r'(?<!\w)' + re.escape(e.name) + r'(?!\w)', text) or e.evidence not in text or e.name not in e.evidence:
            rejected.append({'kind': 'entity', 'candidate': e.model_dump(), 'reason': 'Name or evidence absent from source'})
        else:
            entities.append(e.model_dump())
    names = {e['name'] for e in entities}
    for e in parsed.relationships:
        if e.source == e.target or not {e.source, e.target} <= names or e.evidence not in text:
            rejected.append({'kind': 'relationship', 'candidate': e.model_dump(), 'reason': 'Invalid endpoint or evidence'})
        else:
            relationships.append(e.model_dump())
    return {'entities': entities, 'relationships': relationships, 'rejected': rejected,
            'review_status': 'pending_semantic_review', 'verified': False, 'confirmed_spoiler_safe_reveal': None}

def infer(text: str, key: str, model: str = MODEL) -> dict:
    payload = {'model': model, 'temperature': 0, 'max_tokens': 2000,
        'messages': [{'role': 'system', 'content': PROMPT}, {'role': 'user', 'content': json.dumps({'episode_key': key, 'description': text})}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'episode_extraction', 'strict': True, 'schema': Extraction.model_json_schema()}}}
    req = Request(ROUTER, data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + settings.hf_token, 'Content-Type': 'application/json'})
    started = time.monotonic()
    # No automatic paid retries: a timed-out request might already have completed.
    with urlopen(req, timeout=60) as response:
        result = json.load(response)
    return {'latency_seconds': round(time.monotonic() - started, 3), 'response': result}

def sources(client: Client) -> tuple[dict, list[dict]]:
    entry = resolve(client, 'Fate/stay night: Unlimited Blade Works', 2014, 'TV')
    anime, mappings = match_kitsu(client, entry)
    show, season, bridge = match_tvmaze(client, entry, mappings)
    search = kitsu_pages(client, KITSU + '/anime?filter%5Btext%5D=Fate%2Fstay%20night%3A%20Unlimited%20Blade%20Works&page%5Blimit%5D=20')
    matches = [r for r in search if r['attributes'].get('canonicalTitle') == 'Fate/stay night: Unlimited Blade Works - Prologue' and r['attributes'].get('startDate') == '2014-10-05'
               and r['attributes'].get('subtype') == 'special' and r['attributes'].get('episodeCount') == 1]
    if len(matches) != 1:
        raise ValueError('Ambiguous prologue adaptation')
    prologue = matches[0]
    pm = kitsu_pages(client, f"{KITSU}/anime/{prologue['id']}/mappings?page%5Blimit%5D=20")
    mal = [m['attributes']['externalId'] for m in pm if m['attributes']['externalSite'] == 'myanimelist/anime']
    if len(mal) != 1:
        raise ValueError('Missing unique prologue MAL mapping')
    response = client.fetch('https://graphql.anilist.co', {'query': 'query($id:Int){Media(idMal:$id,type:ANIME){id idMal title{romaji} format startDate{year}}}', 'variables': {'id': int(mal[0])}})
    # Record the separate-MAL lookup outcome without inventing an AniList ID.
    if response['status'] == 404:
        verified = None
    else:
        payload = body(response)
        if payload.get('errors') or payload['data']['Media']['idMal'] != int(mal[0]):
            raise ValueError('Prologue AniList mapping conflict')
        verified = payload['data']['Media']
    rows = []
    for work, numbers in [(prologue, [1]), (anime, [1, 2, 3, 4, 5])]:
        listing = kitsu_pages(client, f"{KITSU}/anime/{work['id']}/episodes?page%5Blimit%5D=20")
        for number in numbers:
            matches = [r for r in listing if r['attributes']['number'] == number]
            if len(matches) != 1:
                raise ValueError('Missing or duplicate episode number')
            episode = matches[0]
            url = f"{KITSU}/episodes/{episode['id']}?include=media"
            detail = body(client.fetch(url, accept=JSON_API))['data']
            attrs = KitsuEpisode.model_validate(detail['attributes'])
            if detail['id'] != episode['id'] or attrs.number != number or detail['relationships']['media']['data']['id'] != work['id']:
                raise ValueError('Episode ID, number or adaptation mismatch')
            text = plain_text(attrs.description or attrs.synopsis)
            metadata = {'episode_key': 'prologue' if work == prologue else f'episode-{number}', 'broadcast_episode': 0 if work == prologue else number,
                'story_unit': len(rows) + 1, 'kitsu_anime_id': work['id'], 'kitsu_episode_id': detail['id'], 'provider_episode_number': number,
                'title': attrs.canonicalTitle, 'source_url': url, 'provider': 'kitsu'}
            if not text and work == prologue:
                tv = body(client.fetch(f"https://api.tvmaze.com/shows/{show['id']}/episodes?specials=1"))
                candidates = [e for e in tv if e['season'] == season and e['number'] is None and e['name'].casefold() == 'fate/stay night: unlimited blade works - prologue' and e['airdate'] == '2014-10-04']
                if len(candidates) != 1:
                    raise ValueError('No unique TVmaze prologue')
                url = f"https://api.tvmaze.com/episodes/{candidates[0]['id']}"
                td = body(client.fetch(url))
                if td['id'] != candidates[0]['id'] or td['number'] is not None or td['season'] != season:
                    raise ValueError('TVmaze special mismatch')
                text = plain_text(td['summary'])
                metadata.update(provider='tvmaze', source_url=url, tvmaze_episode_id=td['id'], title=td['name'], kitsu_text_state='null')
            rows.append({'metadata': metadata, 'text': text})
    return {'anilist': entry, 'prologue_anilist': verified, 'prologue_anilist_lookup_status': response['status'], 'prologue_mapping_basis': 'Kitsu exact title + release date + unique MAL mapping; no separate AniList entry returned', 'prologue_mal_id': mal[0], 'tvmaze_id': show['id'], 'bridge': bridge}, rows

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--model', choices=[MODEL, 'Qwen/Qwen2.5-72B-Instruct:deepinfra'], default=MODEL)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error('Raw source/model output must stay outside repository')
    if not settings.hf_token:
        parser.error('HF_TOKEN is not configured')
    client = Client()
    result = {'started_at': utc_now(), 'model': args.model, 'prompt': PROMPT, 'episodes': []}
    failed = False
    try:
        result['identity'], rows = sources(client)
        for row in rows:
            if not row['text']:
                row.update(status='missing_source_text')
            else:
                row['source_sha256'] = hashlib.sha256(row['text'].encode()).hexdigest()
                row.update(infer(row['text'], row['metadata']['episode_key'], args.model))
                try:
                    choice = row['response']['choices'][0]
                    if choice['finish_reason'] != 'stop':
                        raise ValueError('Incomplete model response')
                    row['candidate'] = validate_output(choice['message']['content'], row['text'], row['metadata']['episode_key'])
                    for fact in row['candidate']['entities'] + row['candidate']['relationships']:
                        fact.update(first_supported_episode=row['metadata']['broadcast_episode'], first_supported_story_unit=row['metadata']['story_unit'],
                                    evidence_start=row['text'].index(fact['evidence']), evidence_end=row['text'].index(fact['evidence']) + len(fact['evidence']))
                    row['status'] = 'candidate_needs_review'
                except (ValidationError, ValueError, KeyError, IndexError, TypeError) as error:
                    row.update(status='rejected_output', error=str(error))
            result['episodes'].append(row)
            args.output.write_text(json.dumps(result, indent=2))
            print(row['metadata']['episode_key'], row['status'], flush=True)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
        failed = True
        result['failure'] = {'kind': type(error).__name__, 'http_status': getattr(error, 'code', None), 'message': str(error)}
        print('Experiment stopped:', type(error).__name__, flush=True)
    finally:
        result.update(finished_at=utc_now(), source_requests=client.requests)
        args.output.write_text(json.dumps(result, indent=2))
    if failed or any(row['status'] != 'candidate_needs_review' for row in result['episodes']):
        raise SystemExit(1)

if __name__ == '__main__':
    main()
