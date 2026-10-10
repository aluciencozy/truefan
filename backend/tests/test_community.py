import asyncio
from contextlib import contextmanager
from datetime import datetime, timezone
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
import psycopg
from psycopg.rows import dict_row
from fastapi import HTTPException

from app.auth import current_user
from app.community_api import optional_user
from app.community_models import PostCreate, CommunityPost, CommentCreate, PresenceRequest
from app.config import settings
from app.main import app
from app.schemas import CurrentUser
from app.services import community


async def request(path: str, method: str = 'GET', body: dict | None = None):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.request(method,path,json=body)
        return response.status_code,response.json()


class CommunityApiTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_mutations_require_neon_identity(self):
        post_id = uuid4()
        for path,method,body in [('/api/community/posts','POST',{'media':'Demo','title':'Hi','body':'Hello'}),
                                (f'/api/community/posts/{post_id}/like','PUT',{'liked':True}),
                                (f'/api/community/posts/{post_id}/comments','POST',{'body':'Hi'}),
                                ('/api/community/library','GET',None)]:
            self.assertEqual(asyncio.run(request(path,method,body))[0],401)

    def test_validated_owner_and_rejected_spoofed_owner(self):
        app.dependency_overrides[current_user] = lambda: CurrentUser(id='verified-user')
        draft = {'media':'Demo','title':'Hi','body':'Hello'}
        result = CommunityPost(id=uuid4(),author='Fan',created_at=datetime.now(timezone.utc),**draft)
        with patch('app.services.community.create_post',return_value=result) as create:
            self.assertEqual(asyncio.run(request('/api/community/posts','POST',draft))[0],201)
            self.assertEqual(create.call_args.args[0],'verified-user')
            for changed in ({**draft,'user_id':'attacker'},{**draft,'author':'someone else'},
                            {**draft,'body':'  '},{**draft,'rating':8}):
                self.assertEqual(asyncio.run(request('/api/community/posts','POST',changed))[0],422)

    def test_default_spoiler_filter_and_valid_query_bounds(self):
        with patch('app.services.community.feed',return_value={'posts':[],'media':[],'active_fans':0}) as feed:
            code,_ = asyncio.run(request('/api/community/posts'))
            self.assertEqual(code,200)
            self.assertFalse(feed.call_args.args[4])
            self.assertIsNone(feed.call_args.args[5])
            for query in ('category=unknown','offset=-1','sort=unsafe','q='+'a'*201):
                self.assertEqual(asyncio.run(request('/api/community/posts?'+query))[0],422)

    def test_presence_requires_uuid_and_uses_server_identity(self):
        visitor = str(uuid4())
        with patch('app.services.community.heartbeat',return_value={'active_fans':1,'window_seconds':90}) as beat:
            code,data = asyncio.run(request('/api/community/presence','POST',{'visitor_id':visitor}))
            self.assertEqual(code,200); self.assertEqual(data['active_fans'],1)
            self.assertIsNone(beat.call_args.args[1])
            self.assertEqual(asyncio.run(request('/api/community/presence','POST',{'visitor_id':visitor,'user_id':'spoof'}))[0],422)
            self.assertEqual(asyncio.run(request('/api/community/presence','POST',{'visitor_id':'not-uuid'}))[0],422)

    def test_storage_failure_is_not_fake_empty_feed(self):
        with patch('app.services.community.connection',side_effect=RuntimeError('unconfigured')):
            self.assertEqual(asyncio.run(request('/api/community/posts'))[0],503)


@unittest.skipUnless(os.getenv('TRUEFAN_COMMUNITY_DB_TESTS') == '1', 'Opt-in temporary-table Neon tests')
class CommunityDatabaseTests(unittest.TestCase):
    """Real PostgreSQL, temporary tables only; no writes to the live app's tables."""
    def setUp(self):
        self.conn = psycopg.connect(settings.database_url,connect_timeout=5,row_factory=dict_row)
        schema = Path(__file__).resolve().parents[1] / 'app/community_schema.sql'
        temporary_sql = schema.read_text().replace('CREATE TABLE IF NOT EXISTS public.', 'CREATE TEMP TABLE ')
        temporary_sql = temporary_sql.replace('public.community_', 'community_')
        self.conn.execute(temporary_sql)
        connection = self.conn

        class TestCursor:
            def __init__(self,inner): self.inner = inner
            def __enter__(self): return self
            def __exit__(self,*args): self.inner.close()
            def execute(self,sql,params=None):
                return self.inner.execute(sql.replace('public.community_','pg_temp.community_'),params)
            def fetchone(self): return self.inner.fetchone()
            def fetchall(self): return self.inner.fetchall()

        class TestConnection:
            def cursor(self,**kwargs): return TestCursor(connection.cursor(**kwargs))

        @contextmanager
        def isolated_connection():
            yield TestConnection()

        self.enterContext(patch('app.services.community.connection',isolated_connection))

    def tearDown(self):
        self.conn.rollback(); self.conn.close()

    def post(self,**updates):
        values = {'media':'Demo','title':'Hello universe','body':'Welcome fans'}
        values.update(updates)
        return community.create_post('owner',PostCreate(**values))

    def test_idempotent_likes_remove_only_own_vote(self):
        post = self.post()
        self.assertEqual(community.set_like(post.id,'one',True,False).likes,1)
        self.assertEqual(community.set_like(post.id,'one',True,False).likes,1)
        self.assertEqual(community.set_like(post.id,'two',True,False).likes,2)
        result = community.set_like(post.id,'one',False,False)
        self.assertEqual(result.likes,1); self.assertFalse(result.liked)
        self.assertTrue(community.read_post(post.id,'two',False).liked)

    def test_hidden_posts_do_not_leak_text_media_search_or_details(self):
        visible = self.post()
        hidden = self.post(title='Secret ending',media='Secret title',body='Future fact',contains_spoilers=True)
        public = community.feed('discussion','','','latest',False,None,0)
        self.assertEqual([post.id for post in public.posts],[visible.id])
        self.assertNotIn('Secret title',public.media)
        self.assertEqual(community.feed('discussion','','Future','latest',False,None,0).posts,[])
        for operation in (lambda: community.read_post(hidden.id,None,False),
                          lambda: community.comments(hidden.id,None,False),
                          lambda: community.set_like(hidden.id,'one',True,False)):
            with self.assertRaises(HTTPException) as raised: operation()
            self.assertEqual(raised.exception.status_code,404)
        self.assertEqual(len(community.feed('discussion','','','latest',True,None,0).posts),2)

    def test_spoiler_comments_filtered_from_bodies_and_counts(self):
        post = self.post()
        community.create_comment(post.id,'one',CommentCreate(body='Hi fans'),False)
        community.create_comment(post.id,'two',CommentCreate(body='Secret reply',contains_spoilers=True),False)
        self.assertEqual(community.read_post(post.id,None,False).comments,1)
        self.assertEqual(community.read_post(post.id,None,True).comments,2)
        self.assertEqual([comment.body for comment in community.comments(post.id,None,False)],['Hi fans'])
        hidden = self.post(contains_spoilers=True)
        child = community.create_comment(hidden.id,'one',CommentCreate(body='Reply'),True)
        self.assertTrue(child.contains_spoilers)

    def test_presence_deduplication_and_expiry(self):
        one,two = uuid4(),uuid4()
        self.assertEqual(community.heartbeat(PresenceRequest(visitor_id=one),None).active_fans,1)
        self.assertEqual(community.heartbeat(PresenceRequest(visitor_id=one),None).active_fans,1)
        self.assertEqual(community.heartbeat(PresenceRequest(visitor_id=two),None).active_fans,2)
        community.heartbeat(PresenceRequest(visitor_id=one),'same-user')
        self.assertEqual(community.heartbeat(PresenceRequest(visitor_id=two),'same-user').active_fans,1)
        self.conn.execute("UPDATE community_presence SET last_seen=now()-interval '91 seconds'")
        with community.storage() as cursor: self.assertEqual(community.active_count(cursor),0)

    def test_filters_popularity_and_public_pseudonyms(self):
        discussion = self.post()
        theory = self.post(category='theory',media='Different',title='Prediction')
        community.set_like(discussion.id,'liker',True,False)
        feed = community.feed('theory','Different','Prediction','popular',False,None,0)
        self.assertEqual([post.id for post in feed.posts],[theory.id])
        self.assertNotIn('owner',theory.author)
        self.assertEqual(community.feed('theory','Demo','','latest',False,None,0).posts,[])


if __name__ == '__main__': unittest.main()
