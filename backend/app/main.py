from typing import Annotated
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

app = FastAPI(title="Spoiler-Aware Media Knowledge Graph", version="0.1.0")
# Explicit origins only (never "*"): credentials and the Authorization header are in play.
ALLOWED_ORIGINS = list(dict.fromkeys(
    ["http://localhost:3000", "http://127.0.0.1:3000", settings.frontend_url.rstrip("/")]))
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


def get_demo(media_id: str) -> Media:
    if media_id != MEDIA.id:
        raise HTTPException(status_code=404, detail="Media not found")
    return MEDIA


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse()


@app.get("/api/media/search", response_model=list[Media])
def search_media(q: str = Query(default="", max_length=200)):
    return [MEDIA] if q.casefold() in MEDIA.title.casefold() else []


@app.get("/api/media/{media_id}", response_model=Media)
def media_details(media_id: str):
    return get_demo(media_id)


@app.get("/api/media/{media_id}/graph", response_model=GraphResponse)
def media_graph(media_id: str, progress: int = Query(ge=0)):
    media = get_demo(media_id)
    if progress > media.total_units:
        raise HTTPException(status_code=422, detail="Progress exceeds this media’s total units")
    return filter_graph(media_id, RevealPoint(unit=progress), ENTITIES, RELATIONSHIPS)


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
    get_demo(media_id)
    return progress_service.get_progress(user.id, media_id)


@app.put("/api/me/progress/{media_id}", response_model=UserProgress)
def write_progress(media_id: str, progress: RevealPoint,
                   user: Annotated[CurrentUser, Depends(current_user)]):
    media = get_demo(media_id)
    if progress.unit > media.total_units:
        raise HTTPException(422, "Progress exceeds this media’s total units")
    return progress_service.save_progress(user.id, UserProgress(media_id=media_id, progress=progress))
