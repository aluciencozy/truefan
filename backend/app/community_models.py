from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

Category = Literal['discussion', 'theory', 'review']


class PostCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    category: Category = 'discussion'
    media: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=5000)
    contains_spoilers: bool = False
    rating: int | None = Field(default=None, ge=1, le=5)

    @field_validator('media', 'title', 'body')
    @classmethod
    def nonblank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError('Text cannot be blank')
        return value


class CommentCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    body: str = Field(min_length=1, max_length=2000)
    contains_spoilers: bool = False
    _nonblank = field_validator('body')(PostCreate.nonblank.__func__)


class LikeUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    liked: bool


class CommunityPost(PostCreate):
    id: UUID
    author: str
    created_at: datetime
    likes: int = 0
    comments: int = 0
    liked: bool = False
    example: bool = False


class CommunityComment(BaseModel):
    id: UUID
    author: str
    body: str
    contains_spoilers: bool
    created_at: datetime


class CommunityFeed(BaseModel):
    posts: list[CommunityPost]
    media: list[str]
    active_fans: int
    has_more: bool = False


class PresenceRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    visitor_id: UUID
    page: Category = 'discussion'


class PresenceResponse(BaseModel):
    active_fans: int
    window_seconds: int = 90


class LibraryItem(BaseModel):
    media_id: str
    title: str
    completed: bool
