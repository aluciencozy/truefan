import asyncio
from datetime import datetime, timezone
from unittest import TestCase
from unittest.mock import patch
from contextlib import contextmanager
import httpx
from pydantic import ValidationError
from app.auth import current_user
from app.main import app
from app.schemas import CurrentUser, Media, MediaReleaseDate
from app.library_models import UniversePreferences
from app.services import library

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)

def media(number, year=None, known=True):
    return Media(id=f'anilist-{number}', title=f'Story {number}', type='anime', progress_unit='episode',
                 total_units=12, total_units_known=known, description='PRIVATE SYNOPSIS',
                 release_date=MediaReleaseDate(year=year) if year else None)

def record(root, **changes):
    values = dict(root_media_id=root.id,root_media=root.model_dump(), saved_at=NOW,
                  last_explored_at=NOW,pinned=False,rating=None,abandoned=False)
    return {**values, **changes}

def state(number, completed=None, unit=12, manual=False):
    return dict(media_id=f'anilist-{number}',completed=completed,completed_unit=unit,
                manual_unlocked=manual,updated_at=NOW)

async def request(path, method='GET', body=None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
        return await client.request(method,path,json=body)

class ReadConnection:
    def __init__(self, records, states, catalog):
        self.results=iter([records,states,catalog,[]]); self.calls=[]
    def cursor(self,**kwargs): return self
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def execute(self,sql,params):
        self.calls.append((sql,params)); return self
    def fetchall(self): return next(self.results)

class LibraryRulesTests(TestCase):
    def test_counts_completed_works_not_episodes_and_orders_release_dates(self):
        works=[media(1,2020),media(2,2010),media(3,None,False),media(4,2022)]
        states={r['media_id']:r for r in [state(1),state(2,False,99,True),state(3,None,999,True),state(4,True,0)]}
        result=library.build_item(record(works[0]), works+[works[0]], states,incomplete=True)
        self.assertEqual([t.media_id for t in result.titles],['anilist-2','anilist-1','anilist-4','anilist-3'])
        self.assertEqual((result.viewed_count,result.total_count),(2,4))
        self.assertNotIn('PRIVATE SYNOPSIS',result.model_dump_json())
        self.assertTrue(result.coverage_incomplete)
    def test_grouped_legacy_progress_and_owner_scoped_reads_without_network(self):
        works=[media(1,2020),media(2,2021)]
        catalog=[dict(id='group',discovery={'strong_ids':[w.id for w in works]},media_id=w.id,media=w.model_dump()) for w in works]
        conn=ReadConnection([], [state(1),state(2,False)],catalog)
        with patch('app.services.library.franchises.universe') as discover:
            result=library.collect(conn,'verified-owner')
        discover.assert_not_called()
        self.assertEqual(len(result),1); self.assertEqual(result[0].total_count,2)
        self.assertEqual(result[0].viewed_count,1)
        self.assertEqual(conn.calls[0][1],('verified-owner',)); self.assertEqual(conn.calls[1][1],('verified-owner',))
    def test_abandoned_group_does_not_reappear_from_sequel_progress(self):
        works=[media(1),media(2)]
        catalog=[dict(id='group',discovery={'strong_ids':[w.id for w in works]},media_id=w.id,media=w.model_dump()) for w in works]
        self.assertEqual(library.collect(ReadConnection([record(works[0], abandoned=True)], [state(2)],catalog),'owner'),[])
    def test_explicit_pins_and_ratings_survive_grouped_progress_import(self):
        works=[media(1),media(2)]
        catalog=[dict(id='group',discovery={'strong_ids':[w.id for w in works]},media_id=w.id,media=w.model_dump()) for w in works]
        saved=record(works[0],pinned=True,rating=4)
        result=library.collect(ReadConnection([saved],[state(2)],catalog),'owner')
        self.assertEqual(len(result),1); self.assertTrue(result[0].pinned); self.assertEqual(result[0].rating,4)
    def test_strict_preference_contract(self):
        for values in ({},{'pinned':None},{'pinned':'true'},{'rating':0},{'rating':6},{'rating':True},{'user_id':'spoof','pinned':True}):
            with self.assertRaises(ValidationError): UniversePreferences(**values)
        self.assertIsNone(UniversePreferences(rating=None).rating)

class LibraryApiTests(TestCase):
    def tearDown(self): app.dependency_overrides.clear()
    def test_every_endpoint_requires_verified_identity(self):
        for suffix,method,body in [('', 'GET',None),('/anilist-1','POST',None),('/anilist-1','PUT',{'pinned':True}),('/anilist-1/abandon','POST',None)]:
            self.assertEqual(asyncio.run(request('/api/me/universes'+suffix,method,body)).status_code,401)
    def test_verified_owner_passed_and_preferences_cannot_spoof_it(self):
        app.dependency_overrides[current_user]=lambda:CurrentUser(id='verified-owner')
        with patch('app.services.library.list_saved',return_value=[]) as listing:
            self.assertEqual(asyncio.run(request('/api/me/universes')).status_code,200)
            listing.assert_called_once_with('verified-owner')
        with patch('app.services.library.update') as update:
            self.assertEqual(asyncio.run(request('/api/me/universes/anilist-1','PUT',{'pinned':True,'user_id':'other'})).status_code,422)
            update.assert_not_called()
        with patch('app.services.library.update',return_value={'media_id':'anilist-1','abandoned':True}) as update:
            self.assertEqual(asyncio.run(request('/api/me/universes/anilist-1/abandon','POST')).status_code,200)
            update.assert_called_once_with('verified-owner','anilist-1',None)
    def test_storage_error_is_not_an_empty_library(self):
        app.dependency_overrides[current_user]=lambda:CurrentUser(id='owner')
        with patch('app.services.library.connection',side_effect=RuntimeError('unconfigured')):
            self.assertEqual(asyncio.run(request('/api/me/universes')).status_code,503)
    def test_abandon_unknown_or_other_owners_universe_is_404(self):
        @contextmanager
        def storage(): yield object()
        with patch('app.services.library.storage',storage),patch('app.services.library.collect',return_value=[]):
            from fastapi import HTTPException
            with self.assertRaises(HTTPException) as raised: library.update('owner','anilist-1',None)
            self.assertEqual(raised.exception.status_code,404)
