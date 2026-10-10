"""Typed, bounded source-researched replacements for existing graph caches."""
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from pydantic import BaseModel, ConfigDict, Field
from app.services import generation

DATA = Path(__file__).resolve().parents[1] / 'data/source_curated_graphs.json'
MODEL = 'source-curated/v1'


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Character(Strict):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=600)
    aliases: list[str] = Field(default_factory=list)


class Relation(Strict):
    source: str
    target: str
    type: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=80)


class Episode(Strict):
    unit: int = Field(ge=1)
    number: int = Field(ge=0)
    title: str
    source_url: str
    source_revision: int = Field(gt=0)
    source_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    characters: list[Character]
    relationships: list[Relation]


class Replacement(Strict):
    media_id: str = Field(pattern=r'^anilist-\d+$')
    episodes: list[Episode] = Field(min_length=1, max_length=6)

    def document(self) -> dict:
        known: set[str] = set()
        entries = []
        for unit, episode in enumerate(self.episodes, 1):
            offset = 1 if self.media_id == 'anilist-19603' else 0
            if episode.unit != unit or episode.number + offset != unit:
                raise ValueError('Episode order must use contiguous canonical story units')
            url = urlparse(episode.source_url)
            if (url.scheme != 'https' or url.netloc not in
                {'en.wikipedia.org', 'kusuriya.fandom.com', 'dragonball.fandom.com'} or
                parse_qs(url.query).get('oldid') != [str(episode.source_revision)]):
                raise ValueError('Source must identify an allowed HTTPS wiki revision')
            names = [c.name for c in episode.characters]
            if len(set(names)) != len(names):
                raise ValueError('Duplicate character snapshot')
            for character in episode.characters:
                if any(alias not in known for alias in character.aliases):
                    raise ValueError('Aliases must refer to previously introduced characters')
            known.update(names)
            seen = set()
            for edge in episode.relationships:
                if edge.source == edge.target or not {edge.source, edge.target} <= known:
                    raise ValueError('Relationship references a missing or future character')
                key = (edge.source, edge.target, edge.type)
                if key in seen:
                    raise ValueError('Duplicate relationship in an episode')
                seen.add(key)
            entries.append({
                'episode': episode.model_dump(exclude={'characters', 'relationships', 'source_hash'}),
                'model': MODEL, 'source_hash': episode.source_hash, 'status': 'done',
                'characters': [dict(c.model_dump(), evidence='Researched paraphrase: ' + c.description)
                               for c in episode.characters],
                'relationships': [dict(e.model_dump(), evidence=
                    f'Researched interaction: {e.source} → {e.target}: {e.label}')
                    for e in episode.relationships],
            })
        document = {'source_curated': True, 'verified': False, 'episodes': entries}
        generation.graph_data(document)
        return document


class Dataset(Strict):
    version: int
    review_method: str
    graphs: list[Replacement]
    clear_empty_media_ids: list[str]


def load(path: Path = DATA) -> Dataset:
    dataset = Dataset.model_validate(json.loads(path.read_text()))
    ids = [g.media_id for g in dataset.graphs] + dataset.clear_empty_media_ids
    if dataset.version != 1 or len(set(ids)) != len(ids):
        raise ValueError('Unsupported version or duplicate replacement target')
    for graph in dataset.graphs:
        graph.document()
    return dataset
