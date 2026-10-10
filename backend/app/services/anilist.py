from app.config import settings


def search_media(query: str):
    """Future server-side GraphQL search against settings.anilist_api_url.

    Normalize provider IDs into Media; do not expose unfiltered character biographies.
    """
    raise NotImplementedError(f"AniList integration pending: {settings.anilist_api_url}")
