"""Bounded provisional franchise caches. Provider HTTP never runs under a DB lock."""
from dataclasses import dataclass
from datetime import datetime, timezone
import uuid
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import HTTPException
from app.config import settings
from app.database import connection
from app.schemas import Media, Universe, UniverseCache, UniverseEdge, UniverseExpandRequest
from app.services import anilist

PUBLISH_LOCK = 731905
HEURISTIC_VERSION = 1


@dataclass
class Snapshot:
    row: dict
    graph: Universe


def _load(cursor: psycopg.Cursor, media_id: str) -> Snapshot | None:
    # Boundary metadata can have several memberships; only strong membership is identity evidence.
    row = cursor.execute('''SELECT f.* FROM public.franchises f
        JOIN public.franchise_media m ON m.franchise_id=f.id
        WHERE m.media_id=%s AND f.merged_into IS NULL
          AND (f.discovery->'strong_ids') ? %s
        ORDER BY f.id LIMIT 1''', (media_id, media_id)).fetchone()
    return _snapshot(cursor, row, media_id) if row else None


def _snapshot(cursor: psycopg.Cursor, row: dict, media_id: str) -> Snapshot:
    media = cursor.execute('''SELECT media FROM public.franchise_media
        WHERE franchise_id=%s ORDER BY media_id''', (row['id'],)).fetchall()
    nodes = [Media.model_validate(m['media']) for m in media]
    ids = [m.id for m in nodes]
    relations = cursor.execute('''SELECT source,target,type FROM public.media_relations
        WHERE source=ANY(%s) AND target=ANY(%s) ORDER BY source,target,type''', (ids, ids)).fetchall()
    return Snapshot(row, Universe(root_id=media_id, media=nodes,
                                 relationships=[UniverseEdge.model_validate(e) for e in relations]))


def load(media_id: str) -> Snapshot | None:
    with connection() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            return _load(cursor, media_id)


def response(snapshot: Snapshot, media_id: str) -> Universe:
    row, graph = snapshot.row, snapshot.graph
    refreshed = row['refreshed_at']
    stale = refreshed is None or (datetime.now(timezone.utc) - refreshed).total_seconds() > settings.franchise_cache_ttl_seconds
    limits = set(row['limitations'])
    if stale:
        limits.add('stale_metadata')
    frontier = set(row['discovery'].get('frontier', []))
    return Universe(root_id=media_id, media=graph.media,
                    relationships=graph.relationships,
                    truncated=bool(frontier) or 'node_cap' in limits,
                    franchise_id=row['id'], cache=UniverseCache(
                        refreshed_at=refreshed.isoformat() if refreshed else None, stale=stale,
                        # Even exhausted provider relations do not prove canonical completeness.
                        incomplete=True, revision=row['revision'],
                        can_expand=bool(frontier),
                        limitations=sorted(limits)))


def cached_media(media_id: str) -> Media | None:
    if not settings.database_url:
        return None
    with connection() as conn:
        row = conn.execute('''SELECT media FROM public.franchise_media WHERE media_id=%s
            ORDER BY refreshed_at DESC,franchise_id LIMIT 1''', (media_id,)).fetchone()
    return Media.model_validate(row[0]) if row else None


def search_local(text: str) -> list[Media]:
    """Only a degraded search fallback; title matches never establish identity."""
    if not settings.database_url:
        return []
    with connection() as conn:
        rows = conn.execute('''SELECT DISTINCT ON (media_id) media FROM public.franchise_media
            WHERE strpos(lower(media->>'title'),lower(%s)) > 0 AND media->>'type'='anime'
            ORDER BY media_id,refreshed_at DESC,franchise_id LIMIT 10''', (text,)).fetchall()
    return [Media.model_validate(row[0]).model_copy(update={
        'description': 'Cached AniList metadata; search results may be incomplete.'}) for row in rows]


def publish(discovery: anilist.Discovery, *, expected: Snapshot | None = None) -> Snapshot:
    """Serialize only publication, recheck overlap, union facts, redirect deterministic losers."""
    graph = discovery.graph
    with connection() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(%s)', (PUBLISH_LOCK,))
        with conn.cursor(row_factory=dict_row) as cursor:
            current = _load(cursor, graph.root_id)
            if expected and (not current or current.row['id'] != expected.row['id']
                             or current.row['revision'] != expected.row['revision']):
                raise HTTPException(409, 'Universe cache changed; reload before expanding')
            rows = cursor.execute('''SELECT DISTINCT f.* FROM public.franchises f
                JOIN public.franchise_media m ON m.franchise_id=f.id
                WHERE f.merged_into IS NULL AND m.media_id=ANY(%s)
                  AND (f.discovery->'strong_ids') ? m.media_id ORDER BY f.id''',
                (sorted(discovery.strong_ids),)).fetchall()
            survivor = rows[0]['id'] if rows else 'franchise-' + uuid.uuid4().hex
            if not rows:
                selected = next(m for m in graph.media if m.id == graph.root_id)
                cursor.execute('''INSERT INTO public.franchises(id,display_name,discovery_status)
                    VALUES(%s,%s,'partial')''', (survivor, selected.title))
            expanded = set(discovery.expanded)
            strong = set(discovery.strong_ids)
            frontier = set(discovery.frontier)
            limits = set(discovery.limitations)
            all_ids = {m.id for m in graph.media}
            for row in rows:
                previous = row['discovery']
                expanded.update(previous.get('expanded_ids', []))
                strong.update(previous.get('strong_ids', []))
                frontier.update(previous.get('frontier', []))
                # Preserve evidence/failure limitations, recompute transient traversal bounds below.
                limits.update(set(row['limitations']) - {'node_cap', 'depth_cap', 'partial_relations', 'provider_failure'})
                members = cursor.execute('''SELECT media_id FROM public.franchise_media
                    WHERE franchise_id=%s''', (row['id'],)).fetchall()
                all_ids.update(m['media_id'] for m in members)
                if row['id'] != survivor:
                    cursor.execute('''INSERT INTO public.franchise_media(franchise_id,media_id,anilist_id,media,refreshed_at)
                        SELECT %s,media_id,anilist_id,media,refreshed_at FROM public.franchise_media WHERE franchise_id=%s
                        ON CONFLICT(franchise_id,media_id) DO UPDATE SET media=EXCLUDED.media,
                        refreshed_at=EXCLUDED.refreshed_at
                        WHERE franchise_media.refreshed_at<EXCLUDED.refreshed_at''', (survivor, row['id']))
                    cursor.execute('''UPDATE public.franchises SET merged_into=%s WHERE id=%s''', (survivor, row['id']))
            frontier = (frontier | strong) - expanded
            if frontier:
                limits.add('partial_relations')
            if frontier and len(all_ids) >= settings.universe_node_cap:
                limits.add('node_cap')
            for media in graph.media:
                if media.id not in discovery.observed_ids:
                    continue
                cursor.execute('''INSERT INTO public.franchise_media(franchise_id,media_id,anilist_id,media)
                    VALUES(%s,%s,%s,%s) ON CONFLICT(franchise_id,media_id) DO UPDATE
                    SET media=EXCLUDED.media,refreshed_at=now()''',
                    (survivor, media.id, media.anilist_id, Jsonb(media.model_dump())))
            for edge in graph.relationships:
                cursor.execute('''INSERT INTO public.media_relations(source,target,type) VALUES(%s,%s,%s)
                    ON CONFLICT(source,target,type) DO UPDATE SET observed_at=now()''', (edge.source, edge.target, edge.type))
            state = {'heuristic_version': HEURISTIC_VERSION, 'strong_ids': sorted(strong),
                     'expanded_ids': sorted(expanded), 'frontier': sorted(frontier),
                     'node_limit': discovery.node_limit if discovery.node_limit is not None else settings.universe_node_cap,
                     'depth': discovery.depth_limit if discovery.depth_limit is not None else settings.universe_depth}
            revision = max((row['revision'] for row in rows), default=0) + 1
            row = cursor.execute('''UPDATE public.franchises SET discovery_status=%s,
                refreshed_at=now(),revision=%s,limitations=%s,discovery=%s WHERE id=%s RETURNING *''',
                ('partial' if frontier else 'bounded', revision, Jsonb(sorted(limits)), Jsonb(state), survivor)).fetchone()
            return _snapshot(cursor, row, graph.root_id)


def universe(media_id: str) -> Universe:
    if settings.database_url:
        try:
            snapshot = load(media_id)
            if snapshot:
                return response(snapshot, media_id)
        except (RuntimeError, psycopg.Error):
            pass
    discovery = anilist.discover(media_id)
    if settings.database_url:
        try:
            return response(publish(discovery), media_id)
        except (RuntimeError, psycopg.Error):
            pass
    return discovery.graph


def expand(media_id: str, request: UniverseExpandRequest) -> Universe:
    cap = request.node_limit if request.node_limit is not None else settings.universe_node_cap
    depth = request.depth if request.depth is not None else settings.universe_depth
    if cap > settings.universe_node_cap or depth > settings.universe_depth:
        raise HTTPException(422, 'Expansion limits may not exceed configured bounds')
    try:
        snapshot = load(media_id)
        if not snapshot:
            raise HTTPException(409, 'Load the universe with GET before expanding')
        if request.expected_revision != snapshot.row['revision']:
            raise HTTPException(409, 'Universe cache changed; reload before expanding')
        state = snapshot.row['discovery']
        if not state.get('frontier'):
            return response(snapshot, media_id)
        try:
            discovery = anilist.discover(media_id, seed=snapshot.graph,
                expanded=set(state.get('expanded_ids', [])), strong_ids=set(state.get('strong_ids', [])),
                frontier=set(state['frontier']), node_limit=cap, depth_limit=depth,
                frontier_offset=snapshot.row['revision'])
        except (ValueError, KeyError, TypeError):
            # Do not change timestamps, revision, or existing metadata on a failed fetch.
            with connection() as conn:
                conn.execute('''UPDATE public.franchises SET limitations=
                    CASE WHEN limitations ? 'provider_failure' THEN limitations
                    ELSE limitations || '["provider_failure"]'::jsonb END
                    WHERE id=%s AND revision=%s AND merged_into IS NULL''',
                    (snapshot.row['id'], snapshot.row['revision']))
            raise HTTPException(502, 'Universe metadata temporarily unavailable; cached graph retained') from None
        return response(publish(discovery, expected=snapshot), media_id)
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Universe cache unavailable; configure DATABASE_URL and run python -m app.init_db') from None
