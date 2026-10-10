"""Owner-scoped saved universes, grouped against cached franchise membership.

Reads never discover media or run inference. Abandon leaves progress untouched;
its tombstone prevents legacy progress from silently bringing a universe back.
"""
from contextlib import contextmanager
from datetime import datetime
from typing import Iterator
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import HTTPException
from app.database import connection
from app.library_models import AbandonResult, LibraryTitle, SavedUniverse, UniversePreferences
from app.schemas import Media
from app.services import franchises, progress
from app.services.demo import MEDIA


@contextmanager
def storage() -> Iterator[psycopg.Connection]:
    try:
        with connection() as conn:
            yield conn
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Saved universes unavailable; run python -m app.init_db') from None


def release_order(media: Media) -> tuple[int, int, int, str]:
    date = media.release_date
    return (date.year or 9999, date.month or 13, date.day or 32, media.id) if date else (9999, 13, 32, media.id)


def build_item(record: dict, media: list[Media], states: dict[str, dict], *, incomplete: bool) -> SavedUniverse:
    root = Media.model_validate(record['root_media'])
    members = {item.id: item for item in media}
    members.setdefault(root.id, root)
    titles = []
    timestamps = [record['last_explored_at']]
    for item in sorted(members.values(), key=release_order):
        row = states.get(item.id)
        totals = {item.id: item.total_units} if item.total_units_known else {}
        state = progress._state(item.id, (row['completed_unit'], row['completed'], row['manual_unlocked']) if row else None, totals)
        if row:
            timestamps.append(row['updated_at'])
        minutes = 0
        if item.type == 'movie' or item.format == 'MOVIE' or item.progress_unit == 'movie':
            minutes = 120 if state.completed else 0
        elif item.progress_unit == 'episode':
            episodes = state.progress.unit if state.progress else 0
            if item.total_units_known:
                episodes = item.total_units if state.completed else min(episodes, item.total_units)
            minutes = episodes * 22
        titles.append(LibraryTitle(media_id=item.id, title=item.title, cover_url=item.cover_url,
                                  type=item.type, format=item.format, release_date=item.release_date,
                                  completed=state.completed, estimated_minutes_watched=minutes))
    return SavedUniverse(media_id=root.id, title=root.title, cover_url=root.cover_url,
                         type=root.type, format=root.format, titles=titles,
                         viewed_count=sum(item.completed for item in titles), total_count=len(titles),
                         coverage_incomplete=incomplete, pinned=record['pinned'], rating=record['rating'],
                         saved_at=record['saved_at'], last_explored_at=max(timestamps))


def collect(conn: psycopg.Connection, user_id: str) -> list[SavedUniverse]:
    with conn.cursor(row_factory=dict_row) as cur:
        records = cur.execute('''SELECT * FROM public.user_saved_universes
            WHERE user_id=%s ORDER BY pinned DESC,saved_at DESC,root_media_id''', (user_id,)).fetchall()
        rows = cur.execute('''SELECT * FROM public.user_progress WHERE user_id=%s
            ORDER BY updated_at DESC,media_id''', (user_id,)).fetchall()
        states = {row['media_id']: row for row in rows}
        candidates = sorted({r['root_media_id'] for r in records} | set(states))
        if not candidates:
            return []
        catalog = cur.execute('''SELECT f.id,f.discovery,m.media_id,m.media FROM public.franchises f
            JOIN public.franchise_media m ON m.franchise_id=f.id
            WHERE f.merged_into IS NULL AND f.id IN (
                SELECT f2.id FROM public.franchises f2 JOIN public.franchise_media m2 ON m2.franchise_id=f2.id
                WHERE f2.merged_into IS NULL AND m2.media_id=ANY(%s)
                AND (f2.discovery->'strong_ids') ? m2.media_id)
            ORDER BY f.id,m.media_id''', (candidates,)).fetchall()
        generated = cur.execute('SELECT media_id,media FROM public.generated_graphs WHERE media_id=ANY(%s)', (candidates,)).fetchall()
    groups: dict[str, list[Media]] = {}
    membership: dict[str, str] = {}
    metadata = {row['media_id']: Media.model_validate(row['media']) for row in generated}
    metadata[MEDIA.id] = MEDIA
    for row in catalog:
        item = Media.model_validate(row['media'])
        groups.setdefault(row['id'], []).append(item)
        metadata.setdefault(item.id, item)
        if item.id in row['discovery'].get('strong_ids', []):
            membership.setdefault(item.id, row['id'])
    # Explicit saves win over imported legacy progress; tombstones win over both.
    hidden = {membership.get(r['root_media_id'], r['root_media_id']) for r in records if r['abandoned']}
    represented = set(hidden)
    items = []
    for record in records:
        key = membership.get(record['root_media_id'], record['root_media_id'])
        if key in represented:
            continue
        represented.add(key)
        root = Media.model_validate(record['root_media'])
        items.append(build_item(record, groups.get(key, [root]), states, incomplete=key in groups))
    for row in rows:
        key = membership.get(row['media_id'], row['media_id'])
        if key in represented or row['media_id'] not in metadata:
            continue
        represented.add(key)
        root = metadata[row['media_id']]
        record = dict(root_media=root.model_dump(), pinned=False, rating=None,
                      saved_at=row['updated_at'], last_explored_at=row['updated_at'])
        items.append(build_item(record, groups.get(key, [root]), states, incomplete=key in groups))
    return sorted(items, key=lambda item: (not item.pinned, -item.last_explored_at.timestamp(), item.media_id))


def list_saved(user_id: str) -> list[SavedUniverse]:
    with storage() as conn:
        return collect(conn, user_id)


def root_metadata(conn: psycopg.Connection, user_id: str, media_id: str) -> dict:
    """Preserve completion totals when materializing a legacy progress entry."""
    if media_id == MEDIA.id:
        return MEDIA.model_dump(mode='json')
    row = conn.execute('''SELECT root_media FROM public.user_saved_universes
        WHERE user_id=%s AND root_media_id=%s''', (user_id, media_id)).fetchone()
    if row:
        return row[0]
    row = conn.execute('''SELECT media FROM public.franchise_media WHERE media_id=%s
        ORDER BY refreshed_at DESC,franchise_id LIMIT 1''', (media_id,)).fetchone()
    if not row:
        row = conn.execute('SELECT media FROM public.generated_graphs WHERE media_id=%s', (media_id,)).fetchone()
    if not row:
        raise HTTPException(404, 'Universe metadata unavailable')
    return Media.model_validate(row[0]).model_dump(mode='json')


def save(user_id: str, media_id: str) -> SavedUniverse:
    # Discovery occurs only on this explicit action and reuses existing bounded caches.
    if media_id == MEDIA.id:
        root = MEDIA
    else:
        try:
            graph = franchises.universe(media_id)
            root = next(item for item in graph.media if item.id == media_id)
        except (ValueError, KeyError, TypeError, StopIteration):
            raise HTTPException(502, 'Universe metadata unavailable; try again') from None
    with storage() as conn:
        # Only strong membership groups saves; a weak side-story boundary cannot merge libraries.
        row = conn.execute('''SELECT discovery->'strong_ids' FROM public.franchises
            WHERE merged_into IS NULL AND (discovery->'strong_ids') ? %s
            ORDER BY id LIMIT 1''', (media_id,)).fetchone()
        group_ids = row[0] if row else [media_id]
        existing = next((item for item in collect(conn, user_id) if item.media_id in group_ids), None)
        prior = conn.execute('''SELECT root_media_id,root_media FROM public.user_saved_universes
            WHERE user_id=%s AND root_media_id=ANY(%s) ORDER BY saved_at,root_media_id LIMIT 1''',
            (user_id, group_ids)).fetchone()
        if existing:
            media_id = existing.media_id
            snapshot = root_metadata(conn, user_id, media_id)
        elif prior:
            media_id, snapshot = prior
        else:
            snapshot = root.model_dump(mode='json')
        conn.execute('''UPDATE public.user_saved_universes SET abandoned=false
            WHERE user_id=%s AND root_media_id=ANY(%s)''', (user_id, group_ids))
        conn.execute('''INSERT INTO public.user_saved_universes(user_id,root_media_id,root_media)
            VALUES(%s,%s,%s) ON CONFLICT(user_id,root_media_id) DO UPDATE
            SET abandoned=false,last_explored_at=now(),root_media=EXCLUDED.root_media''',
            (user_id, media_id, Jsonb(snapshot)))
        return next(item for item in collect(conn, user_id) if item.media_id == media_id)


def update(user_id: str, media_id: str, preferences: UniversePreferences | None) -> SavedUniverse | AbandonResult:
    with storage() as conn:
        item = next((item for item in collect(conn, user_id) if item.media_id == media_id), None)
        if item is None:
            raise HTTPException(404, 'Saved universe not found')
        conn.execute('''INSERT INTO public.user_saved_universes
            (user_id,root_media_id,root_media,saved_at,last_explored_at,pinned,rating,abandoned)
            VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(user_id,root_media_id) DO UPDATE SET
                pinned=EXCLUDED.pinned,rating=EXCLUDED.rating,abandoned=EXCLUDED.abandoned''',
            (user_id, media_id, Jsonb(root_metadata(conn, user_id, media_id)), item.saved_at, item.last_explored_at,
             preferences.pinned if preferences and 'pinned' in preferences.model_fields_set else item.pinned,
             preferences.rating if preferences and 'rating' in preferences.model_fields_set else item.rating,
             preferences is None))
        if preferences is None:
            return AbandonResult(media_id=media_id)
        return next(result for result in collect(conn, user_id) if result.media_id == media_id)
