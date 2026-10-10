"""Postgres-backed bounded jobs: per-episode checkpoints and fenced renewable leases."""
import hashlib
import json
import logging
import threading
import uuid
from typing import Literal
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from app.config import settings
from app.database import connection
from app.schemas import Entity, Relationship, Provenance, RevealPoint, GenerationStatus
from app.services import anilist, episodes, huggingface

log = logging.getLogger(__name__)
ACTIVE = ('retrieving', 'generating')

class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation: Literal['start','retry','extend','refresh'] = 'start'

def get(media_id: str) -> dict | None:
    with connection() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            return cursor.execute('SELECT * FROM public.generated_graphs WHERE media_id=%s', (media_id,)).fetchone()

def status(row: dict | None) -> GenerationStatus:
    if not row: return GenerationStatus(status='not_generated', episode_cap=settings.generation_episode_cap)
    entries = row['document'].get('episodes', [])
    return GenerationStatus(status=row['status'], processed_units=len(entries),
        supported_units=[e['episode']['unit'] for e in entries if e['status'] in ('done','partial')], episode_cap=row['episode_cap'],
        error=row['error'], updated_at=row['updated_at'].isoformat())

def enqueue(media_id: str, user: str, operation: str = 'start') -> dict:
    if not settings.database_url or not settings.hf_token:
        raise HTTPException(503, 'Configure DATABASE_URL and HF_TOKEN to generate graphs')
    if operation == 'refresh' and (not settings.generation_admin_subject or user != settings.generation_admin_subject):
        raise HTTPException(403, 'Regeneration is restricted to the configured developer account')
    media = anilist.normalize(anilist.details(media_id))
    if media.type != 'anime': raise HTTPException(422, 'Automated character generation currently supports anime only')
    with connection() as conn:
        # A short transaction lock serializes enqueue/claim quota decisions across Railway replicas.
        conn.execute('SELECT pg_advisory_xact_lock(731904)')
        with conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute('SELECT * FROM public.generated_graphs WHERE media_id=%s FOR UPDATE', (media_id,)).fetchone()
            if row and row['document'].get('source_curated'):
                return row  # Replace researched graphs only through the backed-up curation command.
            if row and (row['status'] in ('queued', *ACTIVE) or operation == 'start'):
                return row
            if row and operation == 'retry' and row['status'] == 'ready':
                return row
            if row and operation == 'extend' and row['episode_cap'] >= settings.generation_episode_cap:
                return row
            counts = conn.execute('''SELECT count(*),count(*) FILTER (WHERE user_id=%s)
                FROM public.graph_generation_requests WHERE requested_at > now()-interval '1 day' ''', (user,)).fetchone()
            if counts[0] >= settings.generation_global_daily_limit or counts[1] >= settings.generation_jobs_per_user:
                raise HTTPException(429, 'Daily generation limit reached; cached graphs remain available')
            conn.execute('INSERT INTO public.graph_generation_requests(user_id,media_id) VALUES(%s,%s)', (user,media_id))
            working = {'episodes': []} if operation == 'refresh' or not row else row['working_document']
            if operation == 'retry': working = {'episodes':[e for e in working['episodes'] if e['status'] in ('done','partial')]}
            cursor.execute('''INSERT INTO public.generated_graphs(media_id,media,model,episode_cap,requested_by,working_document,regenerating)
                VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(media_id) DO UPDATE SET
                status='queued',model=EXCLUDED.model,episode_cap=GREATEST(generated_graphs.episode_cap,EXCLUDED.episode_cap),
                requested_by=EXCLUDED.requested_by,working_document=EXCLUDED.working_document,
                regenerating=EXCLUDED.regenerating,attempts=0,error=NULL,lease_token=NULL,lease_until=NULL,updated_at=now()
                RETURNING *''', (media_id, Jsonb(media.model_dump()), settings.hf_model, settings.generation_episode_cap,
                                 user, Jsonb(working), operation == 'refresh' or bool(row and row['regenerating'])))
            return cursor.fetchone()

def claim() -> dict | None:
    with connection() as conn:
        conn.execute('SELECT pg_advisory_xact_lock(731904)')
        # Interrupted jobs resume only after lease expiry, with a bounded restart budget.
        conn.execute("""UPDATE public.generated_graphs SET status='failed',error='Generation interrupted repeatedly; retry required'
            WHERE status IN ('retrieving','generating') AND lease_until<now() AND attempts>=3""")
        count = conn.execute("SELECT count(*) FROM public.generated_graphs WHERE status IN ('retrieving','generating') AND lease_until>now()").fetchone()[0]
        if count >= settings.generation_max_concurrent: return None
        with conn.cursor(row_factory=dict_row) as cursor:
            row = cursor.execute("""SELECT * FROM public.generated_graphs WHERE status='queued' OR
                (status IN ('retrieving','generating') AND lease_until<now() AND attempts<3)
                ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED""").fetchone()
            if not row: return None
            token = str(uuid.uuid4())
            return cursor.execute("""UPDATE public.generated_graphs SET status='retrieving',lease_token=%s,
                lease_until=now()+make_interval(secs => %s),attempts=attempts+1,updated_at=now()
                WHERE media_id=%s RETURNING *""", (token,settings.generation_lease_seconds,row['media_id'])).fetchone()

def checkpoint(row: dict, document: dict, state: str, error: str | None = None, *, finish: bool = False) -> bool:
    # Refresh is staged: a failed/partial refresh never replaces a good published document.
    publish = not row['regenerating'] or (finish and state in ('ready','partial') and
        bool(document['episodes']) and all(e['status']=='done' for e in document['episodes']))
    if finish and row['regenerating'] and not publish:
        error = 'Refresh incomplete; previous cached graph retained'
    with connection() as conn:
        result = conn.execute('''UPDATE public.generated_graphs SET working_document=%s,
            document=CASE WHEN %s THEN %s ELSE document END,status=%s,error=%s,updated_at=now(),
            regenerating=CASE WHEN %s THEN false ELSE regenerating END,
            lease_until=CASE WHEN %s THEN NULL ELSE now()+make_interval(secs => %s) END
            WHERE media_id=%s AND lease_token=%s AND lease_until>now()''',
            (Jsonb(document),publish,Jsonb(document),state,error,finish and publish,finish,settings.generation_lease_seconds,row['media_id'],row['lease_token']))
        return result.rowcount == 1

def run(row: dict) -> None:
    document = row['working_document']
    heartbeat_stop = threading.Event()
    def heartbeat() -> None:
        while not heartbeat_stop.wait(30):
            try:
                with connection() as conn:
                    conn.execute('''UPDATE public.generated_graphs SET lease_until=now()+make_interval(secs => %s)
                        WHERE media_id=%s AND lease_token=%s AND status IN ('retrieving','generating') AND lease_until>now()''',
                        (settings.generation_lease_seconds,row['media_id'],row['lease_token']))
            except Exception:
                log.warning('Generation heartbeat unavailable')
    thread = threading.Thread(target=heartbeat, daemon=True); thread.start()
    try:
        entry = anilist.details(row['media_id'])
        source_episodes = episodes.get_episodes(entry,row['episode_cap'])
        if not checkpoint(row,document,'generating'): return
        for ep in sorted(source_episodes,key=lambda e:e.unit):
            previous = next((e for e in document['episodes'] if e['episode']['unit']==ep.unit),None)
            if previous and previous['status'] in ('done','missing'): continue
            item = {'episode':ep.model_dump(exclude={'description'}), 'model':row['model'],
                    'source_hash':hashlib.sha256((ep.description or '').encode()).hexdigest(), 'status':'missing', 'characters':[], 'relationships':[]}
            if ep.description and len(ep.description.split()) >= 8:
                try:
                    # Snapshot model selection for a queued run; no per-request overrides.
                    extraction = huggingface.extract_episode(ep, model=row['model'])
                    item.update(status='partial' if extraction._issues else 'done', rejected_records=extraction._issues, **extraction.model_dump())
                except Exception as error:
                    if previous and previous.get('characters'): item = dict(previous)
                    item.update(status='partial' if item['characters'] else 'failed', error='Episode extraction failed; retry available', error_type=type(error).__name__)
                    log.warning('Episode extraction failed for %s unit %s', row['media_id'], ep.unit)
            document['episodes'] = [e for e in document['episodes'] if e['episode']['unit'] != ep.unit] + [item]
            if not checkpoint(row,document,'generating'): return
        good = any(e['characters'] for e in document['episodes'] if e['status'] in ('done','partial'))
        gaps = any(e['status'] != 'done' for e in document['episodes'])
        capped = len(source_episodes) < anilist.normalize(entry).total_units
        state = ('partial' if gaps or capped else 'ready') if good else ('failed' if any(e['status'] in ('failed','partial') for e in document['episodes']) else 'empty')
        checkpoint(row,document,state,'Some episodes could not be analyzed' if gaps else None,finish=True)
    except Exception:
        log.exception('Generation failed for %s', row['media_id'])
        checkpoint(row,document,'partial' if document['episodes'] else 'failed','Episode provider or generation unavailable; retry available',finish=True)
    finally:
        heartbeat_stop.set()

def worker(stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            row = claim()
            if row: run(row); continue
        except Exception:
            log.warning('Graph worker unavailable; configure storage and run app.init_db')
        stop.wait(5)

def graph_data(document: dict) -> tuple[list[Entity],list[Relationship]]:
    entities, edges = [], []; names: dict[str,str] = {}; seen_edges = set()
    def identity(name: str) -> str:
        key = name.casefold().strip()
        if key not in names and len(key.split()) == 1:
            candidates = {value for name,value in names.items() if len(name.split()) > 1 and key in name.split()}
            if len(candidates) == 1: names[key] = candidates.pop()
        return names.setdefault(key, hashlib.sha256(key.encode()).hexdigest()[:20])
    for item in sorted(document['episodes'],key=lambda e:e['episode']['unit']):
        if item['status'] not in ('done','partial'): continue
        ep = item['episode']; unit = ep['unit']
        def source(evidence: str) -> Provenance:
            return Provenance(source=ep['source_url'], source_unit=unit, verified=False, model=item['model'],
                              evidence=evidence, episode_number=ep['number'],source_title=ep['title'])
        for char in item['characters']:
            previous_ids = {names[a.casefold().strip()] for a in char.get('aliases', [])
                            if a.casefold().strip() in names}
            if len(previous_ids) == 1:
                names[char['name'].casefold().strip()] = previous_ids.pop()
            node_id = identity(char['name'])
            for alias in char.get('aliases',[]):
                names.setdefault(alias.casefold(),node_id)
            entities.append(Entity(id=node_id,name=char['name'],type='character',description=char['description'],
                                   revealed_at=RevealPoint(unit=unit),provenance=source(char['evidence'])))
        for edge in item['relationships']:
            a,b = identity(edge['source']),identity(edge['target']); key = (a,b,edge['type'])
            if key in seen_edges: continue
            seen_edges.add(key)
            edges.append(Relationship(id=hashlib.sha256(json.dumps(key).encode()).hexdigest()[:20],source=a,target=b,type=edge['type'],label=edge['label'],
                                      revealed_at=RevealPoint(unit=unit),provenance=source(edge['evidence'])))
    return entities,edges
