from typing import Literal
from pydantic import BaseModel, Field


class RevealPoint(BaseModel):
    # A canonical ordered story unit: episode, chapter, movie, or curated game milestone.
    unit: int = Field(ge=0)


class UserProgress(BaseModel):
    media_id: str
    progress: RevealPoint


class Media(BaseModel):
    id: str
    title: str
    type: Literal["anime", "tv", "manga", "game", "movie"]
    progress_unit: Literal["episode", "chapter", "movie", "milestone"]
    total_units: int = Field(gt=0)
    description: str
    anilist_id: int | None = None
    has_prologue: bool = False
    cover_url: str | None = None
    format: str | None = None


class Provenance(BaseModel):
    source: str
    source_unit: int = Field(ge=0)
    verified: bool = False
    model: str | None = None
    evidence: str | None = None
    episode_number: int | None = None
    source_title: str | None = None


class Entity(BaseModel):
    id: str
    name: str
    type: Literal["character", "faction", "location", "object"]
    description: str
    revealed_at: RevealPoint
    provenance: Provenance


class Relationship(BaseModel):
    label: str | None = None
    id: str
    source: str
    target: str
    type: str
    revealed_at: RevealPoint
    provenance: Provenance


class GraphResponse(BaseModel):
    experimental: bool = False
    generation: "GenerationStatus | None" = None
    media_id: str
    progress: RevealPoint
    entities: list[Entity]
    relationships: list[Relationship]


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    mode: Literal["demo"] = "demo"


class ExtractRequest(BaseModel):
    media_id: str
    summary: str = Field(min_length=1, max_length=20000)
    source: str = Field(min_length=1, max_length=2000)
    reveal_point: RevealPoint


class AskRequest(UserProgress):
    question: str = Field(min_length=1, max_length=2000)


class PlaceholderResponse(BaseModel):
    status: Literal["not_implemented"] = "not_implemented"
    message: str


class CurrentUser(BaseModel):
    id: str = Field(min_length=1)


class GenerationStatus(BaseModel):
    status: Literal["not_generated", "queued", "retrieving", "generating", "ready", "partial", "empty", "failed"]
    processed_units: int = 0
    supported_units: list[int] = Field(default_factory=list)
    episode_cap: int = 0
    error: str | None = None
    updated_at: str | None = None
    experimental: bool = True


class UniverseEdge(BaseModel):
    source: str
    target: str
    type: str


class Universe(BaseModel):
    root_id: str
    media: list[Media]
    relationships: list[UniverseEdge]
    truncated: bool = False

GraphResponse.model_rebuild()
