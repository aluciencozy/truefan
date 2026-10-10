"""Cached franchise suggestions; bounded discovery only on explicit search."""
import re
from psycopg.rows import dict_row
from app.database import connection
from app.schemas import Media, UniverseSearchResponse, UniverseSearchResult
from app.services import anilist, franchises


def normalize(text: str) -> str:
    return re.sub(r'[\W_]+', ' ', text.casefold()).strip()


def score(query: str, title: str) -> int:
    title = normalize(title)
    return 3 if title == query else 2 if title.startswith(query + ' ') else 1 if query in title else 0


def universe_title(display_name: str) -> str:
    # shortcut: stored names are provisional; replace this formatting when canonical names are available.
    name = display_name.split('/', 1)[0].strip()
    name = re.sub(r'\s+(?:\d+(?:st|nd|rd|th)\s+)?season(?:\s+\d+)?(?:\s+part\s+\d+)?$', '', name, flags=re.I)
    return name + ' Universe'


def cached_matches(query: str) -> list[tuple[int, UniverseSearchResult]]:
    with connection() as conn:
        with conn.cursor(row_factory=dict_row) as cursor:
            rows = cursor.execute('''SELECT f.id, f.display_name, m.media
                FROM public.franchises f JOIN public.franchise_media m ON m.franchise_id=f.id
                WHERE f.merged_into IS NULL AND (f.discovery->'strong_ids') ? m.media_id
                  AND m.media->>'type'='anime'
                  AND (strpos(regexp_replace(lower(m.media->>'title'), '[^[:alnum:]]+', ' ', 'g'), %s)>0
                    OR strpos(regexp_replace(lower(f.display_name), '[^[:alnum:]]+', ' ', 'g'), %s)>0)
                ORDER BY f.id, m.media_id''', (query, query)).fetchall()
    groups: dict[str, tuple[int, Media, str]] = {}
    for row in rows:
        media = Media.model_validate(row['media'])
        title = universe_title(row['display_name'])
        relevance = max(score(query, media.title), score(query, title.removesuffix(' Universe')))
        if not relevance:
            continue
        previous = groups.get(row['id'])
        if previous and (score(query, previous[1].title), -len(previous[1].title)) >= (score(query, media.title), -len(media.title)):
            continue
        groups[row['id']] = (relevance, media, title)
    results = [(rank, UniverseSearchResult(franchise_id=key, title=title,
                entry_media_id=media.id, cover_url=media.cover_url))
               for key, (rank, media, title) in groups.items()]
    return sorted(results, key=lambda match: (-match[0], match[1].title, match[1].franchise_id))


def response(matches: list[tuple[int, UniverseSearchResult]], complete: bool = True) -> UniverseSearchResponse:
    unambiguous = bool(matches) and (len(matches) == 1 or matches[0][0] > matches[1][0])
    return UniverseSearchResponse(results=[item for _, item in matches[:5]], auto_open=complete and unambiguous)


def search(text: str, discover: bool = False) -> UniverseSearchResponse:
    query = normalize(text).removesuffix(' universe').strip()
    if not query:
        return UniverseSearchResponse(results=[])
    matches = cached_matches(query)
    if matches or not discover:
        return response(matches)
    candidates = anilist.search_media(text.strip())
    candidates = [item for item in candidates if score(query, item.title)]
    if not candidates:
        return response([])
    strongest = max(score(query, item.title) for item in candidates)
    candidates = sorted((item for item in candidates if score(query, item.title) == strongest),
                        key=lambda item: (len(item.title), item.id))
    discoveries = 0
    complete = True
    for candidate in candidates:
        if franchises.load(candidate.id):
            continue
        if discoveries == 3:
            complete = False
            continue
        discovered = franchises.universe(candidate.id)
        if not discovered.franchise_id:
            raise RuntimeError('Franchise discovery could not be cached')
        discoveries += 1
    return response(cached_matches(query), complete)
