import asyncio
from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
import httpx
import psycopg
from app.config import settings
from app.main import app
from app.schemas import Media, MediaReleaseDate
from app.services import trending

NOW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def media(number, year=2010, total=12, known=True, kind='anime', title=None):
    return Media(id=f'anilist-{number}', title=title or f'Title {number}', type=kind, progress_unit='episode', total_units=total,
                 total_units_known=known, description='SYNOPSIS', anilist_id=number, format='TV', cover_url='https://s4.anilist.co/c.jpg',
                 release_date=MediaReleaseDate(year=year))


def member(franchise, item, name=None):
    return dict(id=franchise, display_name=name or f'{franchise} Season 2', media_id=item.id, media=item.model_dump())


def progress(user, number, completed=True, unit=12, days_ago=1, now=NOW):
    return (user, f'anilist-{number}', completed, unit, now - timedelta(days=days_ago))


class Cursor:
    def __init__(self, members): self.members = members
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params=()): return self
    def fetchall(self): return self.members


class Result:
    def __init__(self, rows): self.rows = rows
    def fetchall(self): return self.rows


class Connection:
    def __init__(self, members, rows=(), relations=()):
        self.members, self.rows, self.relations, self.sql = members, list(rows), list(relations), []
    def cursor(self, **kwargs): return Cursor(self.members)
    def execute(self, sql, params=()):
        self.sql.append((sql, params))
        return Result(self.rows if 'user_progress' in sql else self.relations if 'media_relations' in sql else [])
    def __enter__(self): return self
    def __exit__(self, *args): pass


def franchise(prefix, numbers, **kwargs):
    return [member(prefix, media(n, **kwargs)) for n in numbers]


def run(members, rows=(), relations=(), demo=None):
    return trending.compute(Connection(members, rows, relations), NOW, demo)


def finishers(number, users, **kwargs): return [progress(f'u{i}-{number}', number, **kwargs) for i in range(users)]


class CountingTests(TestCase):
    def test_counts_distinct_users_per_media(self):
        rows = [progress('a', 1), progress('a', 1), progress('b', 1), progress('a', 2)]
        counts = trending.count_completions(rows, {f'anilist-{n}': media(n) for n in (1, 2)}, NOW - timedelta(days=30))
        self.assertEqual(counts, {'anilist-1': 2, 'anilist-2': 1})

    def test_window_excludes_old_rows(self):
        rows = [progress('a', 1, days_ago=29), progress('b', 1, days_ago=31), progress('c', 1, days_ago=400)]
        self.assertEqual(trending.count_completions(rows, {'anilist-1': media(1)}, NOW - timedelta(days=30)), {'anilist-1': 1})

    def test_completed_rule_matches_progress_py(self):
        known, unknown = media(1, total=12), media(2, total=12, known=False)
        self.assertTrue(trending.is_completed(True, 0, known))        # explicit flag wins even with low progress
        self.assertFalse(trending.is_completed(False, 12, known))     # explicit false wins over finishing units
        self.assertTrue(trending.is_completed(None, 12, known))       # NULL falls back to units >= total
        self.assertTrue(trending.is_completed(None, 13, known))
        self.assertFalse(trending.is_completed(None, 11, known))
        self.assertFalse(trending.is_completed(None, 99, unknown))    # total unknown: never inferred

    def test_other_media_and_unfinished_rows_are_ignored(self):
        rows = [progress('a', 1, completed=False), progress('a', 1, completed=None, unit=3), progress('a', 9)]
        self.assertEqual(trending.count_completions(rows, {'anilist-1': media(1)}, NOW - timedelta(days=30)), {})


class ComputeTests(TestCase):
    def test_stars_are_ranked_capped_and_need_three(self):
        members = franchise('big', range(1, 13)) + franchise('small', (20, 21))
        rows = [r for n in list(range(1, 13)) + [20, 21] for r in finishers(n, 13 - n if n < 13 else 1)]
        result = run(members, rows)
        self.assertEqual([c.franchise_id for c in result.constellations], ['big'])  # 'small' has only two stars
        stars = result.constellations[0].stars
        self.assertEqual(len(stars), 8)
        self.assertEqual([s.media_id for s in stars], [f'anilist-{n}' for n in range(1, 9)])
        self.assertEqual(result.constellations[0].entry_media_id, 'anilist-1')
        self.assertEqual(result.constellations[0].score, sum(s.completions for s in stars))

    def test_ties_break_by_release_order(self):
        members = [member('f', media(1, year=2015)), member('f', media(2, year=2005)), member('f', media(3, year=2010)), member('f', media(4, year=2020))]
        rows = [r for n in (1, 2, 3, 4) for r in finishers(n, 2)]
        stars = run(members, rows).constellations[0].stars
        self.assertEqual([s.media_id for s in stars], ['anilist-2', 'anilist-3', 'anilist-1', 'anilist-4'])

    def test_works_nobody_finished_are_not_stars(self):
        members = franchise('f', (1, 2, 3, 4))
        rows = finishers(1, 3) + finishers(2, 2) + finishers(3, 1)
        self.assertEqual({s.media_id for s in run(members, rows).constellations[0].stars}, {'anilist-1', 'anilist-2', 'anilist-3'})

    def test_magnitude_is_normalised_within_each_constellation(self):
        scale = trending.magnitudes([10, 5, 1])
        self.assertEqual((scale[0], scale[2]), (1.0, 0.25)); self.assertTrue(0.25 < scale[1] < 1.0)
        self.assertEqual(trending.magnitudes([4, 4, 4]), [1.0, 1.0, 1.0])
        members = franchise('a', (1, 2, 3)) + franchise('b', (11, 12, 13))
        rows = [r for n, c in {1: 100, 2: 50, 3: 10, 11: 3, 12: 2, 13: 1}.items() for r in finishers(n, c)]
        for constellation in run(members, rows).constellations:
            values = [s.magnitude for s in constellation.stars]
            self.assertEqual((max(values), min(values)), (1.0, 0.25))

    def test_unparseable_members_are_skipped(self):
        members = franchise('f', (1, 2, 3)) + [dict(id='f', display_name='f', media_id='anilist-5', media={'id': 'x'})]
        result = run(members, [r for n in (1, 2, 3, 5) for r in finishers(n, 2)])
        self.assertEqual({s.media_id for s in result.constellations[0].stars}, {'anilist-1', 'anilist-2', 'anilist-3'})

    def test_franchise_titles_follow_universe_search(self):
        members = [member('f', media(n), 'Fate/Zero 2nd Season') for n in (1, 2, 3)]
        self.assertEqual(run(members, [r for n in (1, 2, 3) for r in finishers(n, 1)]).constellations[0].title, 'Fate Universe')

    def test_membership_query_skips_merged_weak_and_non_anime_members(self):
        # The mocked cursor cannot run SQL, so assert the filters the query sends (same ones universe_search uses).
        sent = []
        class Spy(Cursor):
            def execute(self, sql, params=()): sent.append(sql); return self
        conn = Connection(franchise('f', (1, 2, 3)))
        conn.cursor = lambda **kwargs: Spy(conn.members)
        trending.compute(conn, NOW, None)
        self.assertIn('f.merged_into IS NULL', sent[0]); self.assertIn("(f.discovery->'strong_ids') ? m.media_id", sent[0])
        self.assertIn("m.media->>'type'='anime'", sent[0])
        # Only user_progress rows that are not explicitly unfinished and are inside the window are requested.
        progress_sql = [sql for sql, _ in conn.sql if 'user_progress' in sql]
        self.assertEqual(len(progress_sql), 1); self.assertIn('completed IS NOT FALSE', progress_sql[0])

    def test_results_are_sorted_by_score_and_limited_by_the_route(self):
        members = franchise('a', (1, 2, 3)) + franchise('b', (11, 12, 13))
        rows = [r for n in (1, 2, 3) for r in finishers(n, 1)] + [r for n in (11, 12, 13) for r in finishers(n, 5)]
        self.assertEqual([c.franchise_id for c in run(members, rows).constellations], ['b', 'a'])

    def test_response_exposes_aggregates_only(self):
        members = franchise('f', (1, 2, 3))
        result = run(members, [r for n in (1, 2, 3) for r in finishers(n, 2)])
        payload = result.model_dump_json()
        self.assertNotIn('u0-1', payload); self.assertNotIn('SYNOPSIS', payload)
        self.assertEqual(set(result.constellations[0].stars[0].model_dump()), {'media_id', 'title', 'cover_url', 'format', 'year', 'completions', 'magnitude'})


class LinkTests(TestCase):
    def test_links_only_between_chosen_stars_and_reciprocals_collapse(self):
        ids = {'anilist-1', 'anilist-2', 'anilist-3'}
        relations = [('anilist-1', 'anilist-2', 'SEQUEL'), ('anilist-2', 'anilist-1', 'PREQUEL'), ('anilist-2', 'anilist-3', 'SEQUEL'),
                     ('anilist-3', 'anilist-99', 'SEQUEL'), ('anilist-98', 'anilist-1', 'PREQUEL'), ('anilist-1', 'anilist-1', 'OTHER')]
        links = trending.normalise_links(relations, ids)
        self.assertEqual(sorted((l.source, l.target, l.type) for l in links), [('anilist-1', 'anilist-2', 'SEQUEL'), ('anilist-2', 'anilist-3', 'SEQUEL')])

    def test_symmetric_pairs_collapse_and_sequel_wins(self):
        links = trending.normalise_links([('anilist-2', 'anilist-1', 'ALTERNATIVE'), ('anilist-1', 'anilist-2', 'ALTERNATIVE'),
                                          ('anilist-1', 'anilist-2', 'SEQUEL')], {'anilist-1', 'anilist-2'})
        self.assertEqual([(l.source, l.target, l.type) for l in links], [('anilist-1', 'anilist-2', 'SEQUEL')])

    def test_disconnected_stars_get_an_inferred_release_order_chain(self):
        stars = [media(1, year=2012), media(2, year=2010), media(3, year=2014), media(4, year=2016)]
        real = [trending.TrendingLink(source='anilist-2', target='anilist-1', type='SEQUEL')]
        links = trending.connect(stars, real)
        self.assertEqual([(l.source, l.target, l.type) for l in links], [
            ('anilist-2', 'anilist-1', 'SEQUEL'), ('anilist-1', 'anilist-3', 'INFERRED'), ('anilist-3', 'anilist-4', 'INFERRED')])

    def test_connected_stars_get_no_inferred_links(self):
        stars = [media(n, year=2010 + n) for n in (1, 2, 3)]
        real = [trending.TrendingLink(source='anilist-1', target='anilist-2', type='SEQUEL'), trending.TrendingLink(source='anilist-1', target='anilist-3', type='SPIN_OFF')]
        self.assertEqual(trending.connect(stars, real), real)

    def test_every_constellation_is_one_connected_shape(self):
        members = franchise('f', range(1, 7))
        rows = [r for n in range(1, 7) for r in finishers(n, n)]
        constellation = run(members, rows, relations=[('anilist-6', 'anilist-5', 'PREQUEL')]).constellations[0]
        self.assertGreaterEqual(len(constellation.links), len(constellation.stars) - 1)
        self.assertTrue(all(l.source in {s.media_id for s in constellation.stars} and l.target in {s.media_id for s in constellation.stars} for l in constellation.links))
        self.assertIn('INFERRED', {l.type for l in constellation.links})


class DemoSignalTests(TestCase):
    members = franchise('f', (1, 2, 3, 4))

    def test_demo_counts_are_added_to_real_counts_and_flagged(self):
        result = run(self.members, finishers(1, 2), demo={'anilist-1': 10, 'anilist-2': 5, 'anilist-3': 3})
        self.assertTrue(result.demo_signal)
        self.assertEqual({s.media_id: s.completions for s in result.constellations[0].stars}, {'anilist-1': 12, 'anilist-2': 5, 'anilist-3': 3})

    def test_off_means_real_data_only_and_an_empty_sky_without_users(self):
        result = run(self.members, [], demo=None)
        self.assertFalse(result.demo_signal); self.assertEqual(result.constellations, [])

    def test_uncached_sample_ids_are_ignored(self):
        result = run(self.members, [], demo={'anilist-1': 4, 'anilist-2': 4, 'anilist-3': 4, 'anilist-777': 99})
        self.assertEqual({s.media_id for s in result.constellations[0].stars}, {'anilist-1', 'anilist-2', 'anilist-3'})
        self.assertEqual(run(franchise('g', (50, 51)), [], demo={'anilist-777': 9}).constellations, [])

    def test_demo_file_validates(self):
        counts = trending.load_demo()
        self.assertTrue(counts and all(k.startswith('anilist-') and 1 <= v <= 1000 for k, v in counts.items()))


async def get(path):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        return await client.get(path)


class ApiTests(TestCase):
    def setUp(self): trending.reset_cache()
    def tearDown(self): trending.reset_cache()

    def database(self, members=None, rows=None, log=None):
        if rows is None:
            rows = [r for n in (1, 2, 3, 11, 12, 13) for r in finishers(n, 2, days_ago=0, now=datetime.now(timezone.utc))]
        conn = Connection(members if members is not None else franchise('f', (1, 2, 3)) + franchise('g', (11, 12, 13)), rows)
        def factory():
            if log is not None: log.append(1)
            return conn
        return patch('app.services.trending.connection', factory)

    def test_public_route_returns_the_contract_and_is_not_swallowed_by_media_ids(self):
        with self.database(), patch('app.main.get_media', side_effect=AssertionError('treated as a media id')):
            response = asyncio.run(get('/api/trending/constellations'))
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {'window_days', 'demo_signal', 'constellations'}); self.assertEqual(body['window_days'], 30)
        self.assertEqual(set(body['constellations'][0]), {'franchise_id', 'title', 'entry_media_id', 'score', 'stars', 'links'})

    def test_limit_is_validated_and_applied(self):
        with self.database():
            self.assertEqual(len(asyncio.run(get('/api/trending/constellations?limit=1')).json()['constellations']), 1)
            for bad in ('0', '9', 'x'): self.assertEqual(asyncio.run(get(f'/api/trending/constellations?limit={bad}')).status_code, 422)

    def test_503_not_500_when_the_database_is_unavailable(self):
        for failure in (RuntimeError('no DATABASE_URL'), psycopg.OperationalError('down'), psycopg.errors.UndefinedTable('missing')):
            trending.reset_cache()
            with patch('app.services.trending.connection', side_effect=failure):
                response = asyncio.run(get('/api/trending/constellations'))
            self.assertEqual(response.status_code, 503); self.assertIn('unavailable', response.json()['detail'])

    def test_result_is_cached_and_failures_are_not(self):
        log = []
        with self.database(log=log):
            for _ in range(3): asyncio.run(get('/api/trending/constellations'))
        self.assertEqual(len(log), 1)
        trending.reset_cache()
        with patch('app.services.trending.connection', side_effect=RuntimeError('x')): asyncio.run(get('/api/trending/constellations'))
        with self.database(log=log): self.assertEqual(asyncio.run(get('/api/trending/constellations')).status_code, 200)

    def test_demo_flag_comes_from_settings_and_busts_the_cache(self):
        with self.database(members=franchise('f', (1, 2, 3)), rows=[]):
            with patch.object(settings, 'trending_demo_signal', True), patch('app.services.trending.load_demo', return_value={'anilist-1': 3, 'anilist-2': 2, 'anilist-3': 1}):
                on = asyncio.run(get('/api/trending/constellations')).json()
            self.assertTrue(on['demo_signal']); self.assertEqual(len(on['constellations']), 1)
            with patch.object(settings, 'trending_demo_signal', False):
                off = asyncio.run(get('/api/trending/constellations')).json()
        self.assertFalse(off['demo_signal']); self.assertEqual(off['constellations'], [])

    def test_never_calls_anilist_or_generation(self):
        def forbidden(*args, **kwargs): raise AssertionError('external call')
        with self.database(), patch('app.services.anilist.details', forbidden), patch('app.services.anilist.search_media', forbidden), \
                patch('app.services.anilist.character_portraits', forbidden), patch('app.services.franchises.universe', forbidden), \
                patch('app.services.generation.enqueue', forbidden), patch('app.services.huggingface.extract_graph', forbidden):
            self.assertEqual(asyncio.run(get('/api/trending/constellations')).status_code, 200)
