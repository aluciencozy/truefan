"""Opt-in real Postgres checks against a dedicated test database, isolated schema."""
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace
import os
import unittest
from unittest.mock import patch
from uuid import uuid4
import psycopg
from psycopg.types.json import Jsonb
from app.services import library
from app.services.demo import MEDIA
from app.library_models import UniversePreferences
from app.schemas import Media
from test_generation_database import Proxy

@unittest.skipUnless(os.environ.get('TRUEFAN_TEST_DATABASE_URL'), 'Set TRUEFAN_TEST_DATABASE_URL for isolated library SQL tests')
class LibraryDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.url=os.environ['TRUEFAN_TEST_DATABASE_URL']; self.namespace='truefan_library_'+uuid4().hex[:12]
        with psycopg.connect(self.url) as conn:
            conn.execute('CREATE SCHEMA '+self.namespace)
            conn.execute(Path('app/schema.sql').read_text().replace('public.',self.namespace+'.'))
        @contextmanager
        def connection():
            with psycopg.connect(self.url) as conn: yield Proxy(conn,self.namespace)
        self.connection=connection
        self.enterContext(patch('app.services.library.connection',connection))
    def tearDown(self):
        with psycopg.connect(self.url) as conn: conn.execute('DROP SCHEMA '+self.namespace+' CASCADE')
    def test_legacy_materialization_preserves_known_completion_and_abandon_history(self):
        with self.connection() as conn:
            conn.execute("INSERT INTO public.user_progress(user_id,media_id,completed_unit) VALUES('a','lantern-harbor',3)")
        self.assertEqual(library.list_saved('a')[0].viewed_count,1)
        saved=library.update('a',MEDIA.id,UniversePreferences(pinned=True,rating=4))
        self.assertTrue(saved.pinned); self.assertEqual(saved.rating,4); self.assertEqual(saved.viewed_count,1)
        library.update('a',MEDIA.id,None)
        self.assertEqual(library.list_saved('a'),[])
        with self.connection() as conn:
            self.assertEqual(conn.execute("SELECT completed_unit FROM public.user_progress WHERE user_id='a'").fetchone()[0],3)
        restored=library.save('a',MEDIA.id)
        self.assertTrue(restored.pinned); self.assertEqual(restored.rating,4)
        self.assertEqual(library.list_saved('b'),[])
    def test_sequel_resave_restores_group_and_weak_members_do_not_merge_it(self):
        works=[Media(id=f'anilist-{n}',title=f'Story {n}',type='anime',progress_unit='episode',total_units=12,total_units_known=True,description='') for n in [1,2,3]]
        with self.connection() as conn:
            conn.execute("INSERT INTO public.franchises(id,display_name,discovery_status,discovery) VALUES('group','Story','bounded',%s)",(Jsonb({'strong_ids':['anilist-1','anilist-2']}),))
            for work in works:
                conn.execute("INSERT INTO public.franchise_media(franchise_id,media_id,anilist_id,media) VALUES('group',%s,%s,%s)",(work.id,int(work.id.split('-')[1]),Jsonb(work.model_dump(mode='json'))))
            conn.execute("INSERT INTO public.user_progress(user_id,media_id,completed_unit,completed) VALUES('a','anilist-1',12,false),('a','anilist-2',0,true)")
        item=library.list_saved('a')[0]
        self.assertEqual((item.viewed_count,item.total_count),(1,3))
        library.update('a',item.media_id,UniversePreferences(pinned=True,rating=5))
        library.update('a',item.media_id,None)
        self.assertEqual(library.list_saved('a'),[])
        with patch('app.services.library.franchises.universe',return_value=SimpleNamespace(media=works)):
            restored=library.save('a','anilist-2')
            self.assertEqual(restored.media_id,item.media_id); self.assertEqual(restored.rating,5)
            self.assertTrue(restored.pinned)
            boundary=library.save('a','anilist-3')
            self.assertEqual(boundary.media_id,'anilist-3')
        self.assertEqual(len(library.list_saved('a')),2)
        self.assertEqual(library.list_saved('b'),[])
