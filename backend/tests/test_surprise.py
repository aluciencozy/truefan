import asyncio
from unittest import TestCase
from unittest.mock import patch
import httpx
import psycopg
from pydantic import ValidationError
from app.main import app
from app.schemas import Media
from app.services import curation, surprise

CURATED = curation.load()
DOCUMENTS = {g.media_id: g.document() for g in CURATED.graphs}


def media(media_id, total=12, description='SYNOPSIS THAT MAY SPOIL'):
    return Media(id=media_id, title=f'Title {media_id}', type='anime', progress_unit='episode', total_units=total,
                 total_units_known=True, description=description, anilist_id=int(media_id.split('-')[1]), cover_url='https://s4.anilist.co/x.jpg')


def row(media_id, document=None, **changes):
    return dict(media_id=media_id, media=media(media_id, **changes).model_dump(), document=document or DOCUMENTS[media_id])


def episodes(*counts):
    """A synthetic cache document: episode N introduces counts[N-1] characters."""
    entries = []
    for unit, count in enumerate(counts, 1):
        entries.append({'episode': {'unit': unit, 'number': unit, 'title': f'E{unit}', 'source_url': 'https://en.wikipedia.org/x?oldid=1'},
                        'model': 'test', 'status': 'done', 'relationships': [],
                        'characters': [{'name': f'Hero {i}', 'description': f'd{unit}', 'evidence': 'e'} for i in range(count)]})
    return {'episodes': entries}


class Cursor:
    def __init__(self, rows, log): self.rows, self.log = rows, log
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def execute(self, sql, params): self.log.append(params); return self
    def fetchall(self): return self.rows


class Connection:
    def __init__(self, rows, log): self.rows, self.log = rows, log
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def cursor(self, **kwargs): return Cursor(self.rows, self.log)


def database(rows, log=None):
    log = [] if log is None else log
    return patch('app.services.surprise.connection', lambda: Connection(rows, log))


class SurpriseTests(TestCase):
    def setUp(self): surprise.reset_cache()
    def tearDown(self): surprise.reset_cache()

    def test_excludes_the_given_id_when_there_is_a_choice(self):
        rows = [row(i) for i in ('anilist-10087', 'anilist-356', 'anilist-223')]
        with database(rows):
            for _ in range(40):
                self.assertNotEqual(surprise.pick('anilist-356').media.id, 'anilist-356')

    def test_picks_vary_across_the_pool(self):
        rows = [row(i) for i in ('anilist-10087', 'anilist-356', 'anilist-223')]
        with database(rows):
            self.assertGreater(len({surprise.pick().media.id for _ in range(60)}), 1)

    def test_single_candidate_is_returned_even_if_excluded(self):
        with database([row('anilist-223')]):
            self.assertEqual(surprise.pick('anilist-223').media.id, 'anilist-223')

    def test_only_titles_with_two_entities_at_episode_one_qualify(self):
        rows = [row('anilist-10087'), row('anilist-356', episodes(1, 5)), row('anilist-223', episodes(0, 4)), row('anilist-21', episodes(2, 2))]
        with database(rows):
            seen = {surprise.pick().media.id for _ in range(80)}
            self.assertEqual(seen, {'anilist-10087', 'anilist-21'})
            self.assertEqual(surprise.pick().pool_size, 2)

    def test_reports_characters_visible_at_start_only(self):
        with database([row('anilist-21', episodes(3, 9))]):
            result = surprise.pick()
        self.assertEqual((result.characters_at_start, result.start_progress, result.pool_size), (3, 1, 1))

    def test_picks_without_a_cached_row_are_not_offered(self):
        with database([row('anilist-223')]):
            self.assertEqual(surprise.pick().media.id, 'anilist-223')

    def test_malformed_cache_rows_are_skipped(self):
        bad = dict(media_id='anilist-356', media={'id': 'anilist-356'}, document={})
        with database([bad, row('anilist-223')]):
            self.assertEqual(surprise.pick().media.id, 'anilist-223')

    def test_start_progress_is_clamped_to_total_units(self):
        with database([row('anilist-223')]):
            self.assertEqual(surprise.pick().start_progress, 1)

    def test_synopsis_never_leaves_the_endpoint(self):
        with database([row('anilist-223')]):
            result = surprise.pick()
        self.assertEqual(result.media.description, '')
        self.assertNotIn('SPOIL', result.model_dump_json())
        self.assertEqual(result.hook, next(p.hook for p in surprise.load_picks() if p.media_id == 'anilist-223'))

    def test_falls_back_to_lantern_harbor_on_database_errors_and_empty_pools(self):
        for failure in (RuntimeError('no DATABASE_URL'), psycopg.OperationalError('down')):
            with patch('app.services.surprise.connection', side_effect=failure):
                result = surprise.pick('anything')
            self.assertEqual(result.media.id, 'lantern-harbor')
            self.assertGreaterEqual(result.characters_at_start, 2)
            self.assertLessEqual(len(result.hook), 120)
        for rows in ([], [row('anilist-223', episodes(1, 5))]):
            with database(rows):
                self.assertEqual(surprise.pick().media.id, 'lantern-harbor')

    def test_eligible_list_is_cached_briefly(self):
        log = []
        with database([row('anilist-223')], log):
            surprise.pick(); surprise.pick(); surprise.pick()
        self.assertEqual(len(log), 1)

    def test_failures_are_not_cached(self):
        with patch('app.services.surprise.connection', side_effect=RuntimeError('x')):
            self.assertEqual(surprise.pick().media.id, 'lantern-harbor')
        with database([row('anilist-223')]):
            self.assertEqual(surprise.pick().media.id, 'anilist-223')


class PicksFileTests(TestCase):
    def test_hooks_file_validates_and_matches_the_curated_set_exactly(self):
        picks = surprise.load_picks()
        ids = [p.media_id for p in picks]
        self.assertEqual(set(ids), set(DOCUMENTS)); self.assertEqual(len(ids), len(set(ids)))
        self.assertFalse(set(ids) & set(CURATED.clear_empty_media_ids))
        for p in picks:
            self.assertLessEqual(len(p.hook), 120); self.assertTrue(1 <= len(p.tags) <= 3)

    def test_model_is_strict(self):
        good = {'media_id': 'anilist-1', 'hook': 'A hook.', 'tags': ['adventure']}
        surprise.Pick(**good)
        for change in ({'media_id': 'lantern-harbor'}, {'media_id': 'anilist-x'}, {'hook': 'x' * 121}, {'hook': ''},
                       {'tags': []}, {'tags': list('abcd')}, {'extra': 1}):
            with self.assertRaises(ValidationError): surprise.Pick(**{**good, **change})


async def get(path):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        return await client.get(path)


class SurpriseApiTests(TestCase):
    def setUp(self): surprise.reset_cache()
    def tearDown(self): surprise.reset_cache()

    def test_route_is_not_swallowed_by_the_media_id_route(self):
        with database([row('anilist-223')]), patch('app.main.get_media', side_effect=AssertionError('treated as a media id')):
            response = asyncio.run(get('/api/media/surprise'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'media', 'start_progress', 'hook', 'tags', 'characters_at_start', 'pool_size'})
        self.assertEqual(response.json()['media']['id'], 'anilist-223')

    def test_never_calls_anilist(self):
        def forbidden(*args, **kwargs): raise AssertionError('AniList was called')
        with database([row('anilist-223'), row('anilist-21')]), \
                patch('app.services.anilist.details', forbidden), patch('app.services.anilist.search_media', forbidden), \
                patch('app.services.anilist.character_portraits', forbidden), patch('app.services.anilist.trending_covers', forbidden), \
                patch('app.services.anilist.normalize', forbidden), patch('app.services.franchises.universe', forbidden):
            for _ in range(10): self.assertEqual(asyncio.run(get('/api/media/surprise?exclude=anilist-21')).status_code, 200)
            with patch('app.services.surprise.connection', side_effect=RuntimeError('x')):
                surprise.reset_cache()
                self.assertEqual(asyncio.run(get('/api/media/surprise')).json()['media']['id'], 'lantern-harbor')

    def test_never_500_and_validates_exclude(self):
        with patch('app.services.surprise.connection', side_effect=psycopg.OperationalError('down')):
            self.assertEqual(asyncio.run(get('/api/media/surprise?exclude=anilist-1')).status_code, 200)
        self.assertEqual(asyncio.run(get('/api/media/surprise?exclude=' + 'x' * 201)).status_code, 422)

    def test_picked_graph_is_non_empty_at_start_progress(self):
        from app.main import media_graph
        with database([row('anilist-10087')]):
            result = surprise.pick()
        from datetime import datetime, timezone
        cached = {**row('anilist-10087'), 'status': 'partial', 'episode_cap': 6, 'error': None, 'updated_at': datetime(2026, 1, 1, tzinfo=timezone.utc)}
        with patch('app.main.get_media', return_value=result.media), \
                patch('app.main.cached_generation', return_value=cached), \
                patch('app.main.anilist.character_portraits', lambda graph, _id: graph):
            graph = media_graph(result.media.id, result.start_progress)
        self.assertEqual(len(graph.entities), result.characters_at_start)
        self.assertGreaterEqual(len(graph.entities), 2)
