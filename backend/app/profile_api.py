from typing import Annotated
from fastapi import APIRouter, Depends
from app.auth import current_user
from app.schemas import CurrentUser
from app.profile_models import Profile, ProfileUpdate
from app.services import profile

router = APIRouter(prefix='/api/me/profile', tags=['Profile'])
Owner = Annotated[CurrentUser, Depends(current_user)]


@router.get('', response_model=Profile)
def read(user: Owner) -> Profile:
    return profile.read(user.id)


@router.put('', response_model=Profile)
def update(request: ProfileUpdate, user: Owner) -> Profile:
    return profile.set_favorite(user.id, request.favorite_media_id)
