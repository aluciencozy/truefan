"""Idempotently seed the curated demo catalog into Neon Postgres (DATABASE_URL from backend/.env).

Run from backend/:  python scripts/seed_demo_data.py
Safe to re-run: rows are upserted and rows removed from the seed are deleted for those titles.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import connection  # noqa: E402
from app.services.seed_catalog import SEED, validate  # noqa: E402

SCHEMA = Path(__file__).resolve().parents[1] / "app" / "schema.sql"


def main() -> None:
    for media, entities, relationships in SEED:
        validate(media, entities, relationships)
    with connection() as conn:  # one transaction; commits on success, rolls back on error
        conn.execute(SCHEMA.read_text())
        for media, entities, relationships in SEED:
            conn.execute(
                """INSERT INTO public.media (id, title, type, progress_unit, total_units, description, anilist_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, type = EXCLUDED.type,
                     progress_unit = EXCLUDED.progress_unit, total_units = EXCLUDED.total_units,
                     description = EXCLUDED.description, anilist_id = EXCLUDED.anilist_id""",
                (media.id, media.title, media.type, media.progress_unit, media.total_units,
                 media.description, media.anilist_id))
            conn.execute("DELETE FROM public.relationships WHERE media_id = %s AND id <> ALL(%s)",
                         (media.id, [r.id for r in relationships]))
            conn.execute("DELETE FROM public.entities WHERE media_id = %s AND id <> ALL(%s)",
                         (media.id, [e.id for e in entities]))
            for e in entities:
                conn.execute(
                    """INSERT INTO public.entities (media_id, id, name, type, description, unlock_episode,
                         source, source_unit, verified) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (media_id, id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type,
                         description = EXCLUDED.description, unlock_episode = EXCLUDED.unlock_episode,
                         source = EXCLUDED.source, source_unit = EXCLUDED.source_unit,
                         verified = EXCLUDED.verified""",
                    (media.id, e.id, e.name, e.type, e.description, e.revealed_at.unit,
                     e.provenance.source, e.provenance.source_unit, e.provenance.verified))
            for r in relationships:
                conn.execute(
                    """INSERT INTO public.relationships (media_id, id, source, target, type, unlock_episode,
                         provenance_source, source_unit, verified) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (media_id, id) DO UPDATE SET source = EXCLUDED.source, target = EXCLUDED.target,
                         type = EXCLUDED.type, unlock_episode = EXCLUDED.unlock_episode,
                         provenance_source = EXCLUDED.provenance_source, source_unit = EXCLUDED.source_unit,
                         verified = EXCLUDED.verified""",
                    (media.id, r.id, r.source, r.target, r.type, r.revealed_at.unit,
                     r.provenance.source, r.provenance.source_unit, r.provenance.verified))
            print(f"Seeded {media.id}: {len(entities)} entities, {len(relationships)} relationships")


if __name__ == "__main__":
    main()
