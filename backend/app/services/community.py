from contextlib import contextmanager
from collections.abc import Iterator
from typing import Any
import hashlib
from uuid import UUID, uuid4

import psycopg
from psycopg import Cursor
from psycopg.rows import dict_row
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
                     p.rating, p.example, p.created_at,
               (SELECT count(*) FROM public.community_likes l WHERE l.post_id=p.id) AS likes,
               (SELECT count(*) FROM public.community_comments c WHERE c.post_id=p.id
                    AND (NOT c.contains_spoilers OR %s)) AS comments,
               EXISTS(SELECT 1 FROM public.community_likes l WHERE l.post_id=p.id AND l.user_id=%s) AS liked
               FROM public.community_posts p"""


def find_post(cur: Cursor[dict[str, Any]], post_id: UUID, user_id: str | None, include_spoilers: bool) -> CommunityPost:
    cur.execute(post_select() + ' WHERE p.id=%s AND (NOT p.contains_spoilers OR %s)',
                (include_spoilers, user_id, post_id, include_spoilers))
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, 'Post not found or spoiler content is hidden')
    return CommunityPost.model_validate(row)


def feed(category: Category, media: str, query: str, sort: str,
         include_spoilers: bool, user_id: str | None, offset: int) -> CommunityFeed:
    # Spoiler filtering precedes search, metadata, counts, and pagination.
    with storage() as cur:
        ordering = 'likes DESC, p.created_at DESC, p.id' if sort == 'popular' else 'p.created_at DESC, p.id'
        # Escape SQL LIKE wildcards so user queries are literal substring searches.
        search = '%' + query.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        cur.execute(post_select() + """ WHERE p.category=%s AND (NOT p.contains_spoilers OR %s)
                    AND (%s='' OR p.media=%s) AND (p.title ILIKE %s OR p.body ILIKE %s)
                    ORDER BY """ + ordering + ' LIMIT 21 OFFSET %s',
                    (include_spoilers, user_id, category, include_spoilers, media, media, search, search, offset))
        rows = cur.fetchall()
        cur.execute('SELECT DISTINCT media FROM public.community_posts WHERE NOT contains_spoilers OR %s ORDER BY media',
                    (include_spoilers,))
        media_names = [row['media'] for row in cur.fetchall()]
        return CommunityFeed(posts=[CommunityPost.model_validate(row) for row in rows[:20]],
                             media=media_names, active_fans=active_count(cur), has_more=len(rows) > 20)


def create_post(user_id: str, request: PostCreate) -> CommunityPost:
    post_id = uuid4()
    with storage() as cur:
        cur.execute("""INSERT INTO public.community_posts(id,user_id,author,category,media,title,body,contains_spoilers,rating)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (post_id,user_id,author_name(user_id),request.category,request.media,request.title,
                     request.body,request.contains_spoilers,request.rating if request.category == 'review' else None))
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
        cur.execute("""SELECT id,author,body,contains_spoilers,created_at FROM public.community_comments
                       WHERE post_id=%s AND (NOT contains_spoilers OR %s) ORDER BY created_at DESC,id DESC LIMIT 100""",
                    (post_id,include_spoilers))
        return [CommunityComment.model_validate(row) for row in reversed(cur.fetchall())]


def create_comment(post_id: UUID, user_id: str, request: CommentCreate, include_spoilers: bool) -> CommunityComment:
    with storage() as cur:
        parent = find_post(cur,post_id,user_id,include_spoilers)
        cur.execute("""INSERT INTO public.community_comments(id,post_id,user_id,author,body,contains_spoilers)
                    VALUES (%s,%s,%s,%s,%s,%s) RETURNING id,author,body,contains_spoilers,created_at""",
                    (uuid4(),post_id,user_id,author_name(user_id),request.body,
                     request.contains_spoilers or parent.contains_spoilers))
        return CommunityComment.model_validate(cur.fetchone())


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
