import asyncio
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
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
            self.assertIsNone(feed.call_args.args[0])
            self.assertFalse(feed.call_args.args[4])
            self.assertIsNone(feed.call_args.args[5])
            code,_ = asyncio.run(request('/api/community/posts?category=theory'))
            self.assertEqual(code,200)
            self.assertEqual(feed.call_args.args[0],'theory')
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
        all_tags = community.feed(None,'','','latest',False,None,0)
        self.assertIn(theory.id,[post.id for post in all_tags.posts])
        self.assertGreater(len(all_tags.posts),len(feed.posts))
        self.assertNotIn('owner',theory.author)
        self.assertEqual(community.feed('theory','Demo','','latest',False,None,0).posts,[])



class ForumContractTests(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.clear()

    def test_every_forum_mutation_requires_verified_identity(self):
        post, entry = uuid4(), uuid4()
        for path, method, body in [
            (f'/api/community/posts/{post}', 'PUT', {'media':'Charlotte','title':'Topic','body':'Hello'}),
            (f'/api/community/posts/{post}', 'DELETE', None),
            (f'/api/community/comments/{entry}', 'PUT', {'body':'Reply'}),
            (f'/api/community/comments/{entry}', 'DELETE', None),
            (f'/api/community/posts/{post}/entries', 'POST', {'body':'Evidence'}),
            (f'/api/community/posts/{post}/entries/{entry}', 'PUT', {'body':'Evidence'}),
            (f'/api/community/entries/{entry}', 'DELETE', None),
            (f'/api/community/entries/{entry}/action', 'POST', {'action':'lock'}),
        ]:
            self.assertEqual(asyncio.run(request(path,method,body))[0],401)

    def test_room_validation_and_artwork_boundary(self):
        from app.community_models import EntryCreate
        from pydantic import ValidationError
        for bad in ({'category':'discussion','room':'capsule'}, {'category':'review','room':'pitch','body':'One. Two. Three. Four.'}):
            with self.assertRaises(ValidationError):
                PostCreate(media='Charlotte',title='Hello',body=bad.pop('body','Prompt'),**bad)
        for artwork in ('javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk'):
            with self.assertRaises(ValidationError): EntryCreate(kind='art',body='Drawing',artwork=artwork)
        with self.assertRaises(ValidationError): EntryCreate(body='Hi',user_id='spoof')


@unittest.skipUnless(os.getenv('TRUEFAN_COMMUNITY_DB_TESTS') == '1', 'Opt-in temporary-table Neon tests')
class ForumDatabaseTests(CommunityDatabaseTests):
    def test_only_owner_can_modify_topics_replies_and_entries(self):
        from app.community_models import EntryCreate
        post=self.post(room='courtroom')
        self.assertTrue(post.is_owner)
        self.assertFalse(community.read_post(post.id,None,False).is_owner)
        with self.assertRaises(HTTPException): community.update_post(post.id,'other',PostCreate(media='Charlotte',title='Stolen',body='No'))
        reply=community.create_comment(post.id,'owner',CommentCreate(body='Reply'),False)
        with self.assertRaises(HTTPException): community.update_comment(reply.id,'other',CommentCreate(body='Stolen'))
        contribution=community.save_entry(post.id,'owner',EntryCreate(body='Episode evidence',side='a'),False)
        with self.assertRaises(HTTPException): community.save_entry(post.id,'other',EntryCreate(body='Stolen'),False,contribution.id)
        edited=community.save_entry(post.id,'owner',EntryCreate(body='Better evidence',side='b'),False,contribution.id)
        self.assertEqual(edited.body,'Better evidence')
        community.delete_content('community_entries',edited.id,'owner')
        self.assertEqual(community.entries(post.id,None,False),[])

    def test_prediction_drafts_are_private_and_locked_content_is_immutable(self):
        from app.community_models import EntryCreate, EntryAction
        post=self.post(category='theory',room='capsule')
        draft=community.save_entry(post.id,'one',EntryCreate(kind='prediction',body='My guess'),False)
        self.assertEqual(community.entries(post.id,None,False),[])
        self.assertEqual(len(community.entries(post.id,'one',False)),1)
        with self.assertRaises(HTTPException): community.entry_action(draft.id,'one',EntryAction(action='reveal'))
        locked=community.entry_action(draft.id,'one',EntryAction(action='lock'))
        self.assertTrue(locked.locked)
        with self.assertRaises(HTTPException): community.save_entry(post.id,'one',EntryCreate(kind='prediction',body='Changed guess'),False)
        with self.assertRaises(HTTPException): community.delete_content('community_entries',draft.id,'one')
        community.entry_action(draft.id,'one',EntryAction(action='reveal'))
        self.assertEqual(community.entries(post.id,None,False)[0].body,'My guess')

    def test_switching_sides_and_votes_does_not_duplicate_participation(self):
        from app.community_models import EntryCreate
        post=self.post(room='courtroom')
        first=community.save_entry(post.id,'one',EntryCreate(kind='join',side='a'),False)
        second=community.save_entry(post.id,'one',EntryCreate(kind='join',side='b'),False)
        self.assertEqual(first.id,second.id)
        self.assertEqual(len(community.entries(post.id,None,False)),1)
        community.save_entry(post.id,'one',EntryCreate(kind='vote',side='a'),False)
        community.save_entry(post.id,'one',EntryCreate(kind='vote',side='b'),False)
        self.assertEqual([e.side for e in community.entries(post.id,None,False)],['b','b'])

    def test_board_connections_cannot_cross_threads_or_expose_hidden_clues(self):
        from app.community_models import EntryCreate
        post=self.post(category='theory',room='mystery')
        another=self.post(category='theory',room='mystery')
        secret=community.save_entry(post.id,'owner',EntryCreate(kind='clue',body='Hidden',contains_spoilers=True),True)
        public=community.save_entry(post.id,'owner',EntryCreate(kind='clue',body='Visible',connects_to=secret.id),True)
        visible=community.entries(post.id,None,False)
        self.assertEqual([e.body for e in visible],['Visible'])
        self.assertIsNone(visible[0].connects_to)
        with self.assertRaises(HTTPException): community.save_entry(another.id,'owner',EntryCreate(kind='clue',body='Cross board',connects_to=public.id),True)

    def test_only_requester_can_mark_recommendations_tried(self):
        from app.community_models import EntryCreate, EntryAction
        post=self.post(category='review',room='matchmaking')
        recommendation=community.save_entry(post.id,'fan',EntryCreate(kind='recommendation',body='Try this show'),False)
        with self.assertRaises(HTTPException): community.entry_action(recommendation.id,'fan',EntryAction(action='tried'))
        self.assertTrue(community.entry_action(recommendation.id,'owner',EntryAction(action='tried')).tried)


@unittest.skipUnless(os.getenv('TRUEFAN_COMMUNITY_DB_TESTS') == '1', 'Opt-in temporary-table Neon tests')
class ThreadedCommentDatabaseTests(CommunityDatabaseTests):
    def test_reply_chain_visibility_edit_and_parent_deletion(self):
        post = self.post()
        root = community.create_comment(post.id,'one',CommentCreate(body='Main'),False)
        child = community.create_comment(post.id,'two',CommentCreate(body='Reply',parent_id=root.id),False)
        nested = community.create_comment(post.id,'three',CommentCreate(body='Nested',parent_id=child.id),False)
        self.assertEqual(nested.reply_to_author,child.author)
        self.assertEqual(community.read_post(post.id,None,False).comments,3)
        community.update_comment(root.id,'one',CommentCreate(body='Hidden main',contains_spoilers=True))
        self.assertEqual(community.comments(post.id,None,False),[])
        self.assertEqual(community.read_post(post.id,None,False).comments,0)
        self.assertEqual(len(community.comments(post.id,None,True)),3)
        with self.assertRaises(HTTPException):
            community.create_comment(post.id,'other',CommentCreate(body='Hidden target',parent_id=nested.id),False)
        community.update_comment(root.id,'one',CommentCreate(body='Main'))
        community.delete_content('community_comments',root.id,'one')
        remaining = community.comments(post.id,None,False)
        self.assertEqual(len(remaining),2)
        surviving_child = next(comment for comment in remaining if comment.id == child.id)
        self.assertIsNone(surviving_child.parent_id)
        self.assertIsNone(surviving_child.reply_to_author)

    def test_cross_post_missing_and_spoiler_targets(self):
        post, other = self.post(), self.post()
        root = community.create_comment(post.id,'one',CommentCreate(body='Secret',contains_spoilers=True),True)
        for target_post,target,show in ((other.id,root.id,True),(post.id,uuid4(),True),(post.id,root.id,False)):
            with self.assertRaises(HTTPException):
                community.create_comment(target_post,'two',CommentCreate(body='Reply',parent_id=target),show)
        reply = community.create_comment(post.id,'two',CommentCreate(body='Reply',parent_id=root.id),True)
        self.assertTrue(reply.contains_spoilers)
        with self.assertRaises(HTTPException):
            community.update_comment(reply.id,'attacker',CommentCreate(body='Stolen'))

    def test_board_layout_persists_and_owner_cannot_be_spoofed(self):
        from app.community_models import EntryCreate
        post = self.post(category='theory',room='mystery')
        clue = community.save_entry(post.id,'one',EntryCreate(kind='clue',body='Clue',shape='diamond',board_x=110,board_y=-50),False)
        moved = community.save_entry(post.id,'one',EntryCreate(kind='clue',body='Clue',shape='circle',board_x=280,board_y=90),False,clue.id)
        self.assertEqual((moved.shape,moved.board_x,moved.board_y),('circle',280,90))
        self.assertEqual(community.entries(post.id,'one',False)[0].board_x,280)
        with self.assertRaises(HTTPException):
            community.save_entry(post.id,'other',EntryCreate(kind='clue',body='Stolen',board_x=0),False,clue.id)


class BoardContractTests(unittest.TestCase):
    def test_rejects_invalid_board_shapes_and_nonfinite_positions(self):
        from app.community_models import EntryCreate
        from pydantic import ValidationError
        for values in ({'shape':'triangle'}, {'board_x':float('nan')}, {'board_y':float('inf')}, {'board_x':10001}):
            with self.assertRaises(ValidationError):
                EntryCreate(kind='clue',body='Clue',**values)


class CommentWindowTests(unittest.TestCase):
    def test_deadline_is_fixed_and_exact_boundary_is_rejected(self):
        from app.community_models import CommunityComment
        created = datetime.now(timezone.utc)
        comment = CommunityComment(id=uuid4(),author='Fan',body='Hi',contains_spoilers=False,created_at=created)
        self.assertEqual(comment.editable_until,created+timedelta(minutes=10))
        with patch('app.services.community.datetime') as clock:
            clock.now.return_value = created+timedelta(minutes=10)-timedelta(microseconds=1)
            community.require_comment_window({'created_at':created})
            clock.now.return_value = created+timedelta(minutes=10)
            with self.assertRaises(HTTPException) as raised:
                community.require_comment_window({'created_at':created})
            self.assertEqual(raised.exception.status_code,409)

    def test_image_validation_and_image_only_comments(self):
        import base64
        from pydantic import ValidationError
        image = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n').decode()
        self.assertEqual(CommentCreate(image=image).image,image)
        for value in ('https://example.com/image.png','data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YmFk'):
            with self.assertRaises(ValidationError): CommentCreate(body='Image',image=value)
            with self.assertRaises(ValidationError): PostCreate(media='Demo',title='Picture',body='Hello',image=value)
        with self.assertRaises(ValidationError): CommentCreate(body=' ')


@unittest.skipUnless(os.getenv('TRUEFAN_COMMUNITY_DB_TESTS') == '1', 'Opt-in temporary-table Neon tests')
class CommentImageDatabaseTests(CommunityDatabaseTests):
    def test_images_persist_and_hidden_comment_images_are_not_returned(self):
        import base64
        image = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n').decode()
        post = self.post(image=image)
        self.assertEqual(community.read_post(post.id,None,False).image,image)
        reply = community.create_comment(post.id,'one',CommentCreate(image=image),False)
        self.assertEqual(community.comments(post.id,None,False)[0].image,image)
        updated = community.update_comment(reply.id,'one',CommentCreate(body='Caption',image=image,contains_spoilers=True))
        self.assertEqual(updated.image,image)
        self.assertEqual(community.comments(post.id,None,False),[])
        self.assertEqual(community.comments(post.id,None,True)[0].image,image)

    def test_expired_comments_cannot_be_edited_or_deleted_by_owner(self):
        post = self.post()
        reply = community.create_comment(post.id,'one',CommentCreate(body='Original'),False)
        community.update_comment(reply.id,'one',CommentCreate(body='Edited'))
        self.conn.execute("UPDATE community_comments SET created_at=now()-interval '10 minutes' WHERE id=%s",(reply.id,))
        for operation in (lambda: community.update_comment(reply.id,'one',CommentCreate(body='Late edit')),
                          lambda: community.delete_content('community_comments',reply.id,'one')):
            with self.assertRaises(HTTPException) as raised: operation()
            self.assertEqual(raised.exception.status_code,409)
        self.assertEqual(community.comments(post.id,None,False)[0].body,'Edited')


if __name__ == '__main__': unittest.main()
