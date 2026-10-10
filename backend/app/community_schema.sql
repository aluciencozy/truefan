-- Community content is shared; author/like ownership comes from verified Neon sub.
CREATE TABLE IF NOT EXISTS public.community_posts (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    author TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('discussion', 'theory', 'review')),
    media TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    contains_spoilers BOOLEAN NOT NULL DEFAULT false,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    example BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_posts_feed ON public.community_posts(category, created_at DESC);
CREATE TABLE IF NOT EXISTS public.community_likes (
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    PRIMARY KEY (post_id, user_id)
);
CREATE TABLE IF NOT EXISTS public.community_comments (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    contains_spoilers BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_comments_post ON public.community_comments(post_id, created_at);
-- Anonymous visitors are browser IDs, never authentication identities.
CREATE TABLE IF NOT EXISTS public.community_presence (
    visitor_id UUID PRIMARY KEY,
    user_id TEXT,
    page TEXT NOT NULL CHECK (page IN ('discussion', 'theory', 'review')),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_presence_recent ON public.community_presence(last_seen);
