-- Application-owned data only. Neon manages credentials/sessions in neon_auth.
-- Media IDs currently reference the curated catalog, not a database media table.
CREATE TABLE IF NOT EXISTS public.user_progress (
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    completed_unit INTEGER NOT NULL CHECK (completed_unit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);
