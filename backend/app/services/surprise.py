"""'Surprise me': a random pre-cached story that already shows a graph at episode 1.

Only titles listed in data/surprise_picks.json whose curated graph is in generated_graphs are eligible.
Nothing here calls AniList or Hugging Face. The episode-1 filtering goes through graph.filter_graph.
"""
import json
import random
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple
import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from app.database import connection
from app.schemas import Media, RevealPoint, SurprisePick
from app.services import demo, generation
from app.services.graph import filter_graph

PICKS = Path(__file__).resolve().parents[1] / 'data/surprise_picks.json'
START_PROGRESS = 1
MIN_CHARACTERS = 2
CACHE_SECONDS = 300
FALLBACK_HOOK = 'A cartographer, a boat builder and a missing harbor light: a gentle three-episode mystery.'


class Pick(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    media_id: str = Field(pattern=r'^anilist-\d+$')
    hook: str = Field(min_length=1, max_length=120)
    tags: list[str] = Field(min_length=1, max_length=3)


class PickFile(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    picks: list[Pick] = Field(min_length=1)


class Candidate(NamedTuple):
    pick: Pick
    media: Media
    characters: int


def load_picks(path: Path = PICKS) -> list[Pick]:
    picks = PickFile.model_validate(json.loads(path.read_text())).picks
    ids = [pick.media_id for pick in picks]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate surprise pick')
    return picks


@lru_cache
def _picks() -> tuple[Pick, ...]:
    return tuple(load_picks())


_cache: tuple[float, list[Candidate]] | None = None
_lock = threading.Lock()


def candidates() -> list[Candidate]:
    """Eligible picks, cached briefly. Raises RuntimeError/psycopg.Error if the database is unavailable."""
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < CACHE_SECONDS:
            return _cache[1]
    by_id = {pick.media_id: pick for pick in _picks()}
    with connection() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute('SELECT media_id,media,document FROM public.generated_graphs WHERE media_id=ANY(%s) ORDER BY media_id',
                                  (list(by_id),)).fetchall()
    found = []
    for row in rows:
        try:
            media = Media.model_validate(row['media'])
            entities, edges = generation.graph_data(row['document'])
            start = min(START_PROGRESS, media.total_units)
            visible = filter_graph(row['media_id'], RevealPoint(unit=start), entities, edges).entities
        except (ValidationError, KeyError, TypeError, ValueError):
            continue  # a malformed cache row is skipped, never surfaced
        if len(visible) >= MIN_CHARACTERS:
            found.append(Candidate(by_id[row['media_id']], media, len(visible)))
    with _lock:
        if found:
            _cache = (time.monotonic(), found)
    return found


def reset_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def fallback() -> SurprisePick:
    visible = filter_graph(demo.MEDIA.id, RevealPoint(unit=START_PROGRESS), demo.ENTITIES, demo.RELATIONSHIPS).entities
    return SurprisePick(media=demo.MEDIA.model_copy(update={'description': ''}), start_progress=START_PROGRESS,
                        hook=FALLBACK_HOOK, tags=['mystery'], characters_at_start=len(visible), pool_size=1)


def pick(exclude: str | None = None) -> SurprisePick:
    try:
        pool = candidates()
    except (RuntimeError, psycopg.Error):
        return fallback()
    if not pool:
        return fallback()
    options = [item for item in pool if item.pick.media_id != exclude] or pool
    chosen = random.choice(options)
    # Synopsis text can spoil, so it never leaves this endpoint.
    return SurprisePick(media=chosen.media.model_copy(update={'description': ''}),
                        start_progress=min(START_PROGRESS, chosen.media.total_units), hook=chosen.pick.hook,
                        tags=chosen.pick.tags, characters_at_start=chosen.characters, pool_size=len(pool))
