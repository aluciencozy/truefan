import asyncio
import unittest
from unittest.mock import patch, MagicMock
import psycopg
from app.auth import current_user
from app.config import settings
from app.main import app
from app.schemas import CurrentUser, UserMediaState, UserMediaStateUpdate, RevealPoint, UserProgress
from app.services import anilist, progress
from test_anilist import entry
from test_franchises import request


class MediaStateTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(settings, 'database_url', 'configured'))
        db = self.enterContext(patch('app.services.progress.connection'))
        self.conn = db.return_value.__enter__.return_value

    def test_legacy_completion_requires_known_total_explicit_flags_win(self):
        self.assertFalse(progress._state('anilist-1', (1, None, False), {}).completed)
        self.assertTrue(progress._state('anilist-1', (12, None, False), {'anilist-1': 12}).completed)
        self.assertFalse(progress._state('anilist-1', (12, False, True), {'anilist-1': 12}).completed)
        self.assertTrue(progress._state('anilist-1', (1, True, False), {}).completed)
        self.assertFalse(progress._state('anilist-19603', (1, None, False), {'anilist-19603': 12}).completed)
        self.assertIsNone(progress._state('anilist-1', None, {}).progress)

    def test_bulk_queries_only_verified_owner_requested_ids_without_provider(self):
        saved = MagicMock(); saved.fetchall.return_value = [('anilist-1', 12, None, True), ('anilist-2', 1, False, False)]
        catalog = MagicMock(); catalog.fetchall.return_value = [('anilist-1', anilist.normalize(entry(1)).model_dump())]
        generated = MagicMock(); generated.fetchall.return_value = []
        self.conn.execute.side_effect = [saved, catalog, generated]
        with patch('app.services.anilist.details') as provider:
            states = progress.get_media_states('verified', ['anilist-3', 'anilist-2', 'anilist-1'])
        self.assertEqual([s.media_id for s in states], ['anilist-1', 'anilist-2', 'anilist-3'])
        self.assertTrue(states[0].completed); self.assertFalse(states[1].completed)
        self.assertIsNone(states[2].progress)
        self.assertEqual(self.conn.execute.call_args_list[0].args[1], ('verified', ['anilist-3', 'anilist-2', 'anilist-1']))
        self.assertEqual(self.conn.execute.call_args_list[1].args[1], (['anilist-1'],))
        provider.assert_not_called()

    def test_override_returns_saved_units_and_completion(self):
        self.conn.execute.return_value.fetchone.return_value = (5, True, True)
        state = progress.update_media_state('verified', 'anilist-1', UserMediaStateUpdate(manual_unlocked=True))
        self.assertEqual(state.progress.unit, 5); self.assertTrue(state.completed)
        args = self.conn.execute.call_args.args[1]
        self.assertEqual(args, ('verified', 'anilist-1', None, True, True))

    def test_prologue_completion_uses_final_canonical_unit(self):
        media = anilist.normalize(entry(19603))
        for unit, completed in ((12, False), (13, True)):
            progress.save_progress('verified', UserProgress(media_id=media.id, progress=RevealPoint(unit=unit)), media)
            self.assertEqual(self.conn.execute.call_args.args[1], ('verified', media.id, unit, completed, 13))
            self.assertEqual(progress._state(media.id, (unit, None, False), {media.id: media.total_units}).completed, completed)

    def test_generated_totals_take_precedence_for_legacy_inference(self):
        for generated_count, unit, expected in ((12, 1, False), (12, 12, True), (None, 12, False)):
            stale = entry(1); stale['episodes'] = 1
            fresh = entry(1); fresh['episodes'] = generated_count
            saved = MagicMock(); saved.fetchall.return_value = [('anilist-1', unit, None, False)]
            catalog = MagicMock(); catalog.fetchall.return_value = [('anilist-1', anilist.normalize(stale).model_dump())]
            generated = MagicMock(); generated.fetchall.return_value = [('anilist-1', anilist.normalize(fresh).model_dump())]
            self.conn.execute.side_effect = [saved, catalog, generated]
            self.assertEqual(progress.get_media_states('verified', ['anilist-1'])[0].completed, expected)

    def test_storage_errors_are_not_empty_watched_lists(self):
        self.conn.execute.side_effect = psycopg.OperationalError('offline')
        from fastapi import HTTPException
        for call in (lambda: progress.get_media_states('u', ['anilist-1']),
                     lambda: progress.update_media_state('u', 'anilist-1', UserMediaStateUpdate(completed=True))):
            with self.assertRaises(HTTPException) as raised: call()
            self.assertEqual(raised.exception.status_code, 503)


class MediaStateApiTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_requires_verified_user_and_rejects_client_owner(self):
        for method, path, body in [('GET', '/api/me/media-state?media_id=anilist-1', None),
                                   ('PUT', '/api/me/media-state/anilist-1', {'manual_unlocked': True})]:
            code, _ = asyncio.run(request(path, method, body)); self.assertEqual(code, 401)
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified')
        with patch('app.main.get_media'), patch('app.services.progress.update_media_state', return_value=UserMediaState(media_id='anilist-1')) as write:
            code, _ = asyncio.run(request('/api/me/media-state/anilist-1', 'PUT', {'manual_unlocked': True}))
            self.assertEqual(code, 200); self.assertEqual(write.call_args.args[0], 'verified')
            write.reset_mock()
            for data in ({}, {'completed': None}, {'completed': True, 'user_id': 'spoof'}):
                code, _ = asyncio.run(request('/api/me/media-state/anilist-1', 'PUT', data))
                self.assertEqual(code, 422)
            write.assert_not_called()

    def test_generated_snapshot_overrides_stale_franchise_bounds(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified')
        stale = entry(1); stale['episodes'] = None
        generated = anilist.normalize(entry(1))
        with patch.object(settings, 'database_url', 'configured'), \
             patch('app.database.connection') as db, \
             patch('app.services.franchises.cached_media', return_value=anilist.normalize(stale)) as local, \
             patch('app.services.anilist.details') as provider, \
             patch('app.main.cached_generation', return_value=None), \
             patch('app.services.progress.save_progress', side_effect=lambda owner, saved, media: saved) as save:
            db.return_value.__enter__.return_value.execute.return_value.fetchone.return_value = (generated.model_dump(),)
            code, details = asyncio.run(request('/api/media/anilist-1'))
            self.assertEqual(code, 200); self.assertEqual(details['total_units'], 12)
            code, _ = asyncio.run(request('/api/media/anilist-1/graph?progress=12'))
            self.assertEqual(code, 200)
            code, data = asyncio.run(request('/api/me/progress/anilist-1', 'PUT', {'unit': 12}))
            self.assertEqual(code, 200); self.assertEqual(data['progress']['unit'], 12)
            self.assertEqual(save.call_args.args[2], generated)
            code, _ = asyncio.run(request('/api/me/progress/anilist-1', 'PUT', {'unit': 13}))
            self.assertEqual(code, 422)
            local.assert_not_called(); provider.assert_not_called()

    def test_prologue_final_unit_is_accepted(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified')
        with patch.object(settings, 'database_url', ''), \
             patch('app.services.anilist.details', return_value=entry(19603)), \
             patch('app.main.cached_generation', return_value=None), \
             patch('app.services.progress.save_progress', side_effect=lambda owner, saved, media: saved):
            code, _ = asyncio.run(request('/api/media/anilist-19603/graph?progress=13'))
            self.assertEqual(code, 200)
            code, data = asyncio.run(request('/api/me/progress/anilist-19603', 'PUT', {'unit': 13}))
            self.assertEqual(code, 200); self.assertEqual(data['progress']['unit'], 13)

    def test_bulk_validation_and_owner(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified')
        with patch('app.services.progress.get_media_states', return_value=[]) as read:
            code, _ = asyncio.run(request('/api/me/media-state?media_id=anilist-1&user_id=spoof'))
            self.assertEqual(code, 200); read.assert_called_once_with('verified', ['anilist-1'])
            for query in ('', '?media_id=', '?media_id=a&media_id=a', '?' + '&'.join(f'media_id={i}' for i in range(51))):
                code, _ = asyncio.run(request('/api/me/media-state' + query))
                self.assertEqual(code, 422)
