"""Provider matching is separate from extraction and graph construction."""
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urlencode, urlparse
from pydantic import BaseModel, Field
from app.services.http import fetch

KITSU = 'https://kitsu.app/api/edge'

class Episode(BaseModel):
    unit: int = Field(ge=1)
    number: int = Field(ge=0)
    title: str
    description: str | None
    provider: Literal['kitsu', 'tvmaze']
    source_url: str
    provider_id: str

class Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
    def handle_data(self, data: str) -> None:
        self.parts.append(data)
    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in ('p', 'br', 'div'): self.parts.append(' ')
    def handle_endtag(self, tag: str) -> None:
        if tag in ('p', 'div'): self.parts.append(' ')

def plain(text: str | None) -> str | None:
    if not text: return None
    parser = Text(); parser.feed(text)
    return ' '.join(''.join(parser.parts).split()) or None

def pages(url: str) -> list[dict]:
    rows: dict[str, dict] = {}; seen = set()
    for _ in range(10):
        if url in seen or urlparse(url).hostname != 'kitsu.app' or urlparse(url).scheme != 'https':
            raise ValueError('Invalid Kitsu pagination')
        seen.add(url)
        page = fetch(url, provider='kitsu', headers={'Accept':'application/vnd.api+json'})
        if not isinstance(page.get('data'), list): raise ValueError('Invalid Kitsu listing')
        rows.update({r['id']:r for r in page['data']})
        url = page.get('links', {}).get('next')
        if not url: return list(rows.values())
    raise ValueError('Kitsu pagination limit reached')

def mapping(anime_id: str) -> dict[str, str]:
    return {r['attributes']['externalSite']: r['attributes']['externalId']
            for r in pages(f'{KITSU}/anime/{anime_id}/mappings?page%5Blimit%5D=20')}

def resolve_kitsu(entry: dict) -> tuple[str, dict[str, str]]:
    title = entry['title']['romaji'] or entry['title']['english']
    candidates = pages(KITSU + '/anime?' + urlencode({'filter[text]':title, 'page[limit]':20}))
    matches = []
    expected_subtype = {'TV':'TV', 'MOVIE':'movie', 'OVA':'OVA', 'ONA':'ONA', 'SPECIAL':'special'}.get(entry['format'])
    for candidate in candidates:
        a = candidate['attributes']
        if a.get('subtype') != expected_subtype or not (a.get('startDate') or '').startswith(str(entry['startDate']['year'])):
            continue
        ids = mapping(candidate['id'])
        expected = {'anilist/anime':str(entry['id'])}
        if entry.get('idMal'): expected['myanimelist/anime'] = str(entry['idMal'])
        if any(ids[k] != v for k,v in expected.items() if k in ids): continue
        if any(ids.get(k) == v for k,v in expected.items()): matches.append((candidate['id'], ids))
    if len(matches) != 1: raise ValueError('No unique ID-matched Kitsu adaptation')
    return matches[0]

def tvmaze_episodes(ids: dict[str,str]) -> list[dict]:
    # No title-only fallback: an unverified season is worse than missing text.
    tvdb = ids.get('thetvdb/series'); hint = ids.get('thetvdb', '').split('/')
    if not tvdb or len(hint) != 2 or hint[0] != tvdb or not hint[1].isdigit(): return []
    show = fetch('https://api.tvmaze.com/lookup/shows?' + urlencode({'thetvdb':tvdb}), provider='tvmaze')
    if str(show['externals'].get('thetvdb')) != tvdb or show.get('type') != 'Animation':
        raise ValueError('TVmaze adaptation mismatch')
    rows = fetch(f"https://api.tvmaze.com/shows/{show['id']}/episodes?specials=1", provider='tvmaze')
    return [e for e in rows if e['season'] == int(hint[1])]

def normalize(rows: list[dict], cap: int, *, prologue: bool = False) -> list[Episode]:
    numbers = [r['attributes']['number'] for r in rows]
    if len(numbers) != len(set(numbers)): raise ValueError('Duplicate provider episode numbers')
    selected = sorted(rows, key=lambda r:r['attributes']['number'])[:cap]
    result = []
    for row in selected:
        a = row['attributes']; number = a['number']
        if type(number) is not int or number < 1: raise ValueError('Invalid provider episode number')
        result.append(Episode(unit=number + int(prologue), number=number,
            title=a.get('canonicalTitle') or f'Episode {number}', description=plain(a.get('description') or a.get('synopsis')),
            provider='kitsu', source_url=f"{KITSU}/episodes/{row['id']}", provider_id=row['id']))
    return result

def get_episodes(entry: dict, cap: int) -> list[Episode]:
    kitsu, ids = resolve_kitsu(entry)
    prologue = entry['id'] == 19603
    rows = pages(f'{KITSU}/anime/{kitsu}/episodes?page%5Blimit%5D=20')
    episodes = normalize(rows, cap - int(prologue), prologue=prologue)
    if prologue:
        # Catalog numbering exception, not story seed data. Verify the special mapping.
        pm = mapping('9718')
        if pm.get('myanimelist/anime') != '27821': raise ValueError('UBW prologue mapping changed')
        special = pages(f'{KITSU}/anime/9718/episodes?page%5Blimit%5D=20')
        if len(special) != 1 or special[0]['attributes']['number'] != 1: raise ValueError('Prologue episode mismatch')
        a = special[0]['attributes']
        episodes.insert(0, Episode(unit=1, number=0, title='Prologue', description=plain(a.get('description') or a.get('synopsis')),
                                  provider='kitsu', source_url=f"{KITSU}/episodes/{special[0]['id']}", provider_id=special[0]['id']))
    if any(not e.description for e in episodes):
        try:
            fallback = tvmaze_episodes(ids)
            for ep in episodes:
                if ep.description: continue
                candidates = [r for r in fallback if (r['number'] == ep.number if ep.number else
                    r['number'] is None and r['name'].casefold() == 'fate/stay night: unlimited blade works - prologue')]
                if len(candidates) == 1 and candidates[0].get('summary'):
                    row = candidates[0]
                    ep.description = plain(row['summary']); ep.provider = 'tvmaze'
                    ep.source_url = f"https://api.tvmaze.com/episodes/{row['id']}"; ep.provider_id = str(row['id'])
        except ValueError:
            pass  # Primary data remains useful when the optional fallback is unavailable.
    return episodes
