import psycopg
from fastapi import HTTPException
from app.config import settings
from app.database import connection
from app.schemas import RevealPoint, UserProgress


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


def save_progress(user_id: str, progress: UserProgress) -> UserProgress:
    if not settings.database_url:
        raise HTTPException(503, "Configure DATABASE_URL for saved progress")
    try:
        with connection() as conn:
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
