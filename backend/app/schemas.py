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


class GraphExtractRequest(BaseModel):
    summary: str = Field(min_length=1, max_length=8000)
    source: str = Field(min_length=1, max_length=2000)
    reveal_point: RevealPoint  # where the pasted text's facts are revealed
    progress: RevealPoint  # the viewer's progress; nothing beyond it is returned


class FlowPosition(BaseModel):
    x: float
    y: float


class FlowItemData(BaseModel):
    revealed_at: RevealPoint
    provenance: Provenance


class FlowNodeData(FlowItemData):
    label: str
    entity_type: str
    description: str


class FlowNode(BaseModel):
    id: str
    position: FlowPosition
    data: FlowNodeData


class FlowEdge(BaseModel):
    id: str
    source: str
    target: str
    label: str
    data: FlowItemData


class FlowGraphResponse(BaseModel):
    media_id: str
    progress: RevealPoint
    # "ai" = model output from the pasted text (unverified); "database"/"builtin" = curated fallback.
    origin: Literal["ai", "database", "builtin"]
    nodes: list[FlowNode]
    edges: list[FlowEdge]
