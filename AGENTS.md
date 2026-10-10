# Spoiler-Aware Media Knowledge Graph

Build a graph that reveals only what a user knows at their story progress.
Keep the media model generic across anime, TV, manga, games, and movies; one
curated series is enough for the demo. Prefer small, working hackathon changes.

## Structure and commands

- `frontend/`: Vite + React + TypeScript, Tailwind, React Flow, Neon Auth UI.
  Run `npm install`, `npm run dev`, `npm run build`, `npm run typecheck` here.
- `backend/app/`: FastAPI contracts, integrations, auth verification, graph rules.
  In `backend/`: `uv venv`, activate `.venv`, `uv pip install -r requirements.txt`,
  `python -m app.init_db` (once, with direct DB URL),
  `uvicorn app.main:app --reload`; check `python -m unittest discover -s tests`.
- Neon Postgres stores app data; Neon Auth manages users and sessions.
  Vercel hosts frontend; Railway hosts backend. `neon.ts` enables managed Auth.
- README has setup, environment variables, API contracts, and implemented schema.
- AniList discovery, episode providers, HF extraction, and shared graph jobs live in
  `backend/app/services/`. Apply additive tables with `python -m app.init_db`.
  Authenticated generation is bounded and cached; graph GETs never trigger inference.
- Standalone source/extraction probes live in `backend/scripts/`; reports and
  reviewed candidate artifacts live in `docs/`. Keep raw descriptions and model
  responses outside the repository. Candidate support episodes are not confirmed
  spoiler-safe reveal points; never load these artifacts into the public graph.

## Rules

- Use typed React props, strict TypeScript, Python type hints, and Pydantic at API
  boundaries. Keep frontend types aligned with `/openapi.json` and document changes.
- Centralize all reveal comparisons in `backend/app/services/graph.py`.
  Filter edges by reveal point AND both visible endpoints. Frontend renders only
  filtered responses and clears stale graphs/details when progress changes.
- Names, descriptions, labels, search results, and profiles can also spoil.
  New facts need reveal points; never send future facts to hide with frontend CSS.
- Use Neon Auth for credentials/sessions; never invent a parallel password store.
  Validate JWTs in FastAPI; derive record ownership from verified `sub`, never
  a client-supplied user ID. Demo graph is public; saved progress is user-owned.
  Use official Neon SDK/UI. Get bearer JWTs via `.token()`; opaque sessions are
  not JWTs. Verifier derives issuer/audience from Auth URL origin, JWKS from full
  base URL; accept EdDSA only. Never claim mock tests verify a live Neon login.
- `VITE_*` values are public. Keep DATABASE_URL, HF_TOKEN, and Neon API credentials
  server-only. Use local `.env` files and examples; never commit secrets or tokens.
- Preserve extraction provenance. Model-generated relationships/reveal points
  need source validation and provenance; do not assume AI output is correct.
  Runtime-generated graphs may be served automatically as experimental/unverified.
  Support episodes are approximate boundaries, never guaranteed spoiler-safe reveals.
- Avoid premature abstractions, new frameworks, and production-scale machinery.
  Update README when architecture, contracts, or important commands change.

## Current Hackathon Priorities

1. Working media selection flow
2. Working progress selection
3. Working graph visualization
4. Backend graph filtering by reveal point
5. One polished demo series
6. AniList metadata integration
7. Hugging Face extraction proof of concept
8. Deployment (including Neon Auth and user-owned progress)
9. Polish / animation / spoiler-safe Q&A if time remains
