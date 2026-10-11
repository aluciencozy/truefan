import asyncio
from datetime import datetime, timedelta, timezone
from unittest import TestCase
from unittest.mock import patch
import httpx
import psycopg
from app.config import settings
from app.main import app
from app.schemas import Media, MediaReleaseDate
from app.services import anilist, trending

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
    def __init__(self, members, rows=(), relations=(), franchises=()):
        self.members, self.rows, self.relations, self.franchises, self.sql = members, list(rows), list(relations), list(franchises), []
    def cursor(self, **kwargs): return Cursor(self.members)
    def execute(self, sql, params=()):
        self.sql.append((sql, params))
        return Result(self.rows if 'user_progress' in sql else self.relations if 'media_relations' in sql
                      else self.franchises if 'm.media_id=ANY' in sql else [])
    def __enter__(self): return self
    def __exit__(self, *args): pass


def franchise(prefix, numbers, **kwargs):
    return [member(prefix, media(n, **kwargs)) for n in numbers]


def run(members, rows=(), relations=()):
    return trending.compute(Connection(members, rows, relations), NOW)


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
        trending.compute(conn, NOW)
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
        self.assertEqual(set(result.constellations[0].stars[0].model_dump()), {'media_id', 'title', 'cover_url', 'format', 'year', 'completions', 'magnitude', 'trending', 'trending_rank'})


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


async def get(path):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        return await client.get(path)


class ApiTests(TestCase):
    """Route-level behaviour with AniList unavailable, so the completion fallback is what is served."""
    def setUp(self):
        trending.reset_cache()
        self.down = patch('app.services.anilist.trending_media', side_effect=ValueError('AniList unavailable'))
        self.down.start()
    def tearDown(self): self.down.stop(); trending.reset_cache()

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
        self.assertEqual(set(body), {'source', 'window_days', 'constellations'}); self.assertEqual(body['window_days'], 30)
        self.assertEqual(body['source'], 'truefan_completions')
        self.assertEqual(set(body['constellations'][0]), {'franchise_id', 'title', 'entry_media_id', 'score', 'trending_rank', 'stars', 'links'})

    def test_limit_is_validated_and_applied(self):
        with self.database():
            self.assertEqual(len(asyncio.run(get('/api/trending/constellations?limit=1')).json()['constellations']), 1)
            for bad in ('0', '9', 'x'): self.assertEqual(asyncio.run(get(f'/api/trending/constellations?limit={bad}')).status_code, 422)

    def test_503_when_anilist_and_the_database_both_fail(self):
        for failure in (RuntimeError('no DATABASE_URL'), psycopg.OperationalError('down'), psycopg.errors.UndefinedTable('missing')):
            trending.reset_cache()
            with patch('app.services.trending.connection', side_effect=failure):
                response = asyncio.run(get('/api/trending/constellations'))
            self.assertEqual(response.status_code, 503); self.assertIn('unavailable', response.json()['detail'])

    def test_fallback_is_cached_briefly_and_failures_are_not_cached(self):
        log = []
        with self.database(log=log):
            for _ in range(3): asyncio.run(get('/api/trending/constellations'))
        self.assertEqual(len(log), 1)
        self.assertEqual(trending._cache[1], trending.FALLBACK_CACHE_SECONDS)
        trending.reset_cache()
        with patch('app.services.trending.connection', side_effect=RuntimeError('x')): asyncio.run(get('/api/trending/constellations'))
        with self.database(log=log): self.assertEqual(asyncio.run(get('/api/trending/constellations')).status_code, 200)

    def test_the_demo_signal_is_gone(self):
        with self.database():
            self.assertNotIn('demo_signal', asyncio.run(get('/api/trending/constellations')).json())
        self.assertFalse(hasattr(settings, 'trending_demo_signal'))


# ---- AniList-driven constellations -----------------------------------------------------------------------------------

def node(number, title=None, fmt='TV', year=2015, popularity=1000, kind='ANIME', **extra):
    return {'id': number, 'type': kind, 'title': {'romaji': title or f'Anime {number}', 'english': None}, 'format': fmt,
            'episodes': 12, 'chapters': None, 'startDate': {'year': year, 'month': 1, 'day': 1}, 'idMal': None,
            'coverImage': {'medium': 'https://s4.anilist.co/c.jpg'}, 'popularity': popularity, 'description': 'SPOILER SYNOPSIS', **extra}


def seed(number, relations=(), **kwargs):
    row = node(number, **kwargs)
    row['trending'] = 500
    row['relations'] = {'edges': [{'relationType': kind, 'node': other} for kind, other in relations]}
    return row


def sequels(seed_number, count, start=100, popularity=lambda i: 1000 + i * 100, kind='SEQUEL'):
    return [(kind, node(start + i, year=2016 + i, popularity=popularity(i))) for i in range(count)]


def anilist_build(rows, conn=None):
    return trending.build_anilist(rows, NOW, conn)


class AniListTests(TestCase):
    def setUp(self): trending.reset_cache()
    def tearDown(self): trending.reset_cache()

    def test_seeds_are_the_trending_titles_in_order_with_the_brightest_stars(self):
        rows = [seed(1, sequels(1, 3)), seed(2, sequels(2, 4, start=200)), seed(3, sequels(3, 2, start=300))]
        result = anilist_build(rows)
        self.assertEqual(result.source, 'anilist_trending')
        self.assertEqual([c.entry_media_id for c in result.constellations], ['anilist-1', 'anilist-2', 'anilist-3'])
        self.assertEqual([c.trending_rank for c in result.constellations], [1, 2, 3])
        for constellation in result.constellations:
            seeds = [s for s in constellation.stars if s.trending]
            self.assertEqual([s.media_id for s in seeds], [constellation.entry_media_id])
            self.assertEqual(seeds[0].magnitude, 1.0); self.assertEqual(seeds[0].trending_rank, constellation.trending_rank)
            for related in (s for s in constellation.stars if not s.trending):
                self.assertTrue(.25 <= related.magnitude < 1.0); self.assertIsNone(related.trending_rank)

    def test_related_magnitude_follows_popularity_within_the_constellation(self):
        row = seed(1, [('SEQUEL', node(10, popularity=100)), ('SEQUEL', node(11, popularity=5000)), ('SEQUEL', node(12, popularity=2500))])
        stars = {s.media_id: s.magnitude for s in anilist_build([row]).constellations[0].stars}
        self.assertEqual(stars['anilist-10'], .25); self.assertEqual(stars['anilist-1'], 1.0)
        self.assertTrue(stars['anilist-10'] < stars['anilist-12'] < stars['anilist-11'] < 1.0)
        flat = seed(2, [('SEQUEL', node(20, popularity=7)), ('SEQUEL', node(21, popularity=7))])
        self.assertEqual({s.magnitude for s in anilist_build([flat]).constellations[0].stars if not s.trending}, {.6})

    def test_stars_are_anime_only_and_ordered_by_release(self):
        row = seed(1, [('SEQUEL', node(10, year=2022)), ('ADAPTATION', node(11, kind='MANGA')), ('SOURCE', node(12, kind='MANGA')),
                       ('PREQUEL', node(13, year=2009)), ('SIDE_STORY', node(14, year=2018))], year=2015)
        stars = anilist_build([row]).constellations[0].stars
        self.assertEqual([s.media_id for s in stars], ['anilist-13', 'anilist-1', 'anilist-14', 'anilist-10'])
        self.assertTrue(all(s.media_id not in ('anilist-11', 'anilist-12') for s in stars))

    def test_cap_of_eight_prefers_story_relations_then_popularity(self):
        related = [('OTHER', node(50 + i, popularity=9000, year=2010 + i)) for i in range(4)] +                   [('SEQUEL', node(60 + i, popularity=100 * (i + 1), year=2020 + i)) for i in range(6)] + [('SPIN_OFF', node(70, popularity=1, year=2030))]
        stars = anilist_build([seed(1, related)]).constellations[0].stars
        ids = {s.media_id for s in stars}
        self.assertEqual(len(stars), 8)
        self.assertIn('anilist-1', ids); self.assertIn('anilist-70', ids)   # the seed, and a preferred relation despite low popularity
        self.assertFalse(ids & {f'anilist-{50 + i}' for i in range(4)})      # OTHER only fills spare room
        self.assertEqual(len(ids & {f'anilist-{60 + i}' for i in range(6)}), 6)

    def test_minimum_of_three_stars_and_unreachable_constellations_are_skipped(self):
        rows = [seed(1, sequels(1, 1)), seed(2, sequels(2, 2, start=200)), seed(3, [('ADAPTATION', node(300, kind='MANGA')), ('SEQUEL', node(301))])]
        result = anilist_build(rows)
        self.assertEqual([c.entry_media_id for c in result.constellations], ['anilist-2'])
        self.assertEqual(len(result.constellations[0].stars), 3)

    def test_other_trending_titles_and_shared_relatives_are_not_duplicated(self):
        shared = node(900)
        rows = [seed(1, sequels(1, 2) + [('OTHER', node(2)), ('SEQUEL', shared)]), seed(2, sequels(2, 2, start=200) + [('SEQUEL', shared)])]
        result = anilist_build(rows)
        self.assertEqual(len(result.constellations), 2)
        owners = [c.entry_media_id for c in result.constellations if 'anilist-900' in {s.media_id for s in c.stars}]
        self.assertEqual(owners, ['anilist-1'])   # first in trending order keeps it
        self.assertNotIn('anilist-2', {s.media_id for s in result.constellations[0].stars})
        self.assertEqual(len({s.media_id for c in result.constellations for s in c.stars}), sum(len(c.stars) for c in result.constellations))

    def test_strongly_related_seeds_merge_into_one_constellation(self):
        rows = [seed(1, [('SEQUEL', node(2))] + sequels(1, 2), year=2018), seed(2, [('PREQUEL', node(1))], year=2020, title='Show Season 2'),
                seed(3, sequels(3, 3, start=300)), seed(4, [('CHARACTER', node(3))] + sequels(4, 3, start=400))]
        result = anilist_build(rows)
        self.assertEqual([(c.entry_media_id, c.trending_rank) for c in result.constellations], [('anilist-1', 1), ('anilist-3', 3), ('anilist-4', 4)])
        merged = result.constellations[0]
        self.assertEqual({s.media_id for s in merged.stars if s.trending}, {'anilist-1', 'anilist-2'})
        self.assertEqual({s.trending_rank for s in merged.stars if s.trending}, {1, 2})
        self.assertEqual(sum(1 for s in merged.stars if s.media_id == 'anilist-2'), 1)

    def test_seeds_in_the_same_cached_franchise_merge_and_take_its_title(self):
        rows = [seed(1, sequels(1, 2), title='Fate Zero'), seed(2, sequels(2, 2, start=200), title='Fate Zero 2nd Season'), seed(3, sequels(3, 3, start=300))]
        conn = Connection([], franchises=[('anilist-1', 'fate', 'Fate/Zero 2nd Season'), ('anilist-2', 'fate', 'Fate/Zero 2nd Season')])
        result = anilist_build(rows, conn)
        self.assertEqual([(c.franchise_id, c.title, c.trending_rank) for c in result.constellations], [('fate', 'Fate Universe', 1), ('trending-anilist-3', 'Anime 3 Universe', 3)])
        fate = result.constellations[0]
        self.assertEqual(len(fate.stars), 6)
        # No edge joins the two seeds, so the shape is joined by an inferred chain.
        self.assertIn('INFERRED', {link.type for link in fate.links})
        self.assertTrue(all(link.source in {s.media_id for s in fate.stars} and link.target in {s.media_id for s in fate.stars} for link in fate.links))

    def test_links_are_normalised_deduped_and_connected(self):
        a, b = node(10, year=2016), node(11, year=2014)
        row = seed(1, [('SEQUEL', a), ('PREQUEL', b), ('SIDE_STORY', node(12, year=2019))], year=2015)
        links = anilist_build([row]).constellations[0].links
        self.assertEqual(sorted((l.source, l.target, l.type) for l in links),
                         [('anilist-1', 'anilist-10', 'SEQUEL'), ('anilist-1', 'anilist-12', 'SIDE_STORY'), ('anilist-11', 'anilist-1', 'SEQUEL')])
        stored = Connection([], relations=[('anilist-11', 'anilist-10', 'SEQUEL'), ('anilist-10', 'anilist-11', 'PREQUEL'), ('anilist-1', 'anilist-777', 'SEQUEL')])
        more = anilist_build([row], stored).constellations[0].links
        self.assertEqual(len(more), 4); self.assertNotIn('anilist-777', {end for l in more for end in (l.source, l.target)})

    def test_completions_are_a_bonus_when_the_database_is_available(self):
        row = seed(1, sequels(1, 2))
        progress_rows = finishers(1, 3, now=NOW) + finishers(100, 2, now=NOW) + finishers(101, 1, days_ago=90, now=NOW)
        stars = {s.media_id: s.completions for s in anilist_build([row], Connection([], progress_rows)).constellations[0].stars}
        self.assertEqual(stars, {'anilist-1': 3, 'anilist-100': 2, 'anilist-101': 0})
        self.assertEqual(anilist_build([row], Connection([], progress_rows)).constellations[0].score, 5)
        none = anilist_build([row], None).constellations[0]
        self.assertEqual((none.score, {s.completions for s in none.stars}), (0, {0}))

    def test_a_database_error_degrades_to_trending_without_counts(self):
        class Broken(Connection):
            def execute(self, sql, params=()): raise psycopg.OperationalError('down')
        result = anilist_build([seed(1, sequels(1, 2))], Broken([]))
        self.assertEqual((result.source, len(result.constellations), result.constellations[0].score), ('anilist_trending', 1, 0))

    def test_no_synopsis_or_extra_fields_in_the_response(self):
        rows = [seed(1, sequels(1, 3), description='SPOILER SYNOPSIS')]
        payload = anilist_build(rows).model_dump_json()
        self.assertNotIn('SPOILER', payload); self.assertNotIn('description', payload); self.assertNotIn('AniList media entry', payload)


def trending_rows(count=6):
    return [seed(n, sequels(n, 3, start=n * 100), title=f'Show {n}') for n in range(1, count + 1)]


class OneRequestTests(TestCase):
    def setUp(self): trending.reset_cache()
    def tearDown(self): trending.reset_cache()

    def run_with(self, rows, db=None):
        patches = [patch.object(anilist, '_cache', anilist.OrderedDict()),
                   patch.object(anilist, 'fetch', return_value={'data': {'Page': {'media': rows}}}),
                   patch('app.services.trending.connection', side_effect=db or RuntimeError('no database'))]
        return patches

    def test_one_anilist_request_feeds_the_covers_and_the_constellations(self):
        rows = trending_rows()
        for index, row in enumerate(rows, 1): row['coverImage'] = {'medium': f'https://s4.anilist.co/c/{index}.jpg'}
        p1, p2, p3 = self.run_with(rows)
        with p1, p2 as fetch, p3:
            covers = anilist.trending_covers()
            first = trending.constellations(8)
            trending.reset_cache()
            second = trending.constellations(8)
            again = anilist.trending_covers()
            fetch.assert_called_once()
            query = fetch.call_args.args[1]['query']
        for fragment in ('perPage:16', 'type:ANIME', 'isAdult:false', 'sort:TRENDING_DESC', 'trending popularity', 'relations{edges{relationType node{'):
            self.assertIn(fragment, query)
        self.assertNotIn('description', query)
        self.assertEqual(covers, again)
        self.assertEqual([c.id for c in covers], [1, 2, 3, 4, 5, 6])
        self.assertEqual([c.trending_rank for c in first.constellations], [1, 2, 3, 4, 5, 6])
        self.assertEqual({c.entry_media_id for c in first.constellations}, {f'anilist-{c.id}' for c in covers})  # same anime as the home page
        self.assertEqual(first, second)

    def test_covers_keep_their_order_and_validation(self):
        good, other = 'https://s4.anilist.co/a.jpg', 'https://s4.anilist.co/b.jpg'
        rows = [seed(2, coverImage={'medium': good}) , seed(3, coverImage=None), seed(4, coverImage={'medium': 'http://s4.anilist.co/x.jpg'}),
                seed(5, coverImage={'medium': 'https://s4.anilist.co.evil.test/c.jpg'}), seed(1, coverImage={'medium': other})]
        p1, p2, p3 = self.run_with(rows)
        with p1, p2, p3:
            self.assertEqual([(c.id, c.cover_url) for c in anilist.trending_covers()], [(2, good), (1, other)])

    def test_second_request_is_served_from_the_response_cache(self):
        p1, p2, p3 = self.run_with(trending_rows())
        with p1, p2 as fetch, p3 as connect:
            trending.constellations(); trending.constellations(3); trending.constellations(8)
            self.assertEqual(fetch.call_count, 1); self.assertEqual(connect.call_count, 1)
        self.assertEqual(trending._cache[1], trending.CACHE_SECONDS)

    def test_anilist_failure_falls_back_to_cached_franchise_completions(self):
        members = franchise('f', (1, 2, 3))
        rows = [r for n in (1, 2, 3) for r in finishers(n, 2, days_ago=0, now=datetime.now(timezone.utc))]
        conn = Connection(members, rows)
        with patch('app.services.anilist.trending_media', side_effect=ValueError('AniList HTTP 502')), patch('app.services.trending.connection', lambda: conn):
            result = trending.constellations()
        self.assertEqual(result.source, 'truefan_completions')
        self.assertEqual(result.constellations[0].franchise_id, 'f'); self.assertFalse(any(s.trending for s in result.constellations[0].stars))

    def test_anilist_failure_with_a_dead_database_is_a_503_at_the_route(self):
        with patch('app.services.anilist.trending_media', side_effect=ValueError('down')), patch('app.services.trending.connection', side_effect=RuntimeError('x')):
            self.assertEqual(asyncio.run(get('/api/trending/constellations')).status_code, 503)

    def test_anilist_up_database_down_still_serves_real_trending(self):
        p1, p2, p3 = self.run_with(trending_rows())
        with p1, p2, p3:
            response = asyncio.run(get('/api/trending/constellations?limit=5'))
        body = response.json()
        self.assertEqual((response.status_code, body['source'], len(body['constellations'])), (200, 'anilist_trending', 5))
        self.assertNotIn('SPOILER', response.text); self.assertNotIn('description', response.text)

    def test_empty_trending_falls_back_but_keeps_the_empty_result_if_that_fails_too(self):
        p1, p2, p3 = self.run_with([])
        with p1, p2, p3:
            body = asyncio.run(get('/api/trending/constellations')).json()
        self.assertEqual((body['source'], body['constellations']), ('anilist_trending', []))

    def test_never_calls_anything_per_title(self):
        def forbidden(*args, **kwargs): raise AssertionError('per-title call')
        p1, p2, p3 = self.run_with(trending_rows())
        with p1, p2 as fetch, p3, patch('app.services.anilist.details', forbidden), patch('app.services.anilist.search_media', forbidden), \
                patch('app.services.anilist.character_portraits', forbidden), patch('app.services.franchises.universe', forbidden), \
                patch('app.services.generation.enqueue', forbidden), patch('app.services.huggingface.extract_graph', forbidden):
            asyncio.run(get('/api/trending/constellations'))
            self.assertEqual(fetch.call_count, 1)
