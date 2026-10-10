from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import bearer, current_user
from app.schemas import CurrentUser
from app.community_models import (Category, CommentCreate, CommunityComment, CommunityFeed,
                                   CommunityPost, LikeUpdate, PostCreate, PresenceRequest, PresenceResponse, LibraryItem)
from app.services import community

router = APIRouter(prefix='/api/community', tags=['Community'])


def optional_user(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]) -> CurrentUser | None:
    return current_user(credentials) if credentials else None


@router.get('/posts', response_model=CommunityFeed)
def feed(user: Annotated[CurrentUser | None, Depends(optional_user)], category: Category | None = None,
         media: str = Query(default='', max_length=200), q: str = Query(default='', max_length=200),
         sort: Literal['latest', 'popular'] = 'latest', include_spoilers: bool = False,
         offset: int = Query(default=0, ge=0, le=10000)) -> CommunityFeed:
    return community.feed(category,media,q,sort,include_spoilers,user.id if user else None,offset)


@router.post('/posts', response_model=CommunityPost, status_code=201)
def create_post(request: PostCreate, user: Annotated[CurrentUser, Depends(current_user)]) -> CommunityPost:
    return community.create_post(user.id,request)


@router.get('/posts/{post_id}', response_model=CommunityPost)
def post(post_id: UUID, user: Annotated[CurrentUser | None, Depends(optional_user)], include_spoilers: bool = False) -> CommunityPost:
    return community.read_post(post_id,user.id if user else None,include_spoilers)


@router.put('/posts/{post_id}/like', response_model=CommunityPost)
def like(post_id: UUID, request: LikeUpdate, user: Annotated[CurrentUser, Depends(current_user)], include_spoilers: bool = False) -> CommunityPost:
    return community.set_like(post_id,user.id,request.liked,include_spoilers)


@router.get('/posts/{post_id}/comments', response_model=list[CommunityComment])
def comments(post_id: UUID, user: Annotated[CurrentUser | None, Depends(optional_user)], include_spoilers: bool = False) -> list[CommunityComment]:
    return community.comments(post_id,user.id if user else None,include_spoilers)


@router.post('/posts/{post_id}/comments', response_model=CommunityComment, status_code=201)
def comment(post_id: UUID, request: CommentCreate, user: Annotated[CurrentUser, Depends(current_user)], include_spoilers: bool = False) -> CommunityComment:
    return community.create_comment(post_id,user.id,request,include_spoilers)


@router.post('/presence', response_model=PresenceResponse)
def presence(request: PresenceRequest, user: Annotated[CurrentUser | None, Depends(optional_user)]) -> PresenceResponse:
    return community.heartbeat(request,user.id if user else None)


@router.get('/library', response_model=list[LibraryItem])
def library(user: Annotated[CurrentUser, Depends(current_user)]) -> list[LibraryItem]:
    return community.library(user.id)
