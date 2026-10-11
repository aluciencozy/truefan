from contextlib import contextmanager
from collections.abc import Iterator
from typing import Any
import hashlib
import re
from uuid import UUID, uuid4

import psycopg
from psycopg import Cursor
from psycopg.rows import dict_row
from app.community_models import EntryCreate, EntryAction, ForumEntry
from fastapi import HTTPException

from app.database import connection
from app.community_models import (Category, CommentCreate, CommunityComment, CommunityFeed,
                                   CommunityPost, PostCreate, PresenceRequest, PresenceResponse, LibraryItem)


@contextmanager
def storage() -> Iterator[Cursor[dict[str, Any]]]:
    try:
        with connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                yield cur
    except (RuntimeError, psycopg.Error):
        raise HTTPException(503, 'Community storage unavailable. Configure DATABASE_URL and run python -m app.init_community.') from None


def author_name(user_id: str) -> str:
    # A public pseudonym; never disclose JWT subjects or email addresses.
    return 'Fan ' + hashlib.sha256(user_id.encode()).hexdigest()[:8]


def active_count(cur: Cursor[dict[str, Any]]) -> int:
    cur.execute("""SELECT count(DISTINCT COALESCE(user_id, 'visitor:' || visitor_id::text)) AS total
                   FROM public.community_presence WHERE last_seen > now() - interval '90 seconds'""")
    return cur.fetchone()['total']


def post_select() -> str:
    return """SELECT p.id, p.author, p.category, p.media, p.title, p.body, p.contains_spoilers,
                     p.rating, p.example, p.created_at, p.room, p.side_a, p.side_b, p.target_episode,
                     COALESCE(p.user_id=%s,false) AS is_owner,
               (SELECT count(*) FROM public.community_likes l WHERE l.post_id=p.id) AS likes,
               (SELECT count(*) FROM public.community_comments c WHERE c.post_id=p.id
                    AND (NOT c.contains_spoilers OR %s)) AS comments,
               EXISTS(SELECT 1 FROM public.community_likes l WHERE l.post_id=p.id AND l.user_id=%s) AS liked
               FROM public.community_posts p"""


def find_post(cur: Cursor[dict[str, Any]], post_id: UUID, user_id: str | None, include_spoilers: bool) -> CommunityPost:
    cur.execute(post_select() + ' WHERE p.id=%s AND (NOT p.contains_spoilers OR %s)',
                (user_id, include_spoilers, user_id, post_id, include_spoilers))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, 'Post not found or spoiler content is hidden')
    return CommunityPost.model_validate(row)


def feed(category: Category | None, media: str, query: str, sort: str,
         include_spoilers: bool, user_id: str | None, offset: int, room: str | None = None) -> CommunityFeed:
    # Spoiler filtering precedes search, metadata, counts, and pagination.
    with storage() as cur:
        ordering = 'likes DESC, p.created_at DESC, p.id' if sort == 'popular' else 'p.created_at DESC, p.id'
        # Escape SQL LIKE wildcards so user queries are literal substring searches.
        search = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        cur.execute(post_select() + """ WHERE (%s::text IS NULL OR p.category=%s) AND (NOT p.contains_spoilers OR %s)
                    AND (%s='' OR p.media=%s) AND (p.title ILIKE %s OR p.body ILIKE %s)
                    AND (%s::text IS NULL OR p.room=%s)
                    ORDER BY """ + ordering + ' LIMIT 21 OFFSET %s',
                    (user_id, include_spoilers, user_id, category, category, include_spoilers, media, media, search, search, room, room, offset))
        rows = cur.fetchall()
        cur.execute('SELECT DISTINCT media FROM public.community_posts WHERE NOT contains_spoilers OR %s ORDER BY media',
                    (include_spoilers,))
        media_names = [row['media'] for row in cur.fetchall()]
        return CommunityFeed(posts=[CommunityPost.model_validate(row) for row in rows[:20]],
                             media=media_names, active_fans=active_count(cur), has_more=len(rows) > 20)


def create_post(user_id: str, request: PostCreate) -> CommunityPost:
    post_id = uuid4()
    with storage() as cur:
        cur.execute("""INSERT INTO public.community_posts(id,user_id,author,category,media,title,body,contains_spoilers,rating,room,side_a,side_b,target_episode)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (post_id,user_id,author_name(user_id),request.category,request.media,request.title,
                     request.body,request.contains_spoilers,request.rating if request.category == 'review' else None,
                     request.room,request.side_a,request.side_b,request.target_episode))
        return find_post(cur,post_id,user_id,True)


def read_post(post_id: UUID, user_id: str | None, include_spoilers: bool) -> CommunityPost:
    with storage() as cur:
        return find_post(cur, post_id, user_id, include_spoilers)


def set_like(post_id: UUID, user_id: str, liked: bool, include_spoilers: bool) -> CommunityPost:
    with storage() as cur:
        # Serialize changes for this post so retries/concurrent requests have accurate counts.
        cur.execute('SELECT id FROM public.community_posts WHERE id=%s FOR UPDATE', (post_id,))
        find_post(cur,post_id,user_id,include_spoilers)
        if liked:
            cur.execute('INSERT INTO public.community_likes(post_id,user_id) VALUES (%s,%s) ON CONFLICT DO NOTHING', (post_id,user_id))
        else:
            cur.execute('DELETE FROM public.community_likes WHERE post_id=%s AND user_id=%s', (post_id,user_id))
        return find_post(cur,post_id,user_id,include_spoilers)


def comments(post_id: UUID, user_id: str | None, include_spoilers: bool) -> list[CommunityComment]:
    with storage() as cur:
        find_post(cur,post_id,user_id,include_spoilers)
        cur.execute("""SELECT id,author,body,contains_spoilers,created_at,COALESCE(user_id=%s,false) AS is_owner FROM public.community_comments
                       WHERE post_id=%s AND (NOT contains_spoilers OR %s) ORDER BY created_at DESC,id DESC LIMIT 100""",
                    (user_id,post_id,include_spoilers))
        return [CommunityComment.model_validate(row) for row in reversed(cur.fetchall())]


def create_comment(post_id: UUID, user_id: str, request: CommentCreate, include_spoilers: bool) -> CommunityComment:
    with storage() as cur:
        parent = find_post(cur,post_id,user_id,include_spoilers)
        cur.execute("""INSERT INTO public.community_comments(id,post_id,user_id,author,body,contains_spoilers)
                    VALUES (%s,%s,%s,%s,%s,%s) RETURNING id,author,body,contains_spoilers,created_at""",
                    (uuid4(),post_id,user_id,author_name(user_id),request.body,
                     request.contains_spoilers or parent.contains_spoilers))
        return CommunityComment.model_validate({**cur.fetchone(), "is_owner": True})


def heartbeat(request: PresenceRequest, user_id: str | None) -> PresenceResponse:
    with storage() as cur:
        cur.execute("""INSERT INTO public.community_presence(visitor_id,user_id,page) VALUES (%s,%s,%s)
                       ON CONFLICT (visitor_id) DO UPDATE SET user_id=EXCLUDED.user_id,
                       page=EXCLUDED.page,last_seen=now()""", (request.visitor_id,user_id,request.page))
        cur.execute("DELETE FROM public.community_presence WHERE last_seen < now() - interval '1 day'")
        return PresenceResponse(active_fans=active_count(cur))


def library(user_id: str) -> list[LibraryItem]:
    with storage() as cur:
        cur.execute("""SELECT up.media_id,
              COALESCE(g.media->>'title', (SELECT fm.media->>'title' FROM public.franchise_media fm
                        WHERE fm.media_id=up.media_id LIMIT 1),
                        CASE WHEN up.media_id='lantern-harbor' THEN 'Lantern Harbor' ELSE up.media_id END) AS title,
              COALESCE(up.completed,false) AS completed
              FROM public.user_progress up LEFT JOIN public.generated_graphs g ON g.media_id=up.media_id
              WHERE up.user_id=%s ORDER BY up.updated_at DESC LIMIT 100""", (user_id,))
        return [LibraryItem.model_validate(row) for row in cur.fetchall()]


ENTRY_COLUMNS = "id,author,kind,body,side,source,artwork,connects_to,contains_spoilers,created_at,locked,revealed,tried,COALESCE(user_id=%s,false) AS is_owner"


def own_record(cur: Cursor[dict[str, Any]], table: str, record_id: UUID, user_id: str) -> dict[str, Any]:
    # Only internal table names enter this query; ownership is always verified sub.
    cur.execute(f'SELECT * FROM public.{table} WHERE id=%s FOR UPDATE', (record_id,))
    row = cur.fetchone()
    if not row or row['user_id'] != user_id:
        raise HTTPException(404, 'Your content was not found')
    return row


def update_post(post_id: UUID, user_id: str, request: PostCreate) -> CommunityPost:
    with storage() as cur:
        old = own_record(cur, 'community_posts', post_id, user_id)
        if old['room'] != request.room:
            cur.execute('SELECT 1 FROM public.community_entries WHERE post_id=%s LIMIT 1', (post_id,))
            if cur.fetchone():
                raise HTTPException(409, 'Keep the room after fans have participated')
        if old['target_episode'] != request.target_episode:
            cur.execute("SELECT 1 FROM public.community_entries WHERE post_id=%s AND locked LIMIT 1", (post_id,))
            if cur.fetchone():
                raise HTTPException(409, 'Keep the target episode after a prediction is locked')
        cur.execute('UPDATE public.community_posts SET category=%s,media=%s,title=%s,body=%s,contains_spoilers=%s,rating=%s,room=%s,side_a=%s,side_b=%s,target_episode=%s WHERE id=%s',
                    (request.category,request.media,request.title,request.body,request.contains_spoilers,request.rating,request.room,request.side_a,request.side_b,request.target_episode,post_id))
        return find_post(cur, post_id, user_id, True)


def delete_content(table: str, record_id: UUID, user_id: str) -> dict[str, bool]:
    with storage() as cur:
        row = own_record(cur, table, record_id, user_id)
        if table == 'community_entries' and row['locked']:
            raise HTTPException(409, 'Locked predictions cannot be changed or deleted')
        cur.execute(f'DELETE FROM public.{table} WHERE id=%s', (record_id,))
    return {'deleted': True}


def update_comment(comment_id: UUID, user_id: str, request: CommentCreate) -> CommunityComment:
    with storage() as cur:
        row = own_record(cur, 'community_comments', comment_id, user_id)
        parent = find_post(cur, row['post_id'], user_id, True)
        cur.execute('UPDATE public.community_comments SET body=%s,contains_spoilers=%s WHERE id=%s RETURNING id,author,body,contains_spoilers,created_at',
                    (request.body,request.contains_spoilers or parent.contains_spoilers,comment_id))
        return CommunityComment.model_validate({**cur.fetchone(), 'is_owner': True})


def entries(post_id: UUID, user_id: str | None, show: bool) -> list[ForumEntry]:
    with storage() as cur:
        find_post(cur, post_id, user_id, show)
        cur.execute(f'SELECT {ENTRY_COLUMNS} FROM public.community_entries WHERE post_id=%s AND (NOT contains_spoilers OR %s) AND (kind<>\'prediction\' OR revealed OR user_id=%s) ORDER BY created_at,id LIMIT 200',
                    (user_id,post_id,show,user_id))
        rows = cur.fetchall()
        visible = {row['id'] for row in rows}
        return [ForumEntry.model_validate({**row, 'connects_to': row['connects_to'] if row['connects_to'] in visible else None}) for row in rows]


def save_entry(post_id: UUID, user_id: str, request: EntryCreate, show: bool, entry_id: UUID | None = None) -> ForumEntry:
    with storage() as cur:
        cur.execute('SELECT id FROM public.community_posts WHERE id=%s FOR UPDATE', (post_id,))
        parent = find_post(cur, post_id, user_id, show)
        allowed = {'courtroom': {'join','vote','contribution'}, 'fanfiction': {'contribution'},
                   'drawing': {'join','art'}, 'battle': {'join','contribution'}, 'capsule': {'prediction'},
                   'ending': {'contribution','vote'}, 'mystery': {'clue'}, 'pitch': {'contribution'},
                   'verdict': {'impression'}, 'hot-take': {'join','vote','contribution'},
                   'matchmaking': {'recommendation'}}
        if request.kind not in allowed.get(parent.room, {'contribution'}):
            raise HTTPException(422, 'This contribution does not belong in this room')
        if request.kind == 'vote' and request.side not in ({'believable','devastating'} if parent.room == 'ending' else {'a','b'}):
            raise HTTPException(422, 'Choose one of the verdict options')
        if parent.room == 'pitch' and len([part for part in re.split(r'[.!?]+', request.body) if part.strip()]) > 3:
            raise HTTPException(422, 'A pitch can contain at most three sentences')
        if parent.room == 'ending' and request.kind == 'vote':
            try:
                outcome_id = UUID(request.source)
            except ValueError:
                raise HTTPException(422, 'Choose an alternate ending to vote on') from None
            cur.execute("SELECT id FROM public.community_entries WHERE id=%s AND post_id=%s AND kind='contribution' AND (NOT contains_spoilers OR %s)", (outcome_id,post_id,show))
            if not cur.fetchone():
                raise HTTPException(422, 'Choose a visible ending in this thread')
        if request.connects_to:
            cur.execute('SELECT id FROM public.community_entries WHERE id=%s AND post_id=%s AND kind=\'clue\' AND (NOT contains_spoilers OR %s)', (request.connects_to,post_id,show))
            if not cur.fetchone() or request.connects_to == entry_id:
                raise HTTPException(422, 'Choose a visible clue in this board')
        if not entry_id and request.kind in ('join','vote','prediction'):
            cur.execute('SELECT id FROM public.community_entries WHERE post_id=%s AND user_id=%s AND kind=%s', (post_id,user_id,request.kind))
            old = cur.fetchone()
            entry_id = old['id'] if old else None
        if entry_id:
            old = own_record(cur, 'community_entries', entry_id, user_id)
            if old['post_id'] != post_id or old['kind'] != request.kind:
                raise HTTPException(422, 'Keep the original contribution type')
            if old['locked']:
                raise HTTPException(409, 'Locked predictions cannot be edited')
            cur.execute('UPDATE public.community_entries SET body=%s,side=%s,source=%s,artwork=%s,connects_to=%s,contains_spoilers=%s WHERE id=%s',
                        (request.body,request.side,request.source,request.artwork,request.connects_to,request.contains_spoilers or parent.contains_spoilers,entry_id))
        else:
            entry_id = uuid4()
            cur.execute('INSERT INTO public.community_entries(id,post_id,user_id,author,kind,body,side,source,artwork,connects_to,contains_spoilers) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                        (entry_id,post_id,user_id,author_name(user_id),request.kind,request.body,request.side,request.source,request.artwork,request.connects_to,request.contains_spoilers or parent.contains_spoilers))
        cur.execute(f'SELECT {ENTRY_COLUMNS} FROM public.community_entries WHERE id=%s', (user_id,entry_id))
        return ForumEntry.model_validate(cur.fetchone())


def entry_action(entry_id: UUID, user_id: str, request: EntryAction, show: bool = False) -> ForumEntry:
    with storage() as cur:
        cur.execute('SELECT post_id FROM public.community_entries WHERE id=%s', (entry_id,))
        location = cur.fetchone()
        if not location:
            raise HTTPException(404, 'Contribution not found')
        cur.execute('SELECT user_id FROM public.community_posts WHERE id=%s FOR UPDATE', (location['post_id'],))
        parent = cur.fetchone()
        find_post(cur, location['post_id'], user_id, show)
        cur.execute('SELECT * FROM public.community_entries WHERE id=%s FOR UPDATE', (entry_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, 'Contribution not found')
        if row['contains_spoilers'] and not show:
            raise HTTPException(404, 'Spoiler content is hidden')
        if request.action == 'tried':
            if parent['user_id'] != user_id or row['kind'] != 'recommendation':
                raise HTTPException(403, 'Only the requester can mark a recommendation tried')
            cur.execute('UPDATE public.community_entries SET tried=NOT tried WHERE id=%s', (entry_id,))
        else:
            if row['user_id'] != user_id or row['kind'] != 'prediction':
                raise HTTPException(403, 'Only your prediction can be locked or revealed')
            if request.action == 'reveal' and not row['locked']:
                raise HTTPException(409, 'Lock your prediction before revealing it')
            column = 'locked' if request.action == 'lock' else 'revealed'
            cur.execute(f'UPDATE public.community_entries SET {column}=true WHERE id=%s', (entry_id,))
        cur.execute(f'SELECT {ENTRY_COLUMNS} FROM public.community_entries WHERE id=%s', (user_id,entry_id))
        return ForumEntry.model_validate(cur.fetchone())
