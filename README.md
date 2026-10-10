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
- Neon Auth UI for sign-up, sign-in, sign-out, account settings, sessions, and a protected API identity check.
- Persistent per-user media progress through authenticated FastAPI endpoints.
- Lazy Neon Postgres connection helper; no database or external credentials needed to boot.
- Typed extraction/Q&A contracts and integration placeholders; neither calls an AI model.

The fixture is **Lantern Harbor**, a fictional three-episode story. Episode 1
reveals three nodes, episode 2 reveals a faction, and episode 3 reveals an object.
Moving backwards removes later information immediately, including selected details.
Progress 0 gives an empty graph. No real-series spoilers are included in the fixture.

This is boilerplate, not a finished product. Search currently returns only this
fixture. Accounts use real Neon Auth when configured, but production deployments and a real demo series are not implemented.
Saved progress needs the application table initialized as described below.

## Example experience

1. Search for Lantern Harbor and select it.
2. Select the last episode you **finished**, initially episode 1.
3. Pan/zoom the graph and select Mira to read an introductory description.
4. Finish episode 2 and advance the selector: new connections become visible.
5. Rewind to episode 1: the new faction and its relationships disappear.
6. With Neon Auth configured, open Account, create an account or sign in, then
   use “Verify API session” to exercise the protected FastAPI endpoint.

Signed-in users can save and retrieve progress across reloads and devices.
Spoiler-safe profiles and Q&A will share the same progress boundary.

## Architecture and stack

```text
Vite + React browser app (Vercel)
  ├─ Neon Auth: managed users, credentials, sessions
  └─ HTTP / JSON → FastAPI (Railway)
                    ├─ reveal-point filtering
                    ├─ JWT verification for user-owned APIs
                    ├─ Neon Postgres (per-user progress)
                    ├─ AniList GraphQL (planned metadata)
                    └─ Hugging Face Inference Providers (planned extraction)
```

The frontend is a separate SPA; there are no Next.js, SSR, or frontend API routes.
React Flow uses `@xyflow/react`. Tailwind uses its Vite plugin. React Router handles
`/auth/:path` and `/account/:path`; official Neon UI components handle credentials. FastAPI uses
Pydantic for contracts, pydantic-settings for configuration, psycopg for Postgres,
and PyJWT with cryptography for signed identity verification.

## Repository structure

```text
/
├── frontend/
│   ├── src/
│   │   ├── components/       # Media controls, graph, details, Neon Auth provider/pages
│   │   ├── lib/              # API client, shared API types, Neon Auth client
│   │   ├── App.tsx           # Dashboard state and requests
│   │   ├── main.tsx
│   │   └── index.css
│   ├── .env.example
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── vercel.json          # SPA route rewrites
├── backend/
│   ├── app/
│   │   ├── main.py           # Endpoints and CORS
│   │   ├── schemas.py        # Pydantic API models
│   │   ├── config.py         # Server configuration
│   │   ├── auth.py           # Verified Neon identity dependency
│   │   ├── database.py       # Lazy Postgres connection
│   │   ├── schema.sql        # Application user_progress table
│   │   ├── init_db.py        # Explicit table setup command
│   │   └── services/         # Progress storage, demo data, filtering, AniList/HF placeholders
│   ├── tests/               # Auth, ownership, and spoiler-boundary checks
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
| `NEON_AUTH_BASE_URL` | Backend | Full branch Auth URL, identical to `VITE_NEON_AUTH_URL`; required for protected APIs |
| `NEON_AUTH_JWKS_URL` | Backend, optional | Trusted Neon-supplied JWKS URL override; normally derived from the base URL |
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

The minimum account/progress configuration is:

```dotenv
# frontend/.env (public values)
VITE_API_URL=http://localhost:8000
VITE_NEON_AUTH_URL=<the full Auth URL from Neon Console → Auth>

# backend/.env (DATABASE_URL contains a secret)
DATABASE_URL=<connection string from Neon Console → Connect>
FRONTEND_URL=http://localhost:3000
NEON_AUTH_BASE_URL=<the same full Auth URL, including /neondb/auth>
```

Use the same Neon branch for Auth and Postgres. Never derive an Auth endpoint
from a database hostname or project ID. The supplied production Auth URL has been
written to local environment files; it is deliberately not a default in source code.
`NEON_AUTH_JWKS_URL` is optional; use only a trusted value supplied by Neon.
`NEON_AUTH_ISSUER` and `NEON_AUTH_AUDIENCE` are no longer used. No Next.js cookie
secret, Data API URL, frontend database credentials, or application signing secret
is needed. `HF_TOKEN` is unrelated to authentication.

Initialize the application table once, with the backend environment activated:

```bash
cd backend
python -m app.init_db
```

For schema setup, use the direct Neon connection string from Console → Connect
(turn off connection pooling); the app can use the pooled string afterwards.
The SQL creates only `public.user_progress`; it leaves Neon's auth tables alone.

The account pages use `createAuthClient` from `@neondatabase/neon-js/auth`, its
React adapter, and `NeonAuthUIProvider`, `AuthView`, and `AccountView` from
`@neondatabase/auth-ui`. Cross-origin SDK requests include session credentials.
This follows the [official managed-auth guidance](https://github.com/neondatabase/agent-skills/blob/main/skills/neon-auth/references/managed-auth.md).
Configure your frontend origin in Neon Auth trusted domains; localhost may be
pre-approved. Email verification follows the branch settings. For shared SMTP,
use verification codes when required; do not assume verification links work.

FastAPI credentials are separate: `authClient.token()` issues a bearer JWT.
`current_user()` uses the full Auth URL plus `/.well-known/jwks.json` for keys,
checks EdDSA signatures, and requires issuer and audience equal to the Auth URL's
origin. It also checks expiry, issued-at, and a nonempty user subject. The full
`/neondb/auth` path belongs in the JWKS URL, not the issuer/audience. These rules
follow [Neon's Python JWT verification example](https://neon.com/docs/auth/guides/plugins/jwt).
Session cookie identifiers are not accepted as JWTs. Tokens are never logged or
stored by application code. Every saved-progress query includes the verified
subject; the browser cannot choose another user ID.

Missing/invalid bearer credentials return 401. Missing configuration, unavailable
keys, or unavailable progress storage return 503. Public demo graph endpoints
stay accessible to guests. Sign-out ends the SDK browser session, but an issued
JWT can remain valid until expiry; no immediate bearer-token revocation is promised.

### Verify the real flow

1. Run both apps, then open `/auth/sign-up` and register a test user.
2. Complete any email verification, sign out, and explicitly sign in at `/auth/sign-in`.
3. Open Account on the dashboard and click **Verify API session**; `/api/me` should return your subject.
4. Select episode 2 and click **Save progress**. Change to episode 1, then click **Retrieve progress**; it should restore episode 2.
5. Reload the page: the session should restore. Retrieve progress again to prove persistence.
6. Visit `/account/settings` for account settings and `/account/sessions` for sessions.
7. Sign out via `/auth/sign-out`. The dashboard should show sign-in links; private API requests without a JWT must return 401.
8. Sign in as another user and verify there is no saved progress until that user saves it.

If authentication works but `/token` does not, inspect trusted domains, cross-origin
cookie blocking, and the Auth URL. Safari/third-party cookie policies can prevent
the direct cross-origin session flow; same-parent-domain or proxy deployment may
be necessary. A build or a mocked JWT test is not proof of a live Neon login.

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
| `PUT /api/me/progress/{media_id}` | Bearer token plus `{ "unit": N }`; upserts only this user’s progress; invalid units return 422 |
| `GET /api/me/progress/{media_id}` | Bearer token; returns `UserProgress` or `null` when unsaved |

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

`public.user_progress` is implemented in `app/schema.sql`. The broader graph
schema remains planned:

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
that owner in every query. Guest progress is transient; signed-in users save/retrieve it explicitly from the
Account panel. Plan foreign keys for media/endpoints, uniqueness constraints,
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
middleware framework is required. `frontend/vercel.json` rewrites frontend routes to `index.html`, so direct auth
and account links work on Vercel.

## Hackathon scope and next steps

The architecture stays generic, while one polished, verified real series is enough
for the MVP. Aim for media selection, progress selection, a useful interactive
graph, correct backend filtering, basic accounts, and a deployed demo. Keep AI
extraction as a small proof of concept; do not let scraping consume the hackathon.

Recommended next five implementation tasks:

1. Install dependencies, link/deploy Neon Auth, and verify sign-up/session/JWT flow end to end.
2. Choose one real demo series; curate story units and review entity/relationship reveal points.
3. Expand the graph schema and add automatic saved-progress resume if useful.
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

The Neon SDK/UI are prerelease dependencies. Run `npm install` to update the lockfile
after dependency changes and check the installed APIs before upgrading. Neon authentication
needs branch-specific configuration and trusted domains to work in the browser.

## Reference documentation

- [Vite environment variables](https://vite.dev/guide/env-and-mode)
- [Tailwind with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [React Flow quick start](https://reactflow.dev/learn)
- [Neon Auth SDK](https://github.com/neondatabase/neon-js/tree/main/packages/auth)
- [Neon CLI workflow](https://neon.com/blog/just-landed-in-the-neon-cli)
- [Hugging Face Inference Client](https://huggingface.co/docs/huggingface_hub/main/package_reference/inference_client)

## Auth review validation status

The verifier and progress ownership tests pass using locally signed Ed25519 fixtures
and mocked database queries. Live Neon registration, JWT issuance, and Postgres
save/retrieve are still unverified: this agent workspace blocks external DNS and
browser/server networking. The latest SDK/UI packages also need installation before
the updated frontend can be built and checked. Do not treat this status as live proof.
