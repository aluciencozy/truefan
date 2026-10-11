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

-- Additive forum migration. Existing conversations retain their original content.
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS room TEXT;
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS side_a TEXT NOT NULL DEFAULT 'Prosecution';
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS side_b TEXT NOT NULL DEFAULT 'Defense';
ALTER TABLE public.community_posts ADD COLUMN IF NOT EXISTS target_episode INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS public.community_entries (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES public.community_posts(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    author TEXT NOT NULL,
    kind TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    side TEXT NOT NULL DEFAULT 'neutral',
    source TEXT NOT NULL DEFAULT '',
    artwork TEXT NOT NULL DEFAULT '',
    connects_to UUID REFERENCES public.community_entries(id) ON DELETE SET NULL,
    contains_spoilers BOOLEAN NOT NULL DEFAULT false,
    locked BOOLEAN NOT NULL DEFAULT false,
    revealed BOOLEAN NOT NULL DEFAULT false,
    tried BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS community_single_participation ON public.community_entries(post_id,user_id,kind)
    WHERE kind IN ('join','vote','prediction');
CREATE INDEX IF NOT EXISTS community_entries_post ON public.community_entries(post_id,created_at);

-- Reply parents are validated against the same post by the service.
ALTER TABLE public.community_comments ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.community_comments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS community_comments_parent ON public.community_comments(parent_id);
ALTER TABLE public.community_entries ADD COLUMN IF NOT EXISTS board_x DOUBLE PRECISION;
ALTER TABLE public.community_entries ADD COLUMN IF NOT EXISTS board_y DOUBLE PRECISION;
ALTER TABLE public.community_entries ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'rectangle';
