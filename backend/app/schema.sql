-- Application-owned data only. Neon manages credentials/sessions in neon_auth.
-- Media IDs currently reference the curated catalog, not a database media table.
CREATE TABLE IF NOT EXISTS public.user_progress (
    user_id TEXT NOT NULL,
    media_id TEXT NOT NULL,
    completed_unit INTEGER NOT NULL CHECK (completed_unit >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, media_id)
);

-- Curated catalog used by the seed script and the extraction fallback.
-- unlock_episode is the story unit at which a row is revealed (API: revealed_at.unit).
CREATE TABLE IF NOT EXISTS public.media (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('anime', 'tv', 'manga', 'game', 'movie')),
    progress_unit TEXT NOT NULL CHECK (progress_unit IN ('episode', 'chapter', 'movie', 'milestone')),
    total_units INTEGER NOT NULL CHECK (total_units > 0),
    description TEXT NOT NULL,
    anilist_id INTEGER
);

CREATE TABLE IF NOT EXISTS public.entities (
    media_id TEXT NOT NULL REFERENCES public.media (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('character', 'faction', 'location', 'object')),
    description TEXT NOT NULL,
    unlock_episode INTEGER NOT NULL CHECK (unlock_episode >= 0),
    source TEXT NOT NULL,
    source_unit INTEGER NOT NULL CHECK (source_unit >= 0),
    verified BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (media_id, id)
);

CREATE TABLE IF NOT EXISTS public.relationships (
    media_id TEXT NOT NULL REFERENCES public.media (id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    source TEXT NOT NULL,
    target TEXT NOT NULL,
    type TEXT NOT NULL,
    unlock_episode INTEGER NOT NULL CHECK (unlock_episode >= 0),
    provenance_source TEXT NOT NULL,
    source_unit INTEGER NOT NULL CHECK (source_unit >= 0),
    verified BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (media_id, id),
    FOREIGN KEY (media_id, source) REFERENCES public.entities (media_id, id) ON DELETE CASCADE,
    FOREIGN KEY (media_id, target) REFERENCES public.entities (media_id, id) ON DELETE CASCADE
);
