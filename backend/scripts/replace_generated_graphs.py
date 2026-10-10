"""Dry-run by default; atomically replace only the explicitly researched caches."""
import argparse
import json
import os
from pathlib import Path
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from app.database import connection
from app.schemas import Media
from app.services import curation, generation

ROOT = Path(__file__).resolve().parents[2]


def replace(conn, dataset: curation.Dataset, backup: Path | None = None) -> list[dict]:
    documents = {g.media_id: g.document() for g in dataset.graphs}
    targets = list(documents) + dataset.clear_empty_media_ids
    conn.execute('SELECT pg_advisory_xact_lock(731904)')
    with conn.cursor(row_factory=dict_row) as cursor:
        rows = cursor.execute('SELECT * FROM public.generated_graphs WHERE media_id=ANY(%s) '
                              'ORDER BY media_id FOR UPDATE', (targets,)).fetchall()
    if {r['media_id'] for r in rows} != set(targets):
        raise ValueError('Every replacement target must already exist')
    plan = []
    for row in rows:
        media_id = row['media_id']
        if media_id in documents:
            document = documents[media_id]
            if len(document['episodes']) > Media.model_validate(row['media']).total_units:
                raise ValueError('Replacement exceeds cached media progress bounds')
            nodes, edges = generation.graph_data(document)
            plan.append({'media_id': media_id, 'units': len(document['episodes']),
                         'characters': len({n.id for n in nodes}), 'relationships': len(edges)})
        else:
            if (row['status'] not in ('failed', 'empty') or row['document'].get('episodes')
                    or row['working_document'].get('episodes')):
                raise ValueError('Refusing to delete a cache containing work or an active job')
            plan.append({'media_id': media_id, 'delete_empty_failed_cache': True})
    if backup is None:
        return plan
    backup = backup.resolve()
    if backup.is_relative_to(ROOT):
        raise ValueError('Backup must remain outside the repository')
    backup.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(rows, stream, default=str, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    for row in rows:
        media_id = row['media_id']
        if media_id not in documents:
            conn.execute('DELETE FROM public.generated_graphs WHERE media_id=%s', (media_id,))
        else:
            document = documents[media_id]
            conn.execute('''UPDATE public.generated_graphs SET document=%s,working_document=%s,
                model=%s,episode_cap=%s,status='partial',error=NULL,regenerating=false,
                lease_token=NULL,lease_until=NULL,attempts=0,updated_at=now() WHERE media_id=%s''',
                (Jsonb(document), Jsonb(document), curation.MODEL, len(document['episodes']), media_id))
    return plan


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup', type=Path)
    args = parser.parse_args()
    if args.apply and not args.backup:
        parser.error('--apply requires --backup outside the repository')
    dataset = curation.load()
    with connection() as conn:
        plan = replace(conn, dataset, args.backup if args.apply else None)
    print(json.dumps({'applied': args.apply, 'plan': plan}, indent=2))


if __name__ == '__main__':
    main()
