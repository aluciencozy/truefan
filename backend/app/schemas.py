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


class Provenance(BaseModel):
    source: str
    source_unit: int = Field(ge=0)
    verified: bool = False


class Entity(BaseModel):
    id: str
    name: str
    type: Literal["character", "faction", "location", "object"]
    description: str
    revealed_at: RevealPoint
    provenance: Provenance


class Relationship(BaseModel):
    id: str
    source: str
    target: str
    type: str
    revealed_at: RevealPoint
    provenance: Provenance


class GraphResponse(BaseModel):
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
