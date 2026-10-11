"""Owner-scoped profile: points, ranks, earned badges and the favorite universe.

Points are always derived from existing data (saved universes, user_progress via
services.library, and community posts); only earned badges and the favorite are stored.
Everything here is catalog metadata and counts, never character facts.
"""
from contextlib import contextmanager
from typing import Iterator, Sequence
import psycopg
from fastapi import HTTPException
from app.database import connection
from app.library_models import SavedUniverse
from app.profile_models import Badge, Breakdown, Profile, Rank, Stats
from app.services import library

# Tune the rules here; nothing else in the codebase hard-codes these numbers.
POINTS = {
    'world_completed': 10,      # each distinct completed title (dedupe by media_id across universes)
    'universe_completed': 25,   # bonus when every world in a saved universe is completed
    'universe_saved': 5,        # each saved, non-abandoned universe
    'community_post': 5,        # each community post the user authored (cap at 10 posts = 50 pts)
}
COMMUNITY_POST_CAP = 10
RANKS = [  # ordered by min_points; the first entry has no badge. Adding a tier = appending an entry.
    {'id': 'stargazer', 'title': 'Stargazer', 'min_points': 0,  'badge': None},
    {'id': 'voyager',   'title': 'Voyager',   'min_points': 50, 'badge': '/badges/voyager.svg'},
    # TODO: future tiers (name, threshold and badge art are product decisions) append here, e.g.
    # {'id': '<id>', 'title': '<Title>', 'min_points': <int>, 'badge': '/badges/<id>.svg'},
]


@contextmanager
def storage() -> Iterator[psycopg.Connection]:
    try:
        with connection() as conn:
            yield conn
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Profile unavailable; run python -m app.init_db') from None


def rank_definitions() -> list[Rank]:
    return [Rank(**rank) for rank in RANKS]


def rank_for(points: int, earned: Sequence[str] = ()) -> tuple[Rank, Rank | None]:
    """Current and next rank. Earned badges are never revoked, so they floor the rank."""
    ranks = rank_definitions()
    index = max((i for i, rank in enumerate(ranks) if points >= rank.min_points or rank.id in earned), default=0)
    return ranks[index], ranks[index + 1] if index + 1 < len(ranks) else None


def score(universes: Sequence[SavedUniverse], posts: int) -> tuple[int, Breakdown, Stats]:
    """Points, per-rule breakdown and stats. Abandoned universes are already absent from `universes`."""
    completed: set[str] = set()
    minutes: dict[str, int] = {}
    finished = 0
    for universe in universes:
        if universe.total_count > 0 and universe.viewed_count == universe.total_count:
            finished += 1
        for title in universe.titles:
            if title.completed:
                completed.add(title.media_id)
            minutes[title.media_id] = max(minutes.get(title.media_id, 0), title.estimated_minutes_watched)
    breakdown = Breakdown(
        world_completed=len(completed) * POINTS['world_completed'],
        universe_completed=finished * POINTS['universe_completed'],
        universe_saved=len(universes) * POINTS['universe_saved'],
        community_post=min(max(posts, 0), COMMUNITY_POST_CAP) * POINTS['community_post'])
    stats = Stats(universes_saved=len(universes), worlds_completed=len(completed),
                  universes_completed=finished, estimated_minutes_watched=sum(minutes.values()))
    return sum(breakdown.model_dump().values()), breakdown, stats


def post_count(conn: psycopg.Connection, user_id: str) -> int:
    # Community tables come from init_community; without them the user simply has no posts.
    if conn.execute("SELECT to_regclass('public.community_posts')").fetchone()[0] is None:
        return 0
    return conn.execute('SELECT count(*) FROM public.community_posts WHERE user_id=%s', (user_id,)).fetchone()[0]


def award(conn: psycopg.Connection, user_id: str, rank_ids: Sequence[str]) -> None:
    for rank_id in rank_ids:
        conn.execute('''INSERT INTO public.user_badges(user_id,badge_id) VALUES(%s,%s)
            ON CONFLICT DO NOTHING''', (user_id, rank_id))


def earned_badges(conn: psycopg.Connection, user_id: str) -> list[tuple[str, object]]:
    return conn.execute('''SELECT badge_id,earned_at FROM public.user_badges
        WHERE user_id=%s ORDER BY earned_at,badge_id''', (user_id,)).fetchall()


def build(conn: psycopg.Connection, user_id: str) -> Profile:
    universes = library.collect(conn, user_id)
    points, breakdown, stats = score(universes, post_count(conn, user_id))
    ranks = rank_definitions()
    # Badges are keyed by rank id and persisted the first time the user qualifies.
    award(conn, user_id, [rank.id for rank in ranks if rank.badge and points >= rank.min_points])
    earned = earned_badges(conn, user_id)
    by_id = {rank.id: rank for rank in ranks if rank.badge}
    badges = [Badge(id=badge_id, title=by_id[badge_id].title, image=by_id[badge_id].badge, earned_at=earned_at)
              for badge_id, earned_at in earned if badge_id in by_id]
    rank, next_rank = rank_for(points, [badge.id for badge in badges])
    row = conn.execute('SELECT favorite_media_id FROM public.user_profiles WHERE user_id=%s', (user_id,)).fetchone()
    favorite = next((item for item in universes if row and item.media_id == row[0]), None)
    return Profile(points=points, rank=rank, next_rank=next_rank,
                   points_to_next=max(0, next_rank.min_points - points) if next_rank else 0,
                   breakdown=breakdown, stats=stats, favorite=favorite, badges=badges, ranks=ranks)


def read(user_id: str) -> Profile:
    with storage() as conn:
        return build(conn, user_id)


def set_favorite(user_id: str, media_id: str | None) -> Profile:
    with storage() as conn:
        # The favorite must be one of this caller's own saved, non-abandoned universes.
        if media_id is not None and all(item.media_id != media_id for item in library.collect(conn, user_id)):
            raise HTTPException(422, 'Favorite must be one of your saved universes')
        conn.execute('''INSERT INTO public.user_profiles(user_id,favorite_media_id) VALUES(%s,%s)
            ON CONFLICT(user_id) DO UPDATE SET favorite_media_id=EXCLUDED.favorite_media_id,updated_at=now()''',
            (user_id, media_id))
        return build(conn, user_id)
