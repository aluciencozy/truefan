"""Optional real Postgres lifecycle tests, isolated from application/user tables."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch
import psycopg
from app.services import generation
from app.config import settings

class Proxy:
    def __init__(self,target,namespace):self.target=target;self.namespace=namespace
    def execute(self,sql,params=None):
        result=self.target.execute(sql.replace('public.',self.namespace+'.'),params)
        return Proxy(result,self.namespace)
    def cursor(self,**kwargs):return Proxy(self.target.cursor(**kwargs),self.namespace)
    def __enter__(self):self.target.__enter__();return self
    def __exit__(self,*args):return self.target.__exit__(*args)
    def __getattr__(self,name):return getattr(self.target,name)

@unittest.skipUnless(os.environ.get('TRUEFAN_TEST_DATABASE_URL'),'Set TRUEFAN_TEST_DATABASE_URL for isolated Postgres tests')
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.url=os.environ['TRUEFAN_TEST_DATABASE_URL'];cls.namespace='truefan_test_'+uuid.uuid4().hex[:12]
        with psycopg.connect(cls.url) as conn:
            conn.execute('CREATE SCHEMA '+cls.namespace)
            conn.execute(Path('app/schema.sql').read_text().replace('public.',cls.namespace+'.'))
    @classmethod
    def tearDownClass(cls):
        with psycopg.connect(cls.url) as conn:conn.execute('DROP SCHEMA '+cls.namespace+' CASCADE')
    def setUp(self):
        with psycopg.connect(self.url) as conn:
            conn.execute('TRUNCATE '+self.namespace+'.generated_graphs,'+self.namespace+'.graph_generation_requests')
        @contextmanager
        def connection():
            with psycopg.connect(self.url) as conn:yield Proxy(conn,self.namespace)
        self.enterContext(patch('app.services.generation.connection',connection))
        self.enterContext(patch.object(settings,'hf_token','test-only'))
        self.enterContext(patch.object(settings,'generation_admin_subject','developer'))
        self.enterContext(patch('app.services.generation.anilist.details',return_value={'id':1,'title':{'english':'Title'},'episodes':10,'format':'TV'}))
    def test_concurrent_enqueue_idempotent_shared_cache(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            rows=list(pool.map(lambda _:generation.enqueue('anilist-1','user-a'),range(4)))
        self.assertTrue(all(r['status']=='queued' for r in rows))
        with psycopg.connect(self.url) as conn:
            count=conn.execute('SELECT count(*) FROM '+self.namespace+'.graph_generation_requests').fetchone()[0]
        self.assertEqual(count,1)
        generation.enqueue('anilist-1','user-b')
        with psycopg.connect(self.url) as conn:self.assertEqual(conn.execute('SELECT count(*) FROM '+self.namespace+'.graph_generation_requests').fetchone()[0],1)
    def test_claim_fencing_and_restart_resume(self):
        generation.enqueue('anilist-1','user-a');old=generation.claim();self.assertIsNone(generation.claim())
        doc={'episodes':[]};self.assertTrue(generation.checkpoint(old,doc,'generating'))
        with psycopg.connect(self.url) as conn:conn.execute("UPDATE "+self.namespace+".generated_graphs SET lease_until=now()-interval '1 second'")
        new=generation.claim();self.assertNotEqual(old['lease_token'],new['lease_token'])
        self.assertFalse(generation.checkpoint(old,doc,'ready',finish=True))
        self.assertTrue(generation.checkpoint(new,doc,'ready',finish=True))
    def test_refresh_failure_preserves_cached_graph(self):
        generation.enqueue('anilist-1','user-a');row=generation.claim()
        original={'episodes':[{'episode':{'unit':1},'status':'done','characters':[{'name':'Ada'}]}]}
        generation.checkpoint(row,original,'ready',finish=True)
        generation.enqueue('anilist-1','developer','refresh');refresh=generation.claim()
        generation.checkpoint(refresh,{'episodes':[]},'failed',finish=True)
        self.assertEqual(generation.get('anilist-1')['document'],original)
    def test_limits_and_admin_refresh(self):
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as raised:generation.enqueue('anilist-1','user','refresh')
        self.assertEqual(raised.exception.status_code,403)
        with patch.object(settings,'generation_jobs_per_user',1):
            generation.enqueue('anilist-1','user')
            with self.assertRaises(HTTPException) as raised:generation.enqueue('anilist-2','user')
        self.assertEqual(raised.exception.status_code,429)
