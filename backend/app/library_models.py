"""Private saved-universe contracts. Catalog metadata contains no character facts."""
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas import MediaReleaseDate


class LibraryTitle(BaseModel):
    media_id: str
    title: str
    cover_url: str | None = None
    type: Literal['anime', 'tv', 'manga', 'game', 'movie']
    format: str | None = None
    release_date: MediaReleaseDate | None = None
    completed: bool = False
    estimated_minutes_watched: int = Field(default=0, ge=0)


class SavedUniverse(BaseModel):
    media_id: str
    title: str
    cover_url: str | None = None
    type: Literal['anime', 'tv', 'manga', 'game', 'movie']
    format: str | None = None
    titles: list[LibraryTitle]
    viewed_count: int
    total_count: int
    coverage_incomplete: bool
    pinned: bool = False
    rating: int | None = None
    saved_at: datetime
    last_explored_at: datetime


class UniversePreferences(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    pinned: bool | None = None
    rating: int | None = Field(default=None, ge=1, le=5)

    @model_validator(mode='after')
    def has_change(self) -> 'UniversePreferences':
        if not self.model_fields_set or ('pinned' in self.model_fields_set and self.pinned is None):
            raise ValueError('Supply pinned or rating; pinned must be a boolean')
        return self


class AbandonResult(BaseModel):
    media_id: str
    abandoned: Literal[True] = True
