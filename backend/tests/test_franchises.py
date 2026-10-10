import asyncio
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch
import httpx
import psycopg
from fastapi import HTTPException
from app.config import settings
from app.main import app
from app.schemas import Universe, UniverseCache, UniverseEdge, UniverseExpandRequest
from app.services import anilist, franchises
from test_anilist import entry


def snapshot(*, revision: int = 2, frontier: list[str] | None = None) -> franchises.Snapshot:
    graph = Universe(root_id='anilist-1', media=[anilist.normalize(entry(n)) for n in (1, 2)],
                     relationships=[UniverseEdge(source='anilist-1', target='anilist-2', type='SEQUEL')])
    row = {'id': 'franchise-test', 'revision': revision, 'refreshed_at': datetime.now(timezone.utc),
           'limitations': ['inferred_membership'], 'discovery': {'strong_ids': ['anilist-1', 'anilist-2'],
           'expanded_ids': ['anilist-1'], 'frontier': frontier if frontier is not None else ['anilist-2']}}
    return franchises.Snapshot(row, graph)


async def request(path: str, method: str = 'GET', body: dict | None = None) -> tuple[int, dict]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        result = await client.request(method, path, json=body)
        return result.status_code, result.json()


class CacheTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(settings, 'database_url', 'configured'))

    def test_cache_hit_across_roots_makes_zero_provider_calls_and_bypasses_get_media(self):
        with patch('app.services.franchises.load', return_value=snapshot()), \
             patch('app.services.anilist.details') as details, patch('app.main.get_media') as get_media:
            code, one = asyncio.run(request('/api/media/anilist-1/universe'))
            other_code, two = asyncio.run(request('/api/media/anilist-2/universe'))
        self.assertEqual((code, other_code), (200, 200))
        self.assertEqual(one['franchise_id'], two['franchise_id'])
        self.assertEqual((one['root_id'], two['root_id']), ('anilist-1', 'anilist-2'))
        self.assertEqual(one['media'], two['media'])
        details.assert_not_called(); get_media.assert_not_called()

    def test_stale_and_projected_hits_keep_exact_root_and_honest_limits(self):
        cache = snapshot()
        cache.row['refreshed_at'] -= timedelta(days=3)
        with patch.object(settings, 'universe_node_cap', 1):
            result = franchises.response(cache, 'anilist-2')
        self.assertEqual([m.id for m in result.media], ['anilist-2'])
        self.assertEqual(result.relationships, [])
        self.assertTrue(result.cache.stale)
        self.assertTrue(result.cache.incomplete)
        self.assertFalse(result.cache.can_expand)
        self.assertIn('response_node_cap', result.cache.limitations)

    def test_miss_or_storage_failure_keeps_live_fallback_without_cache_claim(self):
        live = anilist.Discovery(Universe(root_id='anilist-1', media=[anilist.normalize(entry(1))], relationships=[]),
                                {'anilist-1'}, {'anilist-1'}, set(), {'inferred_membership'}, {'anilist-1'})
        for error in (None, psycopg.OperationalError('offline')):
            with patch('app.services.franchises.load', return_value=None, side_effect=error), \
                 patch('app.services.anilist.discover', return_value=live) as discover, \
                 patch('app.services.franchises.publish', side_effect=psycopg.OperationalError('offline')):
                result = franchises.universe('anilist-1')
            self.assertIsNone(result.franchise_id); self.assertIsNone(result.cache)
            discover.assert_called_once_with('anilist-1')
        with patch.object(settings, 'database_url', ''), patch('app.services.franchises.load') as load, \
             patch('app.services.anilist.discover', return_value=live):
            self.assertEqual(franchises.universe('anilist-1'), live.graph)
            load.assert_not_called()
        code, data = asyncio.run(request('/api/media/lantern-harbor/universe'))
        self.assertEqual(code, 200); self.assertTrue(data['media'][0]['total_units_known'])

    def test_expansion_requires_persistence_revision_and_configured_bounds(self):
        for loaded, revision, status in ((None, 0, 409), (snapshot(), 1, 409)):
            with patch('app.services.franchises.load', return_value=loaded), \
                 patch('app.services.anilist.discover') as discover, self.assertRaises(HTTPException) as raised:
                franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=revision))
            self.assertEqual(raised.exception.status_code, status); discover.assert_not_called()
        with patch('app.services.franchises.load', side_effect=RuntimeError('no DB')), self.assertRaises(HTTPException) as raised:
            franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=0))
        self.assertEqual(raised.exception.status_code, 503)
        with patch.object(settings, 'universe_node_cap', 5), self.assertRaises(HTTPException) as raised:
            franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=0, node_limit=6))
        self.assertEqual(raised.exception.status_code, 422)

    def test_expand_passes_only_saved_frontier_and_preserves_root(self):
        saved = snapshot()
        discovery = anilist.Discovery(saved.graph, {'anilist-1', 'anilist-2'}, {'anilist-1', 'anilist-2'},
                                     set(), {'inferred_membership'}, {'anilist-2'})
        with patch('app.services.franchises.load', return_value=saved), \
             patch('app.services.anilist.discover', return_value=discovery) as discover, \
             patch('app.services.franchises.publish', return_value=snapshot(revision=3, frontier=[])) as publish:
            result = franchises.expand('anilist-2', UniverseExpandRequest(expected_revision=2))
        self.assertEqual(result.root_id, 'anilist-2'); self.assertEqual(result.cache.revision, 3)
        self.assertEqual(discover.call_args.kwargs['frontier'], {'anilist-2'})
        self.assertEqual(discover.call_args.kwargs['expanded'], {'anilist-1'})
        publish.assert_called_once_with(discovery, expected=saved)

    def test_exhausted_or_capped_expansion_does_not_replay_root(self):
        for saved in (snapshot(frontier=[]), snapshot()):
            with patch.object(settings, 'universe_node_cap', 2), \
                 patch('app.services.franchises.load', return_value=saved), patch('app.services.anilist.discover') as discover:
                franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=2))
            discover.assert_not_called()

    def test_failed_expansion_retains_snapshot_freshness_and_revision(self):
        saved = snapshot(); refreshed = saved.row['refreshed_at']
        with patch('app.services.franchises.load', return_value=saved), \
             patch('app.services.anilist.discover', side_effect=ValueError('provider')), \
             patch('app.services.franchises.connection') as connection, \
             patch('app.services.franchises.publish') as publish, self.assertRaises(HTTPException) as raised:
            franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=2))
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(saved.row['refreshed_at'], refreshed); self.assertEqual(saved.row['revision'], 2)
        publish.assert_not_called()
        sql, params = connection.return_value.__enter__.return_value.execute.call_args.args
        self.assertNotIn('refreshed_at=', sql); self.assertEqual(params, ('franchise-test', 2))

    def test_publish_revision_is_rechecked_inside_transaction(self):
        saved = snapshot()
        discovery = anilist.Discovery(saved.graph, set(), {'anilist-1'}, set(), set(), set())
        with patch('app.services.franchises.connection'), patch('app.services.franchises._load', return_value=snapshot(revision=3)), \
             self.assertRaises(HTTPException) as raised:
            franchises.publish(discovery, expected=saved)
        self.assertEqual(raised.exception.status_code, 409)

    def test_expand_api_extra_fields_and_bounds_are_validated(self):
        for data in ({}, {'expected_revision': -1}, {'expected_revision': 0, 'depth': 3},
                     {'expected_revision': 0, 'node_limit': 51}, {'expected_revision': 0, 'user_id': 'spoof'}):
            code, _ = asyncio.run(request('/api/media/anilist-1/universe/expand', 'POST', data))
            self.assertEqual(code, 422)
