import logging
import psycopg
from pydantic import ValidationError
from app.config import settings
from app.database import connection
from app.schemas import Entity, Media, Provenance, Relationship, RevealPoint
from app.services.seed_catalog import SEED

log = logging.getLogger(__name__)
BUILTIN = {media.id: (media, entities, relationships) for media, entities, relationships in SEED}
Catalog = tuple[Media, list[Entity], list[Relationship], str]


def _from_database(media_id: str) -> tuple[Media, list[Entity], list[Relationship]] | None:
    with connection() as conn:
        row = conn.execute(
            "SELECT id, title, type, progress_unit, total_units, description, anilist_id "
            "FROM public.media WHERE id = %s", (media_id,)).fetchone()
        if row is None:
            return None
        entities = conn.execute(
            "SELECT id, name, type, description, unlock_episode, source, source_unit, verified "
            "FROM public.entities WHERE media_id = %s ORDER BY unlock_episode, id", (media_id,)).fetchall()
        edges = conn.execute(
            "SELECT id, source, target, type, unlock_episode, provenance_source, source_unit, verified "
            "FROM public.relationships WHERE media_id = %s ORDER BY unlock_episode, id", (media_id,)).fetchall()
    media = Media(id=row[0], title=row[1], type=row[2], progress_unit=row[3],
                  total_units=row[4], description=row[5], anilist_id=row[6])
    return (media,
            [Entity(id=r[0], name=r[1], type=r[2], description=r[3], revealed_at=RevealPoint(unit=r[4]),
                    provenance=Provenance(source=r[5], source_unit=r[6], verified=r[7])) for r in entities],
            [Relationship(id=r[0], source=r[1], target=r[2], type=r[3], revealed_at=RevealPoint(unit=r[4]),
                          provenance=Provenance(source=r[5], source_unit=r[6], verified=r[7])) for r in edges])


def load_catalog(media_id: str) -> Catalog | None:
    """Neon first; if the database is unset, unreachable, unseeded or inconsistent use the in-code seed.

    Returns (media, entities, relationships, origin) with UNFILTERED rows: callers must run
    them through filter_graph before anything leaves the server. None means the media is unknown.
    """
    if settings.database_url:
        try:
            found = _from_database(media_id)
            if found:
                return (*found, "database")
        except (psycopg.Error, ValidationError) as error:
            log.warning("Catalog database unavailable (%s); using built-in seed", type(error).__name__)
    builtin = BUILTIN.get(media_id)
    return (*builtin, "builtin") if builtin else None
