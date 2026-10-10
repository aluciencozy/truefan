from typing import Annotated
from fastapi import APIRouter, Depends, Path
from app.auth import current_user
from app.schemas import CurrentUser
from app.library_models import AbandonResult, SavedUniverse, UniversePreferences
from app.services import library

router = APIRouter(prefix='/api/me/universes', tags=['Saved universes'])
Owner = Annotated[CurrentUser, Depends(current_user)]
MediaId = Annotated[str, Path(pattern=r'^(anilist-[1-9][0-9]*|lantern-harbor)$', max_length=200)]


@router.get('', response_model=list[SavedUniverse])
def list_saved(user: Owner) -> list[SavedUniverse]:
    return library.list_saved(user.id)


@router.post('/{media_id}', response_model=SavedUniverse)
def save(media_id: MediaId, user: Owner) -> SavedUniverse:
    return library.save(user.id, media_id)


@router.put('/{media_id}', response_model=SavedUniverse)
def preferences(media_id: MediaId, request: UniversePreferences, user: Owner) -> SavedUniverse:
    return library.update(user.id, media_id, request)


@router.post('/{media_id}/abandon', response_model=AbandonResult)
def abandon(media_id: MediaId, user: Owner) -> AbandonResult:
    return library.update(user.id, media_id, None)
