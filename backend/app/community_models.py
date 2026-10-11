from datetime import datetime
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Category = Literal['discussion', 'theory', 'review']
Room = Literal['courtroom', 'fanfiction', 'drawing', 'battle', 'capsule', 'ending', 'mystery', 'pitch', 'verdict', 'hot-take', 'matchmaking']
ROOM_CATEGORIES = {'courtroom': 'discussion', 'fanfiction': 'discussion', 'drawing': 'discussion',
                  'battle': 'theory', 'capsule': 'theory', 'ending': 'theory', 'mystery': 'theory',
                  'pitch': 'review', 'verdict': 'review', 'hot-take': 'review', 'matchmaking': 'review'}


class PostCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    category: Category = 'discussion'
    media: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(min_length=1, max_length=5000)
    contains_spoilers: bool = False
    rating: int | None = Field(default=None, ge=1, le=5)
    room: Room | None = None
    side_a: str = Field(default='Prosecution', min_length=1, max_length=80)
    side_b: str = Field(default='Defense', min_length=1, max_length=80)
    target_episode: int = Field(default=1, ge=1, le=10000)

    @model_validator(mode='after')
    def room_category(self) -> 'PostCreate':
        if self.room and ROOM_CATEGORIES[self.room] != self.category:
            raise ValueError('Room does not belong to this category')
        if self.room == 'pitch' and len([s for s in re.split(r'[.!?]+', self.body) if s.strip()]) > 3:
            raise ValueError('A pitch can contain at most three sentences')
        return self

    @field_validator('media', 'title', 'body', 'side_a', 'side_b')
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
    is_owner: bool = False


class CommunityComment(BaseModel):
    is_owner: bool = False
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


class EntryCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Literal['contribution', 'join', 'vote', 'prediction', 'clue', 'art', 'recommendation', 'impression'] = 'contribution'
    body: str = Field(default='', max_length=5000)
    side: Literal['a', 'b', 'believable', 'devastating', 'neutral'] = 'neutral'
    source: str = Field(default='', max_length=200)
    artwork: str = Field(default='', max_length=700000)
    connects_to: UUID | None = None
    contains_spoilers: bool = False

    @model_validator(mode='after')
    def validate_content(self) -> 'EntryCreate':
        if self.kind not in ('join', 'vote') and not self.body.strip():
            raise ValueError('Write your contribution first')
        if self.kind in ('join', 'vote') and self.side == 'neutral':
            raise ValueError('Choose a side')
        if self.artwork:
            import base64, re
            match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', self.artwork)
            if not match:
                raise ValueError('Upload a PNG, JPEG, or WebP image')
            try:
                data = base64.b64decode(match[2], validate=True)
            except ValueError:
                raise ValueError('Invalid image') from None
            valid = (match[1] == 'png' and data.startswith(b'\x89PNG\r\n\x1a\n') or
                     match[1] == 'jpeg' and data.startswith(b'\xff\xd8\xff') or
                     match[1] == 'webp' and data.startswith(b'RIFF') and data[8:12] == b'WEBP')
            if not valid or len(data) > 500000:
                raise ValueError('Use a valid image under 500 KB')
        return self


class ForumEntry(EntryCreate):
    id: UUID
    author: str
    created_at: datetime
    is_owner: bool = False
    locked: bool = False
    revealed: bool = False
    tried: bool = False


class EntryAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    action: Literal['lock', 'reveal', 'tried']
