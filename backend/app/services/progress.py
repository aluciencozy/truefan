import psycopg
from fastapi import HTTPException
from app.config import settings
from app.database import connection
from app.schemas import Media, RevealPoint, UserProgress, UserMediaState, UserMediaStateUpdate


def get_progress(user_id: str, media_id: str) -> UserProgress | None:
    if not settings.database_url:
        raise HTTPException(503, "Configure DATABASE_URL for saved progress")
    try:
        with connection() as conn:
            row = conn.execute(
                "SELECT completed_unit FROM public.user_progress WHERE user_id = %s AND media_id = %s",
                (user_id, media_id),
            ).fetchone()
        return UserProgress(media_id=media_id, progress=RevealPoint(unit=row[0])) if row else None
    except psycopg.Error as error:
        raise HTTPException(503, "Progress storage unavailable; check the database and run python -m app.init_db") from error


def save_progress(user_id: str, progress: UserProgress, media: Media | None = None) -> UserProgress:
    if not settings.database_url:
        raise HTTPException(503, "Configure DATABASE_URL for saved progress")
    try:
        with connection() as conn:
            if media and media.total_units_known:
                conn.execute(
                    """INSERT INTO public.user_progress(user_id,media_id,completed_unit,completed)
                    VALUES(%s,%s,%s,%s) ON CONFLICT(user_id,media_id) DO UPDATE
                    SET completed_unit=EXCLUDED.completed_unit, updated_at=now(),
                    completed=CASE WHEN EXCLUDED.completed THEN true
                        ELSE COALESCE(user_progress.completed, user_progress.completed_unit >= %s) END""",
                    (user_id, progress.media_id, progress.progress.unit,
                     progress.progress.unit == media.total_units, media.total_units))
            else:
                conn.execute(
                    """INSERT INTO public.user_progress (user_id, media_id, completed_unit)
                       VALUES (%s, %s, %s)
                       ON CONFLICT (user_id, media_id) DO UPDATE
                       SET completed_unit = EXCLUDED.completed_unit, updated_at = now()""",
                    (user_id, progress.media_id, progress.progress.unit),
                )
        return progress
    except psycopg.Error as error:
        raise HTTPException(503, "Progress storage unavailable; check the database and run python -m app.init_db") from error


def _known_totals(conn: psycopg.Connection, media_ids: list[str]) -> dict[str, int]:
    from app.services.demo import MEDIA
    rows = conn.execute("""SELECT DISTINCT ON (media_id) media_id,media
        FROM public.franchise_media WHERE media_id=ANY(%s)
        ORDER BY media_id,refreshed_at DESC,franchise_id""", (media_ids,)).fetchall()
    snapshots = dict(rows)
    snapshots.update(conn.execute(
        'SELECT media_id,media FROM public.generated_graphs WHERE media_id=ANY(%s)',
        (media_ids,)).fetchall())
    totals = {}
    for media_id, data in snapshots.items():
        media = Media.model_validate(data)
        if media.total_units_known:
            totals[media_id] = media.total_units
    if MEDIA.id in media_ids:
        totals[MEDIA.id] = MEDIA.total_units
    return totals


def _state(media_id: str, row: tuple | None, totals: dict[str, int]) -> UserMediaState:
    if row is None:
        return UserMediaState(media_id=media_id)
    unit, completed, manual = row
    if completed is None:
        completed = media_id in totals and unit >= totals[media_id]
    return UserMediaState(media_id=media_id, progress=RevealPoint(unit=unit),
                          completed=completed, manual_unlocked=manual)


def get_media_states(user_id: str, media_ids: list[str]) -> list[UserMediaState]:
    if not settings.database_url:
        raise HTTPException(503, "Configure DATABASE_URL for saved progress")
    try:
        with connection() as conn:
            rows = conn.execute("""SELECT media_id,completed_unit,completed,manual_unlocked
                FROM public.user_progress WHERE user_id=%s AND media_id=ANY(%s)""",
                (user_id, media_ids)).fetchall()
            saved = {row[0]: tuple(row[1:]) for row in rows}
            totals = _known_totals(conn, [key for key, row in saved.items() if row[1] is None])
            return [_state(media_id, saved.get(media_id), totals) for media_id in sorted(media_ids)]
    except (RuntimeError, psycopg.Error) as error:
        raise HTTPException(503, "Progress storage unavailable; run python -m app.init_db") from error


def update_media_state(user_id: str, media_id: str, update: UserMediaStateUpdate) -> UserMediaState:
    if not settings.database_url:
        raise HTTPException(503, "Configure DATABASE_URL for saved progress")
    try:
        with connection() as conn:
            row = conn.execute("""INSERT INTO public.user_progress(user_id,media_id,completed_unit,completed,manual_unlocked)
                VALUES(%s,%s,0,%s,COALESCE(%s,false)) ON CONFLICT(user_id,media_id) DO UPDATE
                SET completed=COALESCE(EXCLUDED.completed,user_progress.completed),
                manual_unlocked=CASE WHEN %s THEN EXCLUDED.manual_unlocked ELSE user_progress.manual_unlocked END,
                updated_at=now() RETURNING completed_unit,completed,manual_unlocked""",
                (user_id, media_id, update.completed, update.manual_unlocked,
                 'manual_unlocked' in update.model_fields_set)).fetchone()
            totals = _known_totals(conn, [media_id]) if row[1] is None else {}
            return _state(media_id, row, totals)
    except (RuntimeError, psycopg.Error) as error:
        raise HTTPException(503, "Progress storage unavailable; run python -m app.init_db") from error
