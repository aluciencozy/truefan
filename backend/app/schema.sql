-- Application-owned data only. Neon manages credentials/sessions in neon_auth.
-- Progress remains keyed by individual work, independent of franchise merges.
CREATE TABLE IF NOT EXISTS public.user_progress (
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    completed_unit INTEGER NOT NULL CHECK (completed_unit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);

-- Shared experimental graph cache; user_progress ownership is unchanged.
CREATE TABLE IF NOT EXISTS public.generated_graphs (
    media_id TEXT PRIMARY KEY,
    media JSONB NOT NULL,
    document JSONB NOT NULL DEFAULT '{"episodes":[]}',
    working_document JSONB NOT NULL DEFAULT '{"episodes":[]}',
    status TEXT NOT NULL DEFAULT 'queued',
    model TEXT NOT NULL,
    episode_cap INTEGER NOT NULL,
    requested_by TEXT NOT NULL,
    regenerating BOOLEAN NOT NULL DEFAULT FALSE,
    lease_token TEXT,
    lease_until TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.graph_generation_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graph_generation_requests_daily ON public.graph_generation_requests(requested_at);

-- NULL completion identifies legacy rows; explicit false must beat inference.
ALTER TABLE public.user_progress ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT NULL;
ALTER TABLE public.user_progress ADD COLUMN IF NOT EXISTS manual_unlocked BOOLEAN NOT NULL DEFAULT false;

-- Provisional on-demand groupings, not canonical AniList franchises/continuities.
CREATE TABLE IF NOT EXISTS public.franchises (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    discovery_status TEXT NOT NULL CHECK (discovery_status IN ('partial', 'bounded', 'failed')),
    refreshed_at TIMESTAMPTZ,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    limitations JSONB NOT NULL DEFAULT '[]',
    discovery JSONB NOT NULL DEFAULT '{}',
    merged_into TEXT REFERENCES public.franchises(id)
);
CREATE TABLE IF NOT EXISTS public.franchise_media (
    franchise_id TEXT NOT NULL REFERENCES public.franchises(id),
    media_id TEXT NOT NULL,
    anilist_id INTEGER NOT NULL,
    media JSONB NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (franchise_id, media_id)
);
CREATE INDEX IF NOT EXISTS franchise_media_entry ON public.franchise_media(media_id);
CREATE TABLE IF NOT EXISTS public.media_relations (
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source, target, type)
);
