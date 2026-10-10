from typing import Annotated
from contextlib import asynccontextmanager
import threading
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query
from app.auth import current_user
from app.schemas import CurrentUser, UserProgress
from app.services import progress as progress_service
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.schemas import (AskRequest, ExtractRequest, GraphResponse, HealthResponse,
                         Media, PlaceholderResponse, RevealPoint)
from app.services.demo import ENTITIES, MEDIA, RELATIONSHIPS
from app.services.graph import filter_graph
from app.services import anilist, generation, franchises, universe_search
from app.schemas import (Universe, GenerationStatus, UniverseExpandRequest,
                         UserMediaState, UserMediaStateUpdate, UniverseSearchResponse)

@asynccontextmanager
async def lifespan(app: FastAPI):
    stop = threading.Event()
    threads = []
    if settings.database_url and settings.hf_token:
        for _ in range(settings.generation_max_concurrent):
            thread = threading.Thread(target=generation.worker, args=(stop,), daemon=True)
            thread.start(); threads.append(thread)
    yield
    stop.set()

app = FastAPI(lifespan=lifespan, title="Spoiler-Aware Media Knowledge Graph", version="0.1.0")
from app.community_api import router as community_router
app.include_router(community_router)
from app.library_api import router as library_router
app.include_router(library_router)
app.add_middleware(CORSMiddleware,
                   allow_origins=[settings.frontend_url.rstrip("/")],
                   allow_methods=["GET", "POST", "PUT"], allow_headers=["Content-Type", "Authorization"])


def get_media(media_id: str) -> Media:
    if media_id == MEDIA.id:
        return MEDIA
    if settings.database_url:
        try:
            from app.database import connection
            with connection() as conn:
                row = conn.execute('SELECT media FROM public.generated_graphs WHERE media_id=%s', (media_id,)).fetchone()
            if row: return Media.model_validate(row[0])
        except (RuntimeError, psycopg.Error):
            pass
    try:
        local = franchises.cached_media(media_id)
        if local:
            return local
    except (RuntimeError, psycopg.Error):
        pass
    try:
        return anilist.normalize(anilist.details(media_id))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(404, 'Media unavailable or not found') from None

# Existing placeholder endpoints keep their demo-only contract.
def get_demo(media_id: str) -> Media:
    if media_id != MEDIA.id:
        raise HTTPException(404, 'Media not found')
    return MEDIA

def cached_generation(media_id: str) -> dict | None:
    try:
        return generation.get(media_id)
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Graph cache unavailable; configure DATABASE_URL and run python -m app.init_db') from None


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse()


@app.get("/api/media/search", response_model=list[Media])
def search_media(q: str = Query(default="", max_length=200)):
    if not q.strip(): return [MEDIA]
    demo = [MEDIA] if q.casefold() in MEDIA.title.casefold() else []
    try: return demo + anilist.search_media(q)
    except (ValueError, KeyError, TypeError):
        try:
            local = franchises.search_local(q)
        except (RuntimeError, psycopg.Error):
            local = []
        if demo or local: return demo + local
        raise HTTPException(502, 'AniList search unavailable; try again shortly') from None


@app.get('/api/universes/search', response_model=UniverseSearchResponse)
def search_universes(q: str = Query(default='', max_length=200), discover: bool = False) -> UniverseSearchResponse:
    try:
        return universe_search.search(q, discover)
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Universe search unavailable; check the franchise cache and try again') from None
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Universe discovery unavailable; try again shortly') from None


@app.get("/api/media/{media_id}", response_model=Media)
def media_details(media_id: str):
    return get_media(media_id)


@app.get("/api/media/{media_id}/graph", response_model=GraphResponse)
def media_graph(media_id: str, progress: int = Query(ge=0)):
    media = get_media(media_id)
    if progress > media.total_units:
        raise HTTPException(status_code=422, detail="Progress exceeds this media’s total units")
    if media_id == MEDIA.id:
        return filter_graph(media_id, RevealPoint(unit=progress), ENTITIES, RELATIONSHIPS)
    row = cached_generation(media_id)
    entities, edges = generation.graph_data(row['document']) if row else ([], [])
    graph = filter_graph(media_id, RevealPoint(unit=progress), entities, edges)
    graph.experimental = True
    graph.generation = generation.status(row)
    # Enrich only the episode-filtered graph; the full cast and aliases stay server-side.
    return anilist.character_portraits(graph, media.anilist_id)


@app.post("/api/extract", response_model=PlaceholderResponse, status_code=501)
def extract(request: ExtractRequest):
    get_demo(request.media_id)
    return PlaceholderResponse(message="Extraction is not implemented. No provider call or database write occurred.")


@app.post("/api/ask", response_model=PlaceholderResponse, status_code=501)
def ask(request: AskRequest):
    get_demo(request.media_id)
    return PlaceholderResponse(message="Spoiler-safe Q&A is not implemented; no answer was generated.")


@app.get("/api/me", response_model=CurrentUser)
def me(user: Annotated[CurrentUser, Depends(current_user)]):
    return user


@app.get("/api/me/progress/{media_id}", response_model=UserProgress | None)
def read_progress(media_id: str, user: Annotated[CurrentUser, Depends(current_user)]):
    get_media(media_id)
    return progress_service.get_progress(user.id, media_id)


@app.put("/api/me/progress/{media_id}", response_model=UserProgress)
def write_progress(media_id: str, progress: RevealPoint,
                   user: Annotated[CurrentUser, Depends(current_user)]):
    media = get_media(media_id)
    if progress.unit > media.total_units:
        raise HTTPException(422, "Progress exceeds this media’s total units")
    return progress_service.save_progress(user.id, UserProgress(media_id=media_id, progress=progress), media)


@app.get('/api/me/media-state', response_model=list[UserMediaState])
def read_media_states(user: Annotated[CurrentUser, Depends(current_user)],
                      media_id: Annotated[list[str], Query(min_length=1, max_length=50)]):
    if len(set(media_id)) != len(media_id) or any(not item.strip() or len(item) > 200 for item in media_id):
        raise HTTPException(422, 'Request 1–50 unique nonempty media IDs')
    return progress_service.get_media_states(user.id, media_id)


@app.put('/api/me/media-state/{media_id}', response_model=UserMediaState)
def write_media_state(media_id: str, update: UserMediaStateUpdate,
                      user: Annotated[CurrentUser, Depends(current_user)]):
    get_media(media_id)
    return progress_service.update_media_state(user.id, media_id, update)


@app.get('/api/media/{media_id}/universe', response_model=Universe)
def media_universe(media_id: str):
    if media_id == MEDIA.id:
        return Universe(root_id=media_id, media=[MEDIA], relationships=[])
    try: return franchises.universe(media_id)
    except (ValueError, KeyError, TypeError):
        raise HTTPException(502, 'Universe metadata temporarily unavailable') from None


@app.post('/api/media/{media_id}/universe/expand', response_model=Universe)
def expand_universe(media_id: str, request: UniverseExpandRequest):
    return franchises.expand(media_id, request)


@app.get('/api/media/{media_id}/generation', response_model=GenerationStatus)
def generation_status(media_id: str):
    get_media(media_id)
    return generation.status(cached_generation(media_id))


@app.post('/api/media/{media_id}/generation', response_model=GenerationStatus, status_code=202)
def generate_graph(media_id: str, request: generation.GenerationRequest,
                   user: Annotated[CurrentUser, Depends(current_user)]):
    if media_id == MEDIA.id: raise HTTPException(409, 'The demo graph does not require generation')
    get_media(media_id)
    try: return generation.status(generation.enqueue(media_id,user.id,request.operation))
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Graph storage unavailable; run python -m app.init_db') from None
    except ValueError:
        raise HTTPException(502, 'Media provider unavailable') from None
