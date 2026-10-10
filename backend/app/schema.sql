-- Application-owned data only. Neon manages credentials/sessions in neon_auth.
-- Media IDs currently reference the curated catalog, not a database media table.
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
