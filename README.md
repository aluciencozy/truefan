# Spoiler-Aware Media Knowledge Graph

A hackathon starter for exploring a story without learning what happens next.
Choose media, enter how far you have finished, and explore the characters,
factions, locations, objects, and relationships revealed up to that point.

Normal wikis, Google searches, and AI assistants can reveal future information
in a title, biography, relationship label, or answer. This project's solution is
a temporal knowledge graph: every fact has a reveal point, and the backend
returns only facts at or before the user's exact progress.

## What works now

- Vite + React + TypeScript dashboard with Tailwind and React Flow.
- Backend media search, selected media, progress selector, graph, and entity details.
- FastAPI health check and hard-coded, backend-filtered graph responses.
- Optional Neon Auth sign-up, sign-in, sign-out, session display, and an API identity check.
- Lazy Neon Postgres connection helper; no database or external credentials needed to boot.
- Typed extraction/Q&A contracts and integration placeholders; neither calls an AI model.

The fixture is **Lantern Harbor**, a fictional three-episode story. Episode 1
reveals three nodes, episode 2 reveals a faction, and episode 3 reveals an object.
Moving backwards removes later information immediately, including selected details.
Progress 0 gives an empty graph. No real-series spoilers are included in the fixture.

This is boilerplate, not a finished product. Search currently returns only this
fixture. Accounts use real Neon Auth when configured, but saved progress,
database tables, production deployments, and a real demo series are not implemented.

## Example experience

1. Search for Lantern Harbor and select it.
2. Select the last episode you **finished**, initially episode 1.
3. Pan/zoom the graph and select Mira to read an introductory description.
4. Finish episode 2 and advance the selector: new connections become visible.
5. Rewind to episode 1: the new faction and its relationships disappear.
6. With Neon Auth configured, open Account, create an account or sign in, then
   use “Verify API session” to exercise the protected FastAPI endpoint.

Eventually, signed-in users will resume stored progress across devices and media.
Spoiler-safe profiles and Q&A will share the same progress boundary.

## Architecture and stack

```text
Vite + React browser app (Vercel)
  ├─ Neon Auth: managed users, credentials, sessions
  └─ HTTP / JSON → FastAPI (Railway)
                    ├─ reveal-point filtering
                    ├─ JWT verification for user-owned APIs
                    ├─ Neon Postgres (planned app persistence)
                    ├─ AniList GraphQL (planned metadata)
                    └─ Hugging Face Inference Providers (planned extraction)
```

The frontend is a separate SPA; there are no Next.js, SSR, or frontend API routes.
React Flow uses `@xyflow/react`. Tailwind uses its Vite plugin. FastAPI uses
Pydantic for contracts, pydantic-settings for configuration, psycopg for Postgres,
and PyJWT with cryptography for signed identity verification.

## Repository structure

```text
/
├── frontend/
│   ├── src/
│   │   ├── components/       # MediaControls, GraphCanvas, EntityDetails, AuthPanel
│   │   ├── lib/              # API client, shared API types, Neon Auth client
│   │   ├── App.tsx           # Dashboard state and requests
│   │   ├── main.tsx
│   │   └── index.css
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/
│   ├── app/
│   │   ├── main.py           # Endpoints and CORS
│   │   ├── schemas.py        # Pydantic API models
│   │   ├── config.py         # Server configuration
│   │   ├── auth.py           # Verified Neon identity dependency
│   │   ├── database.py       # Lazy Postgres connection
│   │   └── services/         # Demo data, filtering, AniList/HF placeholders
│   ├── tests/test_graph.py   # Small spoiler-boundary regression checks
│   ├── .env.example
│   ├── Procfile              # Railway start command
│   └── requirements.txt
├── neon.ts                   # Managed Neon Auth policy
├── package.json              # Optional Neon CLI and frontend convenience scripts
├── README.md
├── AGENTS.md
├── .gitignore
└── .env.example              # Combined environment reference
```

## Local development

Use Node.js 22.12+ (or a current LTS), npm, and Python 3.11+.
Run two terminals from the repository root.

Frontend:

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

Open **http://localhost:3000**. The port is fixed so it matches backend CORS.

Backend (with `uv`):

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) if needed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

```bash
cd backend
cp -n .env.example .env
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
uvicorn app.main:app --reload
```

Skip copying `.env` if it is already configured. `uv` uses the existing
`requirements.txt`; no `pyproject.toml` or `uv.lock` is required.

Backend (alternative with standard Python/pip):

```bash
cd backend
cp .env.example .env
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

On Windows activate with `.venv\Scripts\activate`. Open **http://localhost:8000/docs**
for interactive API docs. Blank database/HF/Auth variables are fine for the guest demo.
Backend settings load `backend/.env`; Vite loads `frontend/.env`. Root `.env.example`
is a reference, not an automatically shared runtime configuration file.

Checks:

```bash
# In frontend/
npm run typecheck
npm run build
npm run preview

# In backend/, with .venv activated
python -m unittest discover -s tests
curl http://localhost:8000/health
curl 'http://localhost:8000/api/media/lantern-harbor/graph?progress=1'
curl 'http://localhost:8000/api/media/lantern-harbor/graph?progress=3'
```

The two graph calls should return 3 and 5 entities respectively. In the browser,
“Backend connected” proves the `/health` call succeeded. The visible graph comes
from FastAPI, not a separate frontend fixture. Change episodes and click a node
to verify the graph and details update. Stop FastAPI and reload to check the error UI.

## Environment variables

| Variable | Location | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend | Neon Postgres connection string, with TLS parameters from Console |
| `HF_TOKEN` | Backend | Secret Inference API/Providers token; unused by the starter |
| `ANILIST_API_URL` | Backend | Defaults to `https://graphql.anilist.co` |
| `FRONTEND_URL` | Backend | Exact allowed browser origin; defaults to `http://localhost:3000` |
| `VITE_API_URL` | Frontend | Public FastAPI origin; defaults to `http://localhost:8000` |
| `VITE_NEON_AUTH_URL` | Frontend | Public branch-specific Neon Auth endpoint; blank disables account UI |
| `NEON_AUTH_JWKS_URL` | Backend | Trusted HTTPS public signing-key endpoint for the same branch |
| `NEON_AUTH_ISSUER` | Backend | Exact expected JWT `iss` from that branch |
| `NEON_AUTH_AUDIENCE` | Backend | Expected `aud` when the configured issuer uses an audience |
| `NEON_API_KEY` | CLI only, optional | Secret project-scoped automation credential; otherwise use CLI login |

Never put a secret in a `VITE_*` variable: those values are embedded in browser
assets. Never commit `.env`, local `.neon` context, connection strings, session
cookies, passwords, JWTs, or provider/API keys. Restart Vite after environment
changes; production public variables are applied at build time.

## Neon project and basic authentication

The intended project is `orange-bar-85033580`, branch `production`.
`neon.ts` declares `auth: true`; it is a desired policy, not evidence the remote
project has been linked or deployed. Install the local CLI from the root:

```bash
npm install
npm run neon -- login
npm run neon -- link --project-id orange-bar-85033580 --branch production -y
npm run neon -- deploy
# Pull the database URL into the backend file, preserving other settings:
npm run neon -- env pull --file backend/.env --service postgres
```

This uses a project-local CLI rather than requiring a global installation.
The provided `neon.ts` replaces the need to run `neon config init` again.
Optional `neon skills -y` / `neon mcp -y` configure coding-agent integrations;
they are not needed to run the apps and may modify agent configuration files.

After enabling Auth, copy the branch's public Auth URL into `VITE_NEON_AUTH_URL`.
Configure trusted frontend domains in Neon Auth for localhost and your deployed
Vercel origin. Enable/configure email and password sign-in in Neon Console.
Copy the correct issuer and JWKS URL into backend settings. Consult the branch's
Auth configuration/token contract; do not guess these values from the project ID.
Neon's JWT plugin publishes JWKS at the Auth base URL's `/.well-known/jwks.json`.

The browser SDK handles credentials and session cookies. This repo does not store
passwords or create an additional session system. The account panel subscribes
to the SDK session hook. Private API requests call `authClient.token()` and send
`Authorization: Bearer <token>`; FastAPI verifies the signature, expiry, issuer,
subject, and audience when configured. It returns the verified subject at `/api/me`.
No raw tokens are written to localStorage by application code.

The demo endpoints remain public. Missing/invalid credentials on `/api/me` return
401; missing verifier configuration or an unavailable identity provider returns
503. Logging out clears the SDK session; an already issued JWT may remain valid
until expiry. Add revocation checks if later private operations require immediate
server-side logout enforcement. Password reset, OAuth, and account management are
future work; email-verification behavior depends on Neon Auth settings.

## Frontend/backend communication and contracts

`frontend/src/lib/api.ts` calls FastAPI directly using `VITE_API_URL`. There is
no Vite proxy hiding CORS problems. FastAPI allows the configured frontend origin
and the Content-Type/Authorization headers. It never connects to Postgres on startup.
Pydantic models appear at `/docs` and `/openapi.json`; frontend interfaces mirror
these contracts in `src/lib/types.ts`.

| Endpoint | Contract / starter behavior |
| --- | --- |
| `GET /health` | `{ "status": "ok", "mode": "demo" }`; does not imply DB/provider readiness |
| `GET /api/media/search?q=...` | Case-insensitive title search; returns `Media[]` for the fixture |
| `GET /api/media/{id}` | One `Media`; unknown IDs return 404 |
| `GET /api/media/{id}/graph?progress=N` | Required non-negative completed unit; returns filtered `GraphResponse`; out-of-range returns 422 |
| `POST /api/extract` | `ExtractRequest`; returns 501 with a typed `not_implemented` message |
| `POST /api/ask` | `AskRequest`; returns 501 without generating an answer |
| `GET /api/me` | Bearer token required; returns `{ "id": "verified-user-subject" }` |

Example graph shape (additional provenance fields omitted here for readability):

```json
{
  "media_id": "lantern-harbor",
  "progress": { "unit": 1 },
  "entities": [
    { "id": "mira", "name": "Mira", "type": "character", "revealed_at": { "unit": 1 } }
  ],
  "relationships": []
}
```

Extraction request:

```json
{
  "media_id": "lantern-harbor",
  "summary": "A manually curated episode summary.",
  "source": "manual:episode-1",
  "reveal_point": { "unit": 1 }
}
```

Q&A request:

```json
{
  "media_id": "lantern-harbor",
  "progress": { "unit": 1 },
  "question": "Who is Mira?"
}
```

## Reveal-point rule and planned database model

All comparisons live in `backend/app/services/graph.py`:

```text
entity.revealed_at.unit <= user.progress.unit
relationship.revealed_at.unit <= user.progress.unit
AND both relationship endpoints are visible
```

Use a canonical integer story-unit ordering per media. Episodes, chapters,
franchise movies, and curated game milestones use the same contract; the media
specifies the unit label. Progress 0 means nothing completed. Seasons/episode
numbers will map into this order through a story-unit table. Branched game
stories will need an explicit path-aware extension instead of guessing a sequence.

Planned tables (not migrated yet):

| Concept | Planned fields / ownership |
| --- | --- |
| Media | ID, title, media type, unit label, metadata provider IDs |
| StoryUnit / RevealPoint | Media ID, ordered index, season/episode/chapter labels, source references |
| Entity | ID scoped to media, type, introductory name/description, first reveal unit |
| Relationship | ID, media ID, source/target entity IDs, relation type, first reveal unit |
| Source / extracted fact | Source URL or manual document ID, story unit, extraction model/run, review state |
| AppUser / profile | Neon Auth subject ID plus app preferences; no passwords or duplicated sessions |
| UserProgress | Verified user ID, media ID, completed unit, updated timestamp; unique user/media pair |
| neon_auth user/session/account | Managed by Neon Auth; use its actual provisioned schema instead of recreating it |

User-owned progress APIs must derive ownership from verified identity and apply
that owner in every query. The current progress selector is transient guest state
and is not saved. Plan foreign keys for media/endpoints, uniqueness constraints,
and indexes by media/reveal unit. Keep source and review metadata with each fact.

**Important future limit:** a single reveal point on an entity only protects its
introductory description. Later aliases, identities, affiliations, biographies,
and changed relationships must be stored as separately revealable facts or
versions. Do not replace an early description with a full-story biography.

## Planned AniList integration

Call AniList GraphQL from `backend/app/services/anilist.py` to search titles,
normalize anime/manga metadata, and retain AniList IDs separately from internal
media IDs. Add timeouts, rate-limit handling, and modest caching when implemented.
AniList is metadata, not a trustworthy episode-by-episode reveal dataset. Character
biographies and cast lists can themselves contain spoilers, so never send them
straight to a progress-filtered profile. Other media providers can be added later.

## Planned Hugging Face ingestion pipeline

```text
AniList
    ↓
media metadata + characters
    ↓
episode/wiki/manual summaries
    ↓
Hugging Face open-source model / Inference Providers
    ↓
structured entities + relationships + reveal points + provenance
    ↓
manual verification if necessary
    ↓
Neon Postgres
    ↓
spoiler-aware graph API
```

`services/huggingface.py` is deliberately a placeholder. Choose a supported model
and provider, use server-only `HF_TOKEN`, submit summaries with explicit story-unit
and source context, and validate output against Pydantic before storing anything.
Record source references, unit, model/provider, extraction run, and review status.
Model-inferred relationships or reveal points must not automatically become
verified facts. Begin with manually curated summaries and human-reviewed output.
Wikipedia/MediaWiki sources can be considered later; no scraping is implemented.

## Deployment targets

- **Vercel:** root directory `frontend`, Vite preset, `npm run build`, output `dist`.
  Set `VITE_API_URL` to Railway's HTTPS origin and `VITE_NEON_AUTH_URL` to the same
  Neon branch used by the backend. Rebuild after changing public variables.
- **Railway:** root directory `backend`, install `requirements.txt`, start
  `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (also in Procfile).
  Set `FRONTEND_URL` to the Vercel origin and configure server-only variables.
- **Neon:** Postgres plus managed Auth on the linked branch. Copy its TLS connection
  URL to Railway `DATABASE_URL`; add the Vercel domain to Neon Auth trusted origins.

No deployment has been performed by this scaffold. No Docker, CI/CD, or auth
middleware framework is required. Future client routes may need a Vercel SPA
rewrite; the current single-page dashboard does not.

## Hackathon scope and next steps

The architecture stays generic, while one polished, verified real series is enough
for the MVP. Aim for media selection, progress selection, a useful interactive
graph, correct backend filtering, basic accounts, and a deployed demo. Keep AI
extraction as a small proof of concept; do not let scraping consume the hackathon.

Recommended next five implementation tasks:

1. Install dependencies, link/deploy Neon Auth, and verify sign-up/session/JWT flow end to end.
2. Choose one real demo series; curate story units and review entity/relationship reveal points.
3. Add Neon schema and user-owned progress save/resume endpoints behind verified auth.
4. Replace fixture search with AniList metadata while keeping graph facts curated.
5. Run one provenance-preserving Hugging Face extraction experiment, then deploy the demo to Vercel/Railway.

Future features include spoiler-safe versioned profiles, refusal-aware Q&A using
only allowed facts, multi-series support, chapter/movie/game progress, saved
libraries, better graph layout, and reveal animations.

## Known challenges

Reliable relationship and exact reveal-point data is the hardest part. Summaries
can omit facts or blend episodes; wikis often describe an entire story; AI can
hallucinate relationships. Entity resolution, aliases, retcons, alternate paths,
adaptation differences, and cross-franchise order also need explicit modeling.
Source permissions, metadata limits, inference latency/cost, and manual review
will constrain ingestion. Search snippets and even hidden future node counts
can spoil; return only the allowed facts, not the full graph for frontend filtering.

The starter's Auth SDK is a prerelease dependency. Pin a verified lockfile after
installation and check its API before changing versions. Neon authentication
needs branch-specific configuration and trusted domains to work in the browser.

## Reference documentation

- [Vite environment variables](https://vite.dev/guide/env-and-mode)
- [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Flow quick start](https://reactflow.dev/learn)
- [Neon Auth SDK](https://github.com/neondatabase/neon-js/tree/main/packages/auth)
- [Neon CLI workflow](https://neon.com/blog/just-landed-in-the-neon-cli)
- [Hugging Face Inference Client](https://huggingface.co/docs/huggingface_hub/main/package_reference/inference_client)
