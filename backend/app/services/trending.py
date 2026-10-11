"""Trending constellations for Explore: AniList's trending anime (the same 16 as the home page) seed one
constellation each, built from their related anime. TrueFan completion counts are a bonus signal.

One cached AniList request (anilist.trending_media, shared with the home covers) feeds everything: there are no
per-title follow-ups and nothing triggers generation. If AniList fails, the sky falls back to the most-completed
works of cached franchises. Only titles, covers, format/year and counts leave this module: no synopses, no user ids.
A completion follows progress.py: `completed IS TRUE`, or `completed IS NULL` with `completed_unit >= total_units`
when the total is known. Users are counted once per work.
"""
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import psycopg
from psycopg.rows import dict_row
from pydantic import ValidationError
from app.database import connection
from app.schemas import Media, TrendingConstellation, TrendingConstellations, TrendingLink, TrendingStar
from app.services import anilist
from app.services.anilist import STRONG_RELATIONS
from app.services.library import release_order
from app.services.universe_search import universe_title

WINDOW_DAYS = 30
MIN_STARS, MAX_STARS, MAX_LIMIT = 3, 8, 8
CACHE_SECONDS, FALLBACK_CACHE_SECONDS = 600, 60
PREFERRED = ('SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE')
RELATED_TOP = .9  # related stars stay dimmer than the trending seeds, which are always 1.0


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


def completion_counts(conn: psycopg.Connection, media: dict[str, Media], now: datetime) -> dict[str, int]:
    since = now - timedelta(days=WINDOW_DAYS)
    if not media:
        return {}
    rows = conn.execute('''SELECT user_id,media_id,completed,completed_unit,updated_at FROM public.user_progress
        WHERE media_id=ANY(%s) AND updated_at>=%s AND completed IS NOT FALSE''', (list(media), since)).fetchall()
    return count_completions(rows, media, since)


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


def _rollback(conn: psycopg.Connection) -> None:
    try:
        conn.rollback()
    except (AttributeError, psycopg.Error):
        pass


# ---- AniList trending (primary) ------------------------------------------------------------------------------------

@dataclass
class Seed:
    rank: int
    media: Media
    edges: list[tuple[str, str]] = field(default_factory=list)  # (relationType, target id), anime targets only


@dataclass
class Related:
    media: Media
    priority: int
    popularity: int


def _anime(entry: dict) -> Media | None:
    try:
        media = anilist.normalize(entry)
    except (KeyError, TypeError, ValueError, ValidationError):
        return None
    return media if media.type == 'anime' and entry.get('type', 'ANIME') == 'ANIME' else None


def parse_seeds(rows: list[dict]) -> tuple[list[Seed], dict[str, dict[str, Related]]]:
    """Seeds in trending order, plus each seed's related anime (manga and novels are dropped, as in universe maps)."""
    seeds, related = [], {}
    for rank, row in enumerate(rows, 1):
        media = _anime(row)
        if media is None or any(seed.media.id == media.id for seed in seeds):
            continue
        seed = Seed(rank, media)
        found: dict[str, Related] = {}
        for edge in (row.get('relations') or {}).get('edges') or []:
            kind, node = str(edge.get('relationType', '')).upper(), edge.get('node') or {}
            other = _anime(node)
            if other is None or other.id == media.id:
                continue
            seed.edges.append((kind, other.id))
            priority = PREFERRED.index(kind) if kind in PREFERRED else len(PREFERRED)
            popularity = node.get('popularity') if isinstance(node.get('popularity'), int) else 0
            if other.id not in found or (priority, -popularity) < (found[other.id].priority, -found[other.id].popularity):
                found[other.id] = Related(other, priority, popularity)
        seeds.append(seed)
        related[media.id] = found
    return seeds, related


def group_seeds(seeds: list[Seed], franchise_of: dict[str, tuple[str, str]]) -> list[list[Seed]]:
    """Seeds that are directly related by a strong relation, or sit in the same cached franchise, share a constellation."""
    ids = {seed.media.id for seed in seeds}
    parent = {item: item for item in ids}

    def find(item: str) -> str:
        while parent[item] != item:
            parent[item] = parent[parent[item]]
            item = parent[item]
        return item
    for seed in seeds:
        for kind, other in seed.edges:
            if other in ids and kind in STRONG_RELATIONS:
                parent[find(seed.media.id)] = find(other)
    first_in_franchise: dict[str, str] = {}
    for seed in seeds:
        if seed.media.id in franchise_of:
            anchor = first_in_franchise.setdefault(franchise_of[seed.media.id][0], seed.media.id)
            parent[find(seed.media.id)] = find(anchor)
    groups: dict[str, list[Seed]] = {}
    for seed in seeds:  # seeds are in trending order, so groups are too
        groups.setdefault(find(seed.media.id), []).append(seed)
    return list(groups.values())


def related_scale(popularities: list[int]) -> list[float]:
    low, high = min(popularities), max(popularities)
    return [.6 if high == low else round(.25 + (RELATED_TOP - .25) * (p - low) / (high - low), 4) for p in popularities]


def build_anilist(rows: list[dict], now: datetime, conn: psycopg.Connection | None) -> TrendingConstellations:
    seeds, related = parse_seeds(rows)
    seed_ids = {seed.media.id for seed in seeds}
    franchise_of: dict[str, tuple[str, str]] = {}
    if conn is not None:
        try:
            for media_id, franchise_id, display_name in conn.execute('''SELECT m.media_id, f.id, f.display_name
                FROM public.franchise_media m JOIN public.franchises f ON f.id=m.franchise_id
                WHERE m.media_id=ANY(%s) AND f.merged_into IS NULL AND (f.discovery->'strong_ids') ? m.media_id
                ORDER BY f.id''', (sorted(seed_ids),)).fetchall():
                franchise_of.setdefault(media_id, (franchise_id, universe_title(display_name)))
        except (RuntimeError, psycopg.Error):
            _rollback(conn)
            franchise_of = {}
    claimed: set[str] = set()
    plans = []
    for group in group_seeds(seeds, franchise_of):
        members = group[:MAX_STARS]
        member_ids = {seed.media.id for seed in members}
        candidates: dict[str, Related] = {}
        for seed in members:
            for other_id, item in related[seed.media.id].items():
                if other_id in seed_ids or other_id in claimed:  # other trending titles have their own constellation
                    continue
                if other_id not in candidates or (item.priority, -item.popularity) < (candidates[other_id].priority, -candidates[other_id].popularity):
                    candidates[other_id] = item
        extra = sorted(candidates.values(), key=lambda item: (item.priority, -item.popularity, release_order(item.media)))
        extra = extra[:MAX_STARS - len(members)]
        if len(members) + len(extra) < MIN_STARS:
            continue
        claimed.update(item.media.id for item in extra)
        plans.append((members, extra, member_ids))
    star_media = {seed.media.id: seed.media for members, _, _ in plans for seed in members}
    star_media.update({item.media.id: item.media for _, extra, _ in plans for item in extra})
    counts: dict[str, int] = {}
    stored: list[tuple] = []
    if conn is not None:
        try:
            counts = completion_counts(conn, star_media, now)
            stored = conn.execute('SELECT source,target,type FROM public.media_relations WHERE source=ANY(%s) AND target=ANY(%s)',
                                  (sorted(star_media), sorted(star_media))).fetchall()
        except (RuntimeError, psycopg.Error):
            _rollback(conn)
    built = []
    for members, extra, member_ids in plans:
        stars = sorted([seed.media for seed in members] + [item.media for item in extra], key=release_order)
        ids = {star.id for star in stars}
        relations = [(seed.media.id, other, kind) for seed in members for kind, other in seed.edges] + [r for r in stored if r[0] in ids and r[1] in ids]
        links = connect(stars, normalise_links(relations, ids))
        scale = dict(zip((item.media.id for item in extra), related_scale([item.popularity for item in extra]))) if extra else {}
        rank_of = {seed.media.id: seed.rank for seed in members}
        best = members[0]
        franchise = franchise_of.get(best.media.id)
        title = universe_title(best.media.title)
        # Several trending titles that share one cached franchise take that franchise's (already shortened) title.
        if len(members) > 1 and franchise and all(franchise_of.get(m, ('',))[0] == franchise[0] for m in member_ids):
            title = franchise[1]
        built.append(TrendingConstellation(
            franchise_id=franchise[0] if franchise else f'trending-{best.media.id}', title=title, entry_media_id=best.media.id,
            score=sum(counts.get(star.id, 0) for star in stars), trending_rank=best.rank, links=links,
            stars=[TrendingStar(media_id=star.id, title=star.title, cover_url=star.cover_url, format=star.format,
                                year=star.release_date.year if star.release_date else None, completions=counts.get(star.id, 0),
                                magnitude=1.0 if star.id in rank_of else scale.get(star.id, .6),
                                trending=star.id in rank_of, trending_rank=rank_of.get(star.id)) for star in stars]))
    built.sort(key=lambda c: (c.trending_rank or 999, c.franchise_id))
    return TrendingConstellations(source='anilist_trending', window_days=WINDOW_DAYS, constellations=built[:MAX_LIMIT])


# ---- TrueFan completions (fallback) --------------------------------------------------------------------------------

def compute(conn: psycopg.Connection, now: datetime) -> TrendingConstellations:
    """Fallback when AniList is unavailable: each cached franchise's most-completed works."""
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
    counts = completion_counts(conn, media, now)
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
    return TrendingConstellations(source='truefan_completions', window_days=WINDOW_DAYS, constellations=built[:MAX_LIMIT])


# ---- entry point ---------------------------------------------------------------------------------------------------

_cache: tuple[float, float, TrendingConstellations] | None = None  # stored at, time to live, response
_lock = threading.Lock()


def reset_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def _from_anilist(now: datetime) -> TrendingConstellations | None:
    try:
        rows = anilist.trending_media()
    except (ValueError, KeyError, TypeError):
        return None
    try:
        with connection() as conn:
            return build_anilist(rows, now, conn)
    except (RuntimeError, psycopg.Error):
        return build_anilist(rows, now, None)  # no database: still real trending data, just no completion counts


def constellations(limit: int = 5) -> TrendingConstellations:
    """Cached ~10 minutes (1 minute when serving the fallback). Raises RuntimeError/psycopg.Error if both sources fail."""
    global _cache
    with _lock:
        if _cache and time.monotonic() - _cache[0] < _cache[1]:
            full = _cache[2]
        else:
            full = None
    if full is None:
        now, ttl = datetime.now(timezone.utc), CACHE_SECONDS
        full = _from_anilist(now)
        if full is None or not full.constellations:
            try:
                with connection() as conn:
                    fallback = compute(conn, now)
                full, ttl = fallback, FALLBACK_CACHE_SECONDS
            except (RuntimeError, psycopg.Error):
                if full is None:
                    raise
        with _lock:
            _cache = (time.monotonic(), ttl, full)
    return full.model_copy(update={'constellations': full.constellations[:limit]})
