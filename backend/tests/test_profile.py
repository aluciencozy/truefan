import asyncio
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from unittest import TestCase, skipUnless
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from pydantic import ValidationError
from app.auth import current_user
from app.library_models import LibraryTitle, SavedUniverse
from app.main import app
from app.profile_models import ProfileUpdate
from app.schemas import CurrentUser
from app.services import profile

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def title(number, completed=False, minutes=0):
    return LibraryTitle(media_id=f'anilist-{number}', title=f'Story {number}', type='anime',
                        completed=completed, estimated_minutes_watched=minutes)


def universe(root, titles):
    return SavedUniverse(media_id=f'anilist-{root}', title=f'Universe {root}', type='anime', titles=titles,
                         viewed_count=sum(t.completed for t in titles), total_count=len(titles),
                         coverage_incomplete=False, saved_at=NOW, last_explored_at=NOW)


class Result:
    def __init__(self, rows): self.rows = rows
    def fetchone(self): return self.rows[0] if self.rows else None
    def fetchall(self): return self.rows


class FakeConnection:
    """Routes SQL by table name so tests can assert on exactly what profile.py wrote."""
    def __init__(self, posts=0, badges=(), favorite=None, community=True):
        self.posts, self.badges, self.favorite, self.community = posts, list(badges), favorite, community
        self.writes = []
    def execute(self, sql, params=()):
        if 'to_regclass' in sql: return Result([('public.community_posts' if self.community else None,)])
        if 'community_posts' in sql: return Result([(self.posts,)])
        if 'INSERT INTO public.user_badges' in sql:
            self.writes.append(('badge', params))
            if all(b[0] != params[1] for b in self.badges): self.badges.append((params[1], NOW))
            return Result([])
        if 'FROM public.user_badges' in sql: return Result(list(self.badges))
        if 'INSERT INTO public.user_profiles' in sql:
            self.writes.append(('favorite', params)); self.favorite = params[1]; return Result([])
        if 'FROM public.user_profiles' in sql: return Result([(self.favorite,)] if self.favorite else [])
        raise AssertionError(sql)


def build(universes, **kwargs):
    conn = FakeConnection(**kwargs)
    with patch('app.services.profile.library.collect', return_value=universes):
        return profile.build(conn, 'owner'), conn


class PointsTests(TestCase):
    def test_world_universe_and_saved_points(self):
        points, breakdown, stats = profile.score([universe(1, [title(1, True), title(2, True)])], 0)
        self.assertEqual((breakdown.world_completed, breakdown.universe_completed, breakdown.universe_saved), (20, 25, 5))
        self.assertEqual(points, 50)
        self.assertEqual((stats.universes_saved, stats.worlds_completed, stats.universes_completed), (1, 2, 1))

    def test_worlds_shared_across_universes_count_once(self):
        shared = [universe(1, [title(1, True), title(2, False)]), universe(3, [title(1, True), title(4, True)])]
        _, breakdown, stats = profile.score(shared, 0)
        self.assertEqual(stats.worlds_completed, 2)  # anilist-1 once, anilist-4
        self.assertEqual(breakdown.world_completed, 20)
        self.assertEqual(stats.universes_completed, 1)  # only universe 3 is 2/2
    def test_incomplete_or_empty_universe_gets_no_bonus(self):
        points, breakdown, stats = profile.score([universe(1, [title(1, True), title(2)]), universe(2, [])], 0)
        self.assertEqual((breakdown.universe_completed, stats.universes_completed), (0, 0))
        self.assertEqual(points, 10 + 10)

    def test_post_points_are_capped(self):
        self.assertEqual(profile.score([], 3)[1].community_post, 15)
        self.assertEqual(profile.score([], 10)[1].community_post, 50)
        self.assertEqual(profile.score([], 400)[1].community_post, 50)

    def test_minutes_dedupe_by_title_using_the_largest_estimate(self):
        stats = profile.score([universe(1, [title(1, True, 264)]), universe(2, [title(1, True, 66), title(2, False, 22)])], 0)[2]
        self.assertEqual(stats.estimated_minutes_watched, 264 + 22)

    def test_abandoned_universes_are_not_counted_because_collect_omits_them(self):
        # collect() drops tombstoned universes; build() must score exactly what it returns.
        points = build([])[0].points
        self.assertEqual(points, 0)

    def test_missing_community_tables_count_zero_posts(self):
        self.assertEqual(profile.post_count(FakeConnection(posts=7, community=False), 'owner'), 0)
        self.assertEqual(profile.post_count(FakeConnection(posts=7), 'owner'), 7)


class RankTests(TestCase):
    def test_rank_boundaries(self):
        for points, rank, nxt in [(0, 'stargazer', 'voyager'), (49, 'stargazer', 'voyager'),
                                  (50, 'voyager', None), (5000, 'voyager', None)]:
            current, upcoming = profile.rank_for(points)
            self.assertEqual((current.id, upcoming.id if upcoming else None), (rank, nxt), points)

    def test_points_to_next(self):
        self.assertEqual(build([])[0].points_to_next, 50)
        self.assertEqual(build([universe(1, [title(1, True), title(2, False)])])[0].points_to_next, 35)  # 10 + 5 saved
        top = build([universe(n, [title(n, True)]) for n in range(1, 6)])[0]
        self.assertIsNone(top.next_rank); self.assertEqual(top.points_to_next, 0)

    def test_earned_badge_floors_the_rank_if_points_later_drop(self):
        result, _ = build([], badges=[('voyager', NOW)])
        self.assertEqual((result.points, result.rank.id), (0, 'voyager'))
        self.assertIsNone(result.next_rank)

    def test_rank_table_is_ordered_and_first_has_no_badge(self):
        minimums = [r['min_points'] for r in profile.RANKS]
        self.assertEqual(minimums, sorted(minimums)); self.assertIsNone(profile.RANKS[0]['badge'])


class BadgeTests(TestCase):
    def test_awarded_when_qualifying_with_the_stored_date(self):
        result, conn = build([universe(1, [title(1, True), title(2, True)])])
        self.assertEqual([b.id for b in result.badges], ['voyager'])
        self.assertEqual(result.badges[0].image, '/badges/voyager.svg')
        self.assertEqual(result.rank.id, 'voyager')
        self.assertEqual(conn.writes, [('badge', ('owner', 'voyager'))])

    def test_not_awarded_below_threshold(self):
        result, conn = build([universe(1, [title(1, True)])])
        self.assertEqual((result.badges, conn.writes), ([], []))

    def test_insert_is_idempotent_and_keeps_the_original_date(self):
        old = datetime(2025, 5, 5, tzinfo=timezone.utc)
        conn = FakeConnection(badges=[('voyager', old)])
        universes = [universe(1, [title(1, True), title(2, True)])]
        with patch('app.services.profile.library.collect', return_value=universes):
            first = profile.build(conn, 'owner'); second = profile.build(conn, 'owner')
        self.assertEqual(len(conn.badges), 1)
        self.assertEqual([b.earned_at for b in first.badges + second.badges], [old, old])
        # The SQL itself must be a no-op on conflict rather than relying on the caller.
        with patch.object(conn, 'execute', wraps=conn.execute) as spy:
            profile.award(conn, 'owner', ['voyager'])
        self.assertIn('ON CONFLICT DO NOTHING', spy.call_args.args[0])

    def test_unknown_stored_badges_are_ignored(self):
        self.assertEqual(build([], badges=[('retired-tier', NOW)])[0].badges, [])


class FavoriteTests(TestCase):
    @contextmanager
    def patched(self, conn, universes):
        @contextmanager
        def storage(): yield conn
        with patch('app.services.profile.storage', storage), patch('app.services.profile.library.collect', return_value=universes):
            yield

    def test_favorite_must_be_a_saved_universe(self):
        conn = FakeConnection()
        with self.patched(conn, [universe(1, [title(1)])]):
            with self.assertRaises(HTTPException) as raised: profile.set_favorite('owner', 'anilist-9')
        self.assertEqual(raised.exception.status_code, 422); self.assertEqual(conn.writes, [])

    def test_set_and_clear(self):
        conn = FakeConnection()
        items = [universe(1, [title(1)])]
        with self.patched(conn, items):
            self.assertEqual(profile.set_favorite('owner', 'anilist-1').favorite.media_id, 'anilist-1')
            self.assertIsNone(profile.set_favorite('owner', None).favorite)
        self.assertEqual([w[1] for w in conn.writes], [('owner', 'anilist-1'), ('owner', None)])

    def test_abandoned_favorite_reads_as_null(self):
        # The stored id is no longer in collect() because the universe was abandoned.
        self.assertIsNone(build([universe(2, [title(2)])], favorite='anilist-1')[0].favorite)
        self.assertEqual(build([universe(1, [title(1)])], favorite='anilist-1')[0].favorite.media_id, 'anilist-1')

    def test_update_body_is_strict(self):
        for body in ({}, {'favorite_media_id': 1}, {'favorite_media_id': 'a', 'user_id': 'x'}):
            with self.assertRaises(ValidationError): ProfileUpdate(**body)
        self.assertIsNone(ProfileUpdate(favorite_media_id=None).favorite_media_id)


async def call(path='/api/me/profile', method='GET', body=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        return await client.request(method, path, json=body)


class ProfileApiTests(TestCase):
    def tearDown(self): app.dependency_overrides.clear()

    def test_requires_a_token(self):
        for method, body in (('GET', None), ('PUT', {'favorite_media_id': None})):
            self.assertEqual(asyncio.run(call(method=method, body=body)).status_code, 401)

    def test_owner_comes_only_from_the_verified_user(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified-owner')
        result, _ = build([])
        with patch('app.services.profile.read', return_value=result) as read, \
                patch('app.services.profile.set_favorite', return_value=result) as write:
            response = asyncio.run(call())
            self.assertEqual(response.status_code, 200)
            read.assert_called_once_with('verified-owner')
            self.assertEqual(asyncio.run(call(method='PUT', body={'favorite_media_id': 'anilist-1'})).status_code, 200)
            write.assert_called_once_with('verified-owner', 'anilist-1')
            for body in ({'favorite_media_id': 'anilist-1', 'user_id': 'other'}, {}, {'favorite_media_id': 5}):
                self.assertEqual(asyncio.run(call(method='PUT', body=body)).status_code, 422)
            self.assertEqual(write.call_count, 1)

    def test_response_contract_exposes_no_identity(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='secret-sub')
        result, _ = build([universe(1, [title(1, True), title(2, True)])])
        with patch('app.services.profile.read', return_value=result):
            data = asyncio.run(call()).json()
        self.assertEqual(set(data), {'points', 'rank', 'next_rank', 'points_to_next', 'breakdown', 'stats',
                                     'favorite', 'badges', 'ranks'})
        self.assertEqual(set(data['badges'][0]), {'id', 'title', 'image', 'earned_at'})
        self.assertNotIn('secret-sub', str(data))

    def test_missing_database_is_503_not_500(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='owner')
        with patch('app.services.profile.connection', side_effect=RuntimeError('unconfigured')):
            self.assertEqual(asyncio.run(call()).status_code, 503)
            self.assertEqual(asyncio.run(call(method='PUT', body={'favorite_media_id': None})).status_code, 503)

    def test_missing_tables_are_503(self):
        import psycopg
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='owner')
        with patch('app.services.profile.connection', side_effect=psycopg.errors.UndefinedTable('no table')):
            self.assertEqual(asyncio.run(call()).status_code, 503)


@skipUnless(os.getenv('TRUEFAN_PROFILE_DB_TESTS') == '1', 'Opt-in Neon test: applies schema.sql to a rolled-back transaction')
class ProfileSchemaDatabaseTests(TestCase):
    def test_schema_is_additive_and_badge_insert_is_idempotent(self):
        from pathlib import Path
        from app.database import connection
        schema = (Path(__file__).resolve().parents[1] / 'app/schema.sql').read_text()
        with connection() as conn:
            conn.execute(schema); conn.execute(schema)  # re-running must not fail
            for _ in range(2):
                conn.execute("INSERT INTO public.user_badges(user_id,badge_id) VALUES('test-user','voyager') ON CONFLICT DO NOTHING")
            self.assertEqual(conn.execute("SELECT count(*) FROM public.user_badges WHERE user_id='test-user'").fetchone()[0], 1)
            conn.rollback()
