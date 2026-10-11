"""Private profile contracts. Titles, counts and covers only; no character facts, names or emails."""
from datetime import datetime
from pydantic import BaseModel, ConfigDict
from app.library_models import SavedUniverse


class Rank(BaseModel):
    id: str
    title: str
    min_points: int
    badge: str | None = None


class Badge(BaseModel):
    id: str
    title: str
    image: str
    earned_at: datetime


class Breakdown(BaseModel):
    """Points contributed by each rule."""
    world_completed: int
    universe_completed: int
    universe_saved: int
    community_post: int


class Stats(BaseModel):
    universes_saved: int
    worlds_completed: int
    universes_completed: int
    estimated_minutes_watched: int


class Profile(BaseModel):
    points: int
    rank: Rank
    next_rank: Rank | None = None
    points_to_next: int
    breakdown: Breakdown
    stats: Stats
    favorite: SavedUniverse | None = None
    badges: list[Badge]
    ranks: list[Rank]


class ProfileUpdate(BaseModel):
    """`favorite_media_id` is required: null clears the favorite."""
    model_config = ConfigDict(extra='forbid', strict=True)
    favorite_media_id: str | None
