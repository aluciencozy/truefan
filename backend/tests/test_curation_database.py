"""Optional real Postgres checks using a disposable schema, never application rows."""
from contextlib import contextmanager
import copy
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import uuid
from unittest.mock import patch
import psycopg
from psycopg.types.json import Jsonb
from app.config import settings
from app.services import curation, generation
from scripts.replace_generated_graphs import replace
from test_generation_database import Proxy


@unittest.skipUnless(os.environ.get('TRUEFAN_TEST_DATABASE_URL'), 'Requires an isolated Postgres test connection')
class CurationDatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url = os.environ['TRUEFAN_TEST_DATABASE_URL']
        cls.namespace = 'truefan_curation_test_' + uuid.uuid4().hex[:12]
        with psycopg.connect(cls.url) as conn:
            conn.execute('CREATE SCHEMA ' + cls.namespace)
            conn.execute(Path('app/schema.sql').read_text().replace('public.', cls.namespace + '.'))

    @classmethod
    def tearDownClass(cls):
        with psycopg.connect(cls.url) as conn:
            conn.execute('DROP SCHEMA ' + cls.namespace + ' CASCADE')

    def setUp(self):
        self.dataset = curation.load()
        with psycopg.connect(self.url) as target:
            conn = Proxy(target, self.namespace)
            conn.execute('TRUNCATE public.generated_graphs,public.user_progress,public.graph_generation_requests')
            ids = [g.media_id for g in self.dataset.graphs] + self.dataset.clear_empty_media_ids + ['anilist-999']
            for media_id in ids:
                media = dict(id=media_id, title='Test', type='anime', progress_unit='episode',
                             total_units=24, description='')
                conn.execute('''INSERT INTO public.generated_graphs
                    (media_id,media,model,episode_cap,requested_by,status,lease_token,lease_until)
                    VALUES(%s,%s,'old-model',6,'user','failed','old-token',now()+interval '5 minutes')''',
                    (media_id, Jsonb(media)))
            conn.execute("INSERT INTO public.user_progress(user_id,media_id,completed_unit) VALUES('user','anilist-10087',4)")
            conn.execute("INSERT INTO public.graph_generation_requests(user_id,media_id) VALUES('user','anilist-10087')")

    def test_swap_preserves_other_data_and_fences_workers(self):
        with TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup.json'
            with psycopg.connect(self.url) as target:
                conn = Proxy(target, self.namespace)
                plan = replace(conn, self.dataset)
                self.assertEqual(conn.execute("SELECT count(*) FROM public.generated_graphs WHERE model='old-model'").fetchone()[0], 9)
                self.assertEqual(replace(conn, self.dataset, backup), plan)
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
            self.assertEqual(len(json.loads(backup.read_text())), 8)
            with psycopg.connect(self.url) as target:
                conn = Proxy(target, self.namespace)
                self.assertEqual(conn.execute('SELECT count(*) FROM public.generated_graphs').fetchone()[0], 8)
                self.assertEqual(conn.execute("SELECT model FROM public.generated_graphs WHERE media_id='anilist-999'").fetchone()[0], 'old-model')
                self.assertEqual(conn.execute('SELECT completed_unit FROM public.user_progress').fetchone()[0], 4)
                self.assertEqual(conn.execute('SELECT count(*) FROM public.graph_generation_requests').fetchone()[0], 1)
                self.assertEqual(conn.execute('SELECT count(*) FROM public.generated_graphs WHERE lease_token IS NULL').fetchone()[0], 7)
            @contextmanager
            def connection():
                with psycopg.connect(self.url) as target:
                    yield Proxy(target, self.namespace)
            with patch('app.services.generation.connection', connection), patch.object(settings, 'hf_token', 'test'), patch.object(settings, 'generation_admin_subject', 'developer'), patch('app.services.generation.anilist.details', return_value={'id':10087,'title':{'english':'Test'},'episodes':24,'format':'TV'}):
                for operation in ('start', 'retry', 'extend', 'refresh'):
                    self.assertTrue(generation.enqueue('anilist-10087', 'developer', operation)['document']['source_curated'])
                self.assertFalse(generation.checkpoint(dict(media_id='anilist-10087',lease_token='old-token',regenerating=False), {'episodes':[]}, 'ready', finish=True))
            with psycopg.connect(self.url) as target:
                self.assertEqual(Proxy(target, self.namespace).execute('SELECT count(*) FROM public.graph_generation_requests').fetchone()[0], 1)

    def test_validation_failure_changes_nothing(self):
        dataset = copy.deepcopy(self.dataset)
        dataset.graphs[-1].episodes[0].relationships[0].target = 'Future character'
        with TemporaryDirectory() as directory:
            backup = Path(directory) / 'backup.json'
            with psycopg.connect(self.url) as target:
                conn = Proxy(target, self.namespace)
                with self.assertRaises(ValueError):
                    replace(conn, dataset, backup)
                self.assertEqual(conn.execute("SELECT count(*) FROM public.generated_graphs WHERE model='old-model'").fetchone()[0], 9)
                self.assertFalse(backup.exists())

    def test_nonempty_cleanup_target_is_never_deleted(self):
        with psycopg.connect(self.url) as target:
            conn = Proxy(target, self.namespace)
            conn.execute("UPDATE public.generated_graphs SET working_document=%s WHERE media_id='anilist-139074'", (Jsonb({'episodes':[{'status':'done'}]}),))
            with self.assertRaises(ValueError):
                replace(conn, self.dataset)
            self.assertEqual(conn.execute('SELECT count(*) FROM public.generated_graphs').fetchone()[0], 9)
