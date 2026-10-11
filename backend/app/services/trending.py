"""Trending constellations: each cached franchise's most-completed works, from aggregate counts only.

Reads cached franchise rows and user_progress; it never calls AniList or starts generation, and it never
returns user ids. A completion follows progress.py: `completed IS TRUE`, or `completed IS NULL` with
`completed_unit >= total_units` when the total is known. Users are counted once per work.
"""
import json
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import psycopg
from psycopg.rows import dict_row
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from app.config import settings
from app.database import connection
from app.schemas import Media, TrendingConstellation, TrendingConstellations, TrendingLink, TrendingStar
from app.services.library import release_order
from app.services.universe_search import universe_title

DEMO = Path(__file__).resolve().parents[1] / 'data/trending_demo.json'
WINDOW_DAYS = 30
MIN_STARS, MAX_STARS, MAX_LIMIT = 3, 8, 8
CACHE_SECONDS = 300


class DemoFile(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    note: str
    completions: dict[str, int]


def load_demo(path: Path = DEMO) -> dict[str, int]:
    data = DemoFile.model_validate(json.loads(path.read_text()))
    for media_id, count in data.completions.items():
        if not (media_id.startswith('anilist-') and media_id[8:].isdigit() and 1 <= count <= 1000):
            raise ValueError(f'Invalid demo completion entry: {media_id}')
    return data.completions


def is_completed(completed: bool | None, completed_unit: int, media: Media) -> bool:
    if completed is not None:
        return completed
    return media.total_units_known and completed_unit >= media.total_units


def count_completions(rows: list[tuple], media: dict[str, Media], since: datetime) -> dict[str, int]:
    """Distinct users per work whose row counts as completed and was updated since `since`."""
    users: dict[str, set[str]] = {}
    for user_id, media_id, completed, completed_unit, updated_at in rows:
        if media_id in media and updated_at >= since and is_completed(completed, completed_unit, media[media_id]):
            users.setdefault(media_id, set()).add(user_id)
    return {media_id: len(found) for media_id, found in users.items()}


def magnitudes(counts: list[int]) -> list[float]:
    low, high = min(counts), max(counts)
    return [1.0 if high == low else round(0.25 + 0.75 * (count - low) / (high - low), 4) for count in counts]


def normalise_links(relations: list[tuple], ids: set[str]) -> list[TrendingLink]:
    """One link per pair of chosen stars. PREQUEL is flipped to SEQUEL, reciprocals collapse, SEQUEL wins ties."""
    chosen: dict[frozenset, TrendingLink] = {}
    for source, target, kind in sorted(relations):
        kind = kind.strip().upper()
        if source == target or source not in ids or target not in ids:
            continue
        if kind == 'PREQUEL':
            source, target, kind = target, source, 'SEQUEL'
        elif kind != 'SEQUEL' and source > target:
            source, target = target, source
        pair = frozenset((source, target))
        if pair not in chosen or (kind == 'SEQUEL' and chosen[pair].type != 'SEQUEL'):
            chosen[pair] = TrendingLink(source=source, target=target, type=kind)
    return list(chosen.values())


def connect(stars: list[Media], links: list[TrendingLink]) -> list[TrendingLink]:
    """Add INFERRED links along release order until the constellation is one connected shape."""
    parent = {star.id: star.id for star in stars}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item
    for link in links:
        parent[find(link.source)] = find(link.target)
    ordered = sorted(stars, key=release_order)
    result = list(links)
    for before, after in zip(ordered, ordered[1:]):
        if find(before.id) != find(after.id):
            parent[find(before.id)] = find(after.id)
            result.append(TrendingLink(source=before.id, target=after.id, type='INFERRED'))
    return result


def compute(conn: psycopg.Connection, now: datetime, demo: dict[str, int] | None) -> TrendingConstellations:
    with conn.cursor(row_factory=dict_row) as cursor:
        members = cursor.execute('''SELECT f.id, f.display_name, m.media_id, m.media
            FROM public.franchises f JOIN public.franchise_media m ON m.franchise_id=f.id
            WHERE f.merged_into IS NULL AND (f.discovery->'strong_ids') ? m.media_id
              AND m.media->>'type'='anime'
            ORDER BY f.id, m.media_id''').fetchall()
    media: dict[str, Media] = {}
    franchises: dict[str, tuple[str, list[str]]] = {}
    for row in members:
        try:
            item = Media.model_validate(row['media'])
        except ValidationError:
            continue
        media.setdefault(item.id, item)
        title, ids = franchises.setdefault(row['id'], (universe_title(row['display_name']), []))
        if item.id not in ids:
            ids.append(item.id)
    since = now - timedelta(days=WINDOW_DAYS)
    rows = conn.execute('''SELECT user_id,media_id,completed,completed_unit,updated_at FROM public.user_progress
        WHERE media_id=ANY(%s) AND updated_at>=%s AND completed IS NOT FALSE''', (list(media), since)).fetchall() if media else []
    counts = count_completions(rows, media, since)
    if demo:
        for media_id, sample in demo.items():
            if media_id in media:  # only cached franchise members; anything else is ignored
                counts[media_id] = counts.get(media_id, 0) + sample
    chosen: dict[str, list[Media]] = {}
    for franchise_id, (_, ids) in franchises.items():
        ranked = sorted((media[i] for i in ids if counts.get(i)), key=lambda item: (-counts[item.id], release_order(item)))
        if len(ranked) >= MIN_STARS:
            chosen[franchise_id] = ranked[:MAX_STARS]
    star_ids = sorted({item.id for stars in chosen.values() for item in stars})
    relations = conn.execute('SELECT source,target,type FROM public.media_relations WHERE source=ANY(%s) AND target=ANY(%s)',
                             (star_ids, star_ids)).fetchall() if star_ids else []
    built = []
    for franchise_id, stars in chosen.items():
        ids = {item.id for item in stars}
        scale = magnitudes([counts[item.id] for item in stars])
        links = connect(stars, normalise_links([r for r in relations if r[0] in ids and r[1] in ids], ids))
        built.append(TrendingConstellation(
            franchise_id=franchise_id, title=franchises[franchise_id][0], entry_media_id=stars[0].id,
            score=sum(counts[item.id] for item in stars), links=links,
            stars=[TrendingStar(media_id=item.id, title=item.title, cover_url=item.cover_url, format=item.format,
                                year=item.release_date.year if item.release_date else None,
                                completions=counts[item.id], magnitude=magnitude) for item, magnitude in zip(stars, scale)]))
    built.sort(key=lambda c: (-c.score, c.title, c.franchise_id))
    return TrendingConstellations(window_days=WINDOW_DAYS, demo_signal=bool(demo), constellations=built[:MAX_LIMIT])


_cache: tuple[float, bool, TrendingConstellations] | None = None
_lock = threading.Lock()


def reset_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def constellations(limit: int = 5) -> TrendingConstellations:
    """Cached for a few minutes. Raises RuntimeError/psycopg.Error when the database is unavailable."""
    global _cache
    demo_on = settings.trending_demo_signal
    with _lock:
        if _cache and _cache[1] == demo_on and time.monotonic() - _cache[0] < CACHE_SECONDS:
            full = _cache[2]
        else:
            full = None
    if full is None:
        with connection() as conn:
            full = compute(conn, datetime.now(timezone.utc), load_demo() if demo_on else None)
        with _lock:
            _cache = (time.monotonic(), demo_on, full)
    return full.model_copy(update={'constellations': full.constellations[:limit]})
