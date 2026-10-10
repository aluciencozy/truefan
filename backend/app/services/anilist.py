from collections import OrderedDict, deque
from dataclasses import dataclass
import threading
import time
from app.config import settings
from app.schemas import Media, MediaReleaseDate, Universe, UniverseEdge
from app.services.http import fetch

FIELDS = 'id type chapters idMal title{romaji english} format episodes startDate{year month day} coverImage{medium}'
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
    count = entry.get('chapters') if manga else entry.get('episodes')
    known = isinstance(count, int) and count > 0
    raw_date = entry.get('startDate') or {}
    release = MediaReleaseDate.model_validate(raw_date) if any(raw_date.values()) else None
    return Media(id=f"anilist-{entry['id']}", anilist_id=entry['id'],
                 format=entry.get('format'), title=entry['title'].get('english') or entry['title']['romaji'], type='manga' if manga else 'anime',
                 total_units=count + int(prologue) if known else 1, total_units_known=known, release_date=release,
                 description='AniList media entry. Story knowledge is generated separately.',
                 progress_unit='chapter' if manga else 'episode', has_prologue=prologue, cover_url=(entry.get('coverImage') or {}).get('medium'))


def details(media_id: str) -> dict:
    if not media_id.startswith('anilist-') or not media_id[8:].isdigit():
        raise ValueError('Invalid AniList media identifier')
    return query('query($id:Int){Media(id:$id){' + FIELDS + ' relations{edges{relationType node{' + FIELDS + '}}}}}',
                 {'id': int(media_id[8:])})['Media']


def search_media(search: str) -> list[Media]:
    data = query('query($q:String){Page(page:1,perPage:10){media(search:$q,type:ANIME,isAdult:false){' + FIELDS + '}}}', {'q': search})
    return [normalize(row) for row in data['Page']['media']]


# Evidence for provisional membership only, never watch prerequisites.
STRONG_RELATIONS = frozenset({'PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'SPIN_OFF',
                              'PARENT', 'SIDE_STORY', 'ADAPTATION', 'SOURCE'})


@dataclass
class Discovery:
    graph: Universe
    expanded: set[str]
    strong_ids: set[str]
    frontier: set[str]
    limitations: set[str]
    observed_ids: set[str]
    node_limit: int | None = None
    depth_limit: int | None = None


def discover(media_id: str, *, seed: Universe | None = None,
             expanded: set[str] | None = None, strong_ids: set[str] | None = None,
             frontier: set[str] | None = None, node_limit: int | None = None,
             depth_limit: int | None = None, frontier_offset: int = 0) -> Discovery:
    cap = node_limit if node_limit is not None else settings.universe_node_cap
    max_depth = depth_limit if depth_limit is not None else settings.universe_depth
    nodes = {m.id: m for m in seed.media} if seed else {}
    edges = {(e.source, e.target, e.type): e for e in seed.relationships} if seed else {}
    fetched = set(expanded or ())
    strong = set(strong_ids or {media_id})
    pending = set(frontier if frontier is not None else {media_id}) - fetched
    ordered = sorted(pending)
    offset = frontier_offset % len(ordered) if ordered else 0
    queue = deque((item, 0) for item in ordered[offset:] + ordered[:offset])
    visited: set[str] = set()
    observed: set[str] = set()
    limits = {'inferred_membership'}
    while queue and len(visited) < cap:
        current, depth = queue.popleft()
        if current in fetched or current in visited:
            continue
        if current not in nodes and len(nodes) >= cap:
            limits.add('node_cap')
            continue
        visited.add(current)
        entry = details(current)
        media = normalize(entry)
        if media.id != current:
            raise ValueError('AniList returned a different media ID')
        nodes[current] = media
        observed.add(current)
        admitted_all = True
        relations = sorted(entry.get('relations', {}).get('edges', []),
                           key=lambda edge: (edge['relationType'] not in STRONG_RELATIONS,
                                             edge['node']['id'], edge['relationType']))
        for edge in relations:
            other = normalize(edge['node'])
            kind = edge['relationType']
            if other.id not in nodes and len(nodes) >= cap:
                limits.add('node_cap')
                admitted_all = False
                continue
            # A fully fetched snapshot wins over neighbor metadata.
            if other.id not in fetched and other.id not in visited:
                nodes[other.id] = other
                observed.add(other.id)
            key = (current, other.id, kind)
            edges[key] = UniverseEdge(source=current, target=other.id, type=kind)
            if kind in STRONG_RELATIONS:
                strong.add(other.id)
                if other.id not in fetched and other.id not in visited:
                    if depth < max_depth:
                        queue.append((other.id, depth + 1))
                    else:
                        limits.add('depth_cap')
            else:
                limits.add('boundary_associations')
        if admitted_all:
            fetched.add(current)
    pending = strong - fetched
    if pending:
        limits.add('partial_relations')
    if len(nodes) >= cap and pending:
        limits.add('node_cap')
    if any(m.release_date is None or None in (m.release_date.year, m.release_date.month, m.release_date.day)
           for m in nodes.values()):
        limits.add('unknown_dates')
    graph = Universe(root_id=media_id, media=[nodes[key] for key in sorted(nodes)],
                     relationships=[edges[key] for key in sorted(edges)],
                     truncated=bool(pending) or 'node_cap' in limits)
    return Discovery(graph, fetched, strong, pending, limits, observed, cap, max_depth)


def universe(media_id: str) -> Universe:
    return discover(media_id).graph
