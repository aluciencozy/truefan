from collections import OrderedDict, deque
import threading
import time
from app.config import settings
from app.schemas import Media, Universe, UniverseEdge
from app.services.http import fetch

FIELDS = 'id type chapters idMal title{romaji english} format episodes startDate{year} coverImage{medium}'
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_lock = threading.Lock()


def query(query_text: str, variables: dict) -> dict:
    key = str((query_text, variables))
    with _lock:
        cached = _cache.get(key)
        if cached and time.monotonic() - cached[0] < 3600:
            return cached[1]
    result = fetch(settings.anilist_api_url, {'query': query_text, 'variables': variables})
    if result.get('errors') or not result.get('data'):
        raise ValueError('AniList returned an invalid response')
    with _lock:
        _cache[key] = (time.monotonic(), result['data'])
        if len(_cache) > 256:
            _cache.popitem(last=False)
    return result['data']


def normalize(entry: dict) -> Media:
    # Do not expose provider-wide plot synopses in a progress-aware interface.
    prologue = entry['id'] == 19603
    manga = entry.get('type') == 'MANGA'
    return Media(id=f"anilist-{entry['id']}", anilist_id=entry['id'],
                 format=entry.get('format'), title=entry['title'].get('english') or entry['title']['romaji'], type='manga' if manga else 'anime',
                 total_units=(entry.get('chapters') if manga else entry.get('episodes')) or 1, description='AniList media entry. Story knowledge is generated separately.',
                 progress_unit='chapter' if manga else 'episode', has_prologue=prologue, cover_url=(entry.get('coverImage') or {}).get('medium'))


def details(media_id: str) -> dict:
    if not media_id.startswith('anilist-') or not media_id[8:].isdigit():
        raise ValueError('Invalid AniList media identifier')
    return query('query($id:Int){Media(id:$id){' + FIELDS + ' relations{edges{relationType node{' + FIELDS + '}}}}}',
                 {'id': int(media_id[8:])})['Media']


def search_media(search: str) -> list[Media]:
    data = query('query($q:String){Page(page:1,perPage:10){media(search:$q,type:ANIME,isAdult:false){' + FIELDS + '}}}', {'q': search})
    return [normalize(row) for row in data['Page']['media']]


def universe(media_id: str) -> Universe:
    queue = deque([(media_id, 0)])
    nodes: dict[str, Media] = {}
    edges: dict[tuple, UniverseEdge] = {}
    visited = set()
    truncated = False
    while queue and len(visited) < settings.universe_node_cap:
        current, depth = queue.popleft()
        if current in visited:
            continue
        visited.add(current)
        entry = details(current)
        nodes[current] = normalize(entry)
        for edge in entry['relations']['edges']:
            other = normalize(edge['node'])
            if other.id not in nodes and len(nodes) >= settings.universe_node_cap:
                truncated = True
                continue
            nodes[other.id] = other
            key = (current, other.id, edge['relationType'])
            edges[key] = UniverseEdge(source=current, target=other.id, type=edge['relationType'])
            if depth < settings.universe_depth and other.id not in visited:
                queue.append((other.id, depth + 1))
            elif other.id not in visited:
                truncated = True
    return Universe(root_id=media_id, media=list(nodes.values()), relationships=list(edges.values()), truncated=truncated or bool(queue))
