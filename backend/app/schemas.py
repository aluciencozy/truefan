from typing import Literal
from datetime import date
from pydantic import BaseModel, ConfigDict, Field, model_validator


class RevealPoint(BaseModel):
    # A canonical ordered story unit: episode, chapter, movie, or curated game milestone.
    unit: int = Field(ge=0)


class UserProgress(BaseModel):
    media_id: str
    progress: RevealPoint


class MediaReleaseDate(BaseModel):
    year: int | None = Field(default=None, ge=1, le=9999)
    month: int | None = Field(default=None, ge=1, le=12)
    day: int | None = Field(default=None, ge=1, le=31)

    @model_validator(mode='after')
    def valid_full_date(self) -> 'MediaReleaseDate':
        if self.year is not None and self.month is not None and self.day is not None:
            date(self.year, self.month, self.day)
        return self


class TrendingCover(BaseModel):
    id: int = Field(gt=0)
    cover_url: str = Field(pattern=r'^https://s4\.anilist\.co/')


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
    release_date: MediaReleaseDate | None = None
    total_units_known: bool = False

    @model_validator(mode='after')
    def canonical_prologue_total(self) -> 'Media':
        if self.id == 'anilist-19603' and self.has_prologue and self.total_units == 12:
            self.total_units = 13
        return self


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
    portrait_url: str | None = None
    portrait_large_url: str | None = None


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


class UniverseCache(BaseModel):
    refreshed_at: str | None = None
    stale: bool = False
    incomplete: bool = True
    revision: int = Field(default=0, ge=0)
    can_expand: bool = False
    limitations: list[str] = Field(default_factory=list)


class Universe(BaseModel):
    root_id: str
    media: list[Media]
    relationships: list[UniverseEdge]
    truncated: bool = False
    franchise_id: str | None = None
    cache: UniverseCache | None = None


class UniverseSearchResult(BaseModel):
    franchise_id: str
    title: str
    entry_media_id: str
    cover_url: str | None = None


class UniverseSearchResponse(BaseModel):
    results: list[UniverseSearchResult]
    auto_open: bool = False


class UniverseExpandRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=0)
    node_limit: int | None = Field(default=None, ge=1, le=50)
    depth: int | None = Field(default=None, ge=0, le=2)


class UserMediaState(BaseModel):
    media_id: str
    progress: RevealPoint | None = None
    completed: bool = False
    manual_unlocked: bool = False


class UserMediaStateUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    completed: bool | None = None
    manual_unlocked: bool | None = None

    @model_validator(mode='after')
    def supplied_flags(self) -> 'UserMediaStateUpdate':
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError('Supply at least one boolean flag')
        return self

GraphResponse.model_rebuild()
