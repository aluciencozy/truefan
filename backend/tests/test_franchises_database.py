"""Opt-in transactional checks. Never use the application/production DATABASE_URL."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import os
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch
import psycopg
from app.config import settings
from app.schemas import RevealPoint, UserProgress, UserMediaStateUpdate, UniverseExpandRequest
from app.services import anilist, franchises, progress
from test_anilist import entry
from test_generation_database import Proxy


@unittest.skipUnless(os.environ.get('TRUEFAN_TEST_DATABASE_URL'),
                     'Set TRUEFAN_TEST_DATABASE_URL for isolated Postgres franchise/progress tests')
class FranchiseDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url = os.environ['TRUEFAN_TEST_DATABASE_URL']
        cls.namespace = 'truefan_test_' + uuid.uuid4().hex[:12]
        with psycopg.connect(cls.url) as conn:
            conn.execute('CREATE SCHEMA ' + cls.namespace)
            conn.execute(Path('app/schema.sql').read_text().replace('public.', cls.namespace + '.'))

    @classmethod
    def tearDownClass(cls):
        with psycopg.connect(cls.url) as conn:
            conn.execute('DROP SCHEMA ' + cls.namespace + ' CASCADE')

    def setUp(self):
        with psycopg.connect(self.url) as conn:
            conn.execute('TRUNCATE ' + ','.join(self.namespace + '.' + name for name in
                         ('franchise_media', 'media_relations', 'franchises', 'user_progress')) + ' CASCADE')
        @contextmanager
        def connection():
            with psycopg.connect(self.url) as conn:
                yield Proxy(conn, self.namespace)
        self.connection = connection
        self.enterContext(patch('app.services.franchises.connection', connection))
        self.enterContext(patch('app.services.progress.connection', connection))
        self.enterContext(patch.object(settings, 'database_url', 'isolated-test-db'))
        self.enterContext(patch.object(settings, 'universe_node_cap', 25))

    def discover(self, number: int, relations: list[tuple[int, str]]) -> anilist.Discovery:
        with patch('app.services.anilist.details', return_value=entry(number, relations)):
            return anilist.discover('anilist-' + str(number), depth_limit=0)

    def test_different_cached_roots_and_directed_edges(self):
        discovery = self.discover(1, [(2, 'SEQUEL')])
        franchises.publish(discovery)
        later = self.discover(2, [(1, 'PREQUEL')])
        franchises.publish(later)
        with patch('app.services.anilist.details') as provider:
            one = franchises.universe('anilist-1'); two = franchises.universe('anilist-2')
        provider.assert_not_called()
        self.assertEqual(one.franchise_id, two.franchise_id)
        self.assertEqual((one.root_id, two.root_id), ('anilist-1', 'anilist-2'))
        self.assertEqual({(e.source, e.target, e.type) for e in two.relationships},
                         {('anilist-1', 'anilist-2', 'SEQUEL'), ('anilist-2', 'anilist-1', 'PREQUEL')})

    def test_strong_overlap_merges_deterministic_survivor_and_preserves_all_members(self):
        a = franchises.publish(self.discover(1, [(2, 'SEQUEL')]))
        b = franchises.publish(self.discover(3, [(4, 'SEQUEL')]))
        self.assertNotEqual(a.row['id'], b.row['id'])
        merged = franchises.publish(self.discover(2, [(3, 'ALTERNATIVE')]))
        self.assertEqual(merged.row['id'], min(a.row['id'], b.row['id']))
        self.assertEqual({m.id for m in merged.graph.media}, {f'anilist-{n}' for n in range(1, 5)})
        for number in range(1, 5):
            self.assertEqual(franchises.load(f'anilist-{number}').row['id'], merged.row['id'])
        with self.connection() as conn:
            rows = conn.execute('SELECT id,merged_into FROM public.franchises ORDER BY id').fetchall()
        self.assertEqual(sum(row[1] is None for row in rows), 1)

    def test_weak_boundary_and_matching_titles_never_merge_identity(self):
        a = franchises.publish(self.discover(1, [(2, 'OTHER'), (3, 'CHARACTER'), (4, 'SAME_UNIVERSE')]))
        self.assertIsNone(franchises.load('anilist-2'))
        b = franchises.publish(self.discover(2, [(1, 'OTHER')]))
        self.assertNotEqual(a.row['id'], b.row['id'])
        self.assertEqual(franchises.load('anilist-1').row['id'], a.row['id'])
        self.assertEqual(franchises.load('anilist-2').row['id'], b.row['id'])

    def test_concurrent_misses_publish_one_strong_group_without_lost_nodes(self):
        discoveries = [self.discover(1, [(2, 'SEQUEL')]), self.discover(2, [(1, 'PREQUEL'), (3, 'SEQUEL')])]
        with ThreadPoolExecutor(max_workers=2) as pool:
            snapshots = list(pool.map(franchises.publish, discoveries))
        self.assertEqual(snapshots[0].row['id'], snapshots[1].row['id'])
        graph = franchises.load('anilist-3')
        self.assertEqual(len(graph.graph.media), 3)
        self.assertEqual(graph.row['revision'], 2)
        with self.connection() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM public.franchises WHERE merged_into IS NULL').fetchone()[0], 1)

    def test_publish_rollback_and_stale_expansion_do_not_mutate_snapshot(self):
        discovery = self.discover(1, [(2, 'SEQUEL')])
        with patch('app.services.franchises._snapshot', side_effect=psycopg.OperationalError('injected')):
            with self.assertRaises(psycopg.OperationalError): franchises.publish(discovery)
        self.assertIsNone(franchises.load('anilist-1'))
        saved = franchises.publish(discovery)
        franchises.publish(self.discover(2, [(3, 'SEQUEL')]))
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as raised: franchises.publish(discovery, expected=saved)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(len(franchises.load('anilist-1').graph.media), 3)

    def test_progress_flags_ownership_unknown_counts_and_rewinds(self):
        franchises.publish(self.discover(1, [(2, 'SEQUEL')]))
        known = anilist.normalize(entry(1))
        progress.save_progress('a', UserProgress(media_id=known.id, progress=RevealPoint(unit=12)), known)
        progress.update_media_state('a', known.id, UserMediaStateUpdate(manual_unlocked=True))
        progress.save_progress('a', UserProgress(media_id=known.id, progress=RevealPoint(unit=1)), known)
        state = progress.get_media_states('a', [known.id])[0]
        self.assertTrue(state.completed); self.assertTrue(state.manual_unlocked); self.assertEqual(state.progress.unit, 1)
        progress.update_media_state('a', known.id, UserMediaStateUpdate(completed=False))
        self.assertFalse(progress.get_media_states('a', [known.id])[0].completed)
        self.assertIsNone(progress.get_media_states('b', [known.id])[0].progress)
        unknown = known.model_copy(update={'id': 'anilist-9', 'total_units': 1, 'total_units_known': False})
        progress.save_progress('a', UserProgress(media_id=unknown.id, progress=RevealPoint(unit=1)), unknown)
        self.assertFalse(progress.get_media_states('a', [unknown.id])[0].completed)
        overridden = progress.update_media_state('a', unknown.id, UserMediaStateUpdate(manual_unlocked=True))
        self.assertFalse(overridden.completed); self.assertEqual(overridden.progress.unit, 1)
        watched = progress.update_media_state('a', unknown.id, UserMediaStateUpdate(completed=True))
        self.assertTrue(watched.completed); self.assertEqual(watched.progress.unit, 1)

    def test_persisted_frontier_expansion_and_failure_preserve_prior_snapshot(self):
        saved = franchises.publish(self.discover(1, [(2, 'SEQUEL')]))
        with patch('app.services.anilist.details', return_value=entry(2, [(1, 'PREQUEL'), (3, 'SEQUEL')])) as provider:
            graph = franchises.expand('anilist-2', UniverseExpandRequest(expected_revision=saved.row['revision'], depth=0))
        self.assertEqual([call.args[0] for call in provider.call_args_list], ['anilist-2'])
        self.assertEqual(graph.root_id, 'anilist-2')
        self.assertEqual(graph.cache.revision, 2)
        current = franchises.load('anilist-3')
        self.assertEqual(current.row['discovery']['frontier'], ['anilist-3'])
        self.assertEqual(current.row['discovery']['depth'], 0)
        from fastapi import HTTPException
        with patch('app.services.anilist.details', side_effect=ValueError('offline')), self.assertRaises(HTTPException) as raised:
            franchises.expand('anilist-3', UniverseExpandRequest(expected_revision=2))
        self.assertEqual(raised.exception.status_code, 502)
        retained = franchises.load('anilist-3')
        self.assertEqual(retained.row['refreshed_at'], current.row['refreshed_at'])
        self.assertEqual(retained.row['revision'], current.row['revision'])
        self.assertIn('provider_failure', retained.row['limitations'])
        self.assertEqual(retained.graph, current.graph)

    def test_configured_cap_increase_resumes_only_capped_source_and_frontier(self):
        with patch.object(settings, 'universe_node_cap', 2):
            saved = franchises.publish(self.discover(1, [(2, 'SEQUEL'), (3, 'SEQUEL')]))
            self.assertFalse(franchises.response(saved, 'anilist-1').cache.can_expand)
        rows = {'anilist-1': entry(1, [(2, 'SEQUEL'), (3, 'SEQUEL')]), 'anilist-2': entry(2)}
        with patch.object(settings, 'universe_node_cap', 4), \
             patch('app.services.anilist.details', side_effect=lambda key: rows[key]) as provider:
            graph = franchises.expand('anilist-1', UniverseExpandRequest(expected_revision=1, depth=0))
        self.assertEqual([call.args[0] for call in provider.call_args_list], ['anilist-1', 'anilist-2'])
        self.assertEqual({m.id for m in graph.media}, {'anilist-1', 'anilist-2', 'anilist-3'})
        self.assertTrue(graph.cache.can_expand)

    def test_legacy_inference_and_additive_migration_preserve_rows(self):
        with self.connection() as conn:
            conn.execute('ALTER TABLE public.user_progress DROP COLUMN completed, DROP COLUMN manual_unlocked')
            conn.execute("INSERT INTO public.user_progress(user_id,media_id,completed_unit) VALUES('a','anilist-1',12)")
            ddl = Path('app/schema.sql').read_text()
            conn.execute(ddl); conn.execute(ddl)
            saved = conn.execute("SELECT completed_unit,completed,manual_unlocked FROM public.user_progress WHERE user_id='a'").fetchone()
        self.assertEqual(saved, (12, None, False))
        franchises.publish(self.discover(1, []))
        self.assertTrue(progress.get_media_states('a', ['anilist-1'])[0].completed)
        progress.update_media_state('a', 'anilist-1', UserMediaStateUpdate(completed=False))
        self.assertFalse(progress.get_media_states('a', ['anilist-1'])[0].completed)
        progress.update_media_state('a', 'anilist-2', UserMediaStateUpdate(manual_unlocked=True))
        other = progress.get_media_states('a', ['anilist-2'])[0]
        self.assertEqual(other.progress.unit, 0); self.assertFalse(other.completed); self.assertTrue(other.manual_unlocked)
