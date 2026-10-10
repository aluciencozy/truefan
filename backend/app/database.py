from contextlib import contextmanager
from app.config import settings


@contextmanager
def connection():
    """Lazy Neon-compatible connection; importing or booting never opens the database."""
    if not settings.database_url:
        raise RuntimeError("Set DATABASE_URL before using database features.")
    import psycopg
    with psycopg.connect(settings.database_url) as conn:
        yield conn
