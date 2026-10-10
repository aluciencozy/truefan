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
- Neon Auth UI for Google-only sign-in, sign-out, account settings, and a protected API identity check.
- Persistent per-user media progress through authenticated FastAPI endpoints.
- Lazy Neon Postgres connection helper; no database or external credentials needed to boot.
- Dynamic AniList search and reusable Neon franchise caches with bounded discovery and explicit expansion.
  See [franchise discovery and API details](docs/IMPLEMENTATION.md#search-and-universe-discovery);
  unlock presentation remains a dependency on `fm/truefan-universe-explorer`.
- Automatic experimental character extraction from Kitsu/TVmaze through configurable HF inference.
- Shared Neon graph caching, bounded background jobs, resumable checkpoints, and per-episode filtering.
- Legacy extraction/Q&A placeholder routes remain available; the new media-scoped generation route calls HF.

The fixture is **Lantern Harbor**, a fictional three-episode story. Episode 1
reveals three nodes, episode 2 reveals a faction, and episode 3 reveals an object.
Moving backwards removes later information immediately, including selected details.
Progress 0 gives an empty graph. No real-series spoilers are included in the fixture.

The development fixture remains available through its API and explicit
`/explore?media=lantern-harbor` route; the search UI presents real stories.
Accounts use real Neon Auth when configured. Automatic experimental graphs
now supplement it; existing production deployments require the updated code
and additive schema to enable the new flow.
Saved progress needs the application table initialized as described below.

## Example experience

1. Search for an anime title on the homepage and choose its universe.
2. Open an available world, set your progress, and explore its revealed characters.

For the deterministic development fixture, open `/explore?media=lantern-harbor`
and follow these checks:

1. Select the last episode you **finished**, initially episode 1.
2. Pan/zoom the graph and select Mira to read an introductory description.
3. Finish episode 2 and advance the selector: new connections become visible.
4. Rewind to episode 1: the new faction and its relationships disappear.
5. With Neon Auth configured, use the account icon to sign in with Google.
   Episode changes save automatically; opening a story restores watched progress.

Signed-in progress persists across reloads and devices.
Spoiler-safe profiles and Q&A will share the same progress boundary.

## Architecture and stack

```text
Vite + React browser app (Vercel)
  ├─ Neon Auth: managed users, credentials, sessions
  └─ HTTP / JSON → FastAPI (Railway)
                    ├─ reveal-point filtering
                    ├─ JWT verification for user-owned APIs
                    ├─ Neon Postgres (progress and shared caches)
                    ├─ AniList GraphQL (media metadata)
                    └─ Hugging Face Inference Providers (experimental extraction)
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
│   │   ├── schema.sql        # Application schema (see docs/IMPLEMENTATION.md)
│   │   ├── init_db.py        # Explicit table setup command
│   │   └── services/         # Progress, filtering, AniList, episode providers, inference, shared graph jobs
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
npm test
npm run build
npm run preview

# In backend/, with .venv activated
python -m unittest discover -s tests
curl http://localhost:8000/health
curl 'http://localhost:8000/api/media/lantern-harbor/graph?progress=1'
curl 'http://localhost:8000/api/media/lantern-harbor/graph?progress=3'
```

The home route (`/`) is the TrueFan search hero, using Catppuccin Mocha and
self-hosted JetBrains Mono. Homepage suggestions are distinct cached franchises
(for example, “Fate Universe”), grouped by surviving franchise ID and strong
AniList relationship membership. Member titles such as “Fate/Zero” find the same
universe while preserving the matching work as its entry point. Suggestions and Enter open it directly
at `/explore?media=anilist-...`, preserving the selected work as its entry point.
Typing is debounced and searches Neon only. Enter or **Discover this universe**
resolves an uncached title using AniList search and the existing bounded discovery
pipeline, with at most three discoveries per explicit search. Unambiguous results
open automatically; ambiguous results stay in the homepage dropdown. Unresolved
equally relevant candidates at the discovery limit require a more specific query.
Labels shorten stored slash/season names for display; names never establish membership.
Franchise search requires the existing Neon cache; provider/storage errors stay inline.
Empty searches stay on the current page. Opening `/explore` without a selected
story shows the shared search; it does not automatically load the development fixture.
The constellation displays story totals without numbered branch labels.
The explorer’s **Find another story** uses the same search component, suggestions,
discovery, and direct universe navigation as the homepage. The TrueFan header link
returns home to search again. The explorer retains media selection,
progress filtering, and account controls. Home-page image nodes are decorative
artwork reused from the Figma design, not factual story relationships. Assets
live in `frontend/public/home/`; the font license is in `frontend/public/fonts/`.
Log in and Sign up use the existing Neon Auth routes.

The two fixture graph calls should return 3 and 5 entities respectively. In
`/explore?media=lantern-harbor`,
the visible graph comes from FastAPI, not a separate frontend fixture. Change episodes and click a node
to verify the graph and details update. Stop FastAPI and reload to check the error UI.

## Environment variables

| Variable | Location | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Backend | Neon Postgres connection string, with TLS parameters from Console |
| `HF_TOKEN` | Backend | Secret Inference Providers token for graph generation and local probes |
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
Issuer and audience are derived automatically from the Auth URL origin. No
Next.js cookie secret, Data API URL, frontend database credentials, or application
signing secret is needed. `HF_TOKEN` is unrelated to authentication.

Initialize the application table once, with the backend environment activated:

```bash
cd backend
python -m app.init_db
```

For schema setup, use the direct Neon connection string from Console → Connect
(turn off connection pooling); the app can use the pooled string afterwards.
The additive setup preserves existing progress and leaves Neon's auth tables alone.
See the [implemented schema](docs/IMPLEMENTATION.md#5-actual-database-schema) and
[franchise migration instructions](docs/IMPLEMENTATION.md#additive-deployment-migration).

The account pages use `createAuthClient` from `@neondatabase/neon-js/auth`, its
React adapter, and `NeonAuthUIProvider`, `AuthView`, and `AccountView` from
`@neondatabase/auth-ui`. Cross-origin SDK requests include session credentials.
Account details live on `/account/settings`; legacy security/session links redirect
there. The minimal account page omits provider and session management.
This follows the [official managed-auth guidance](https://github.com/neondatabase/agent-skills/blob/main/skills/neon-auth/references/managed-auth.md).
The frontend provider uses the supported
`social={{ providers: ['google'] }}` and `credentials={false}` options:
Google is the only displayed login method; email/password forms and password
settings are hidden. The existing official React SDK and AuthView remain in use.

### Google-only Neon configuration and redirects

- Google is already Active in the Neon dashboard. In the same branch's Auth
  configuration, disable email/password authentication and remove any other
  enabled login providers if Google-only access must be enforced. Hiding forms
  in the frontend does not disable authentication endpoints in Neon.
- In **Neon Console → Auth → Configuration → Domains**, allow the frontend
  origins. Local development uses **http://localhost:3000**; localhost ports are
  pre-approved by default, but ensure this branch's Allow localhost option has
  not been disabled. For Vercel, add the exact **https://your-app.vercel.app**
  origin and any custom domain, including protocol and without a trailing slash.
  Add each preview origin you use; avoid trusting all of `*.vercel.app`.
- The UI's `redirectTo="/"` returns users to the current frontend origin's root
  after Neon completes login. That origin must be trusted by Neon. The SDK
  restores the browser session, then `.token()` supplies a JWT to FastAPI.
- If using your own Google OAuth client, register the exact authorization
  callback shown by Neon: **`{NEON_AUTH_BASE_URL}/callback/google`**, including
  the full `/neondb/auth` path. This is Google's redirect back to Neon, distinct
  from the localhost/Vercel page Neon redirects to afterwards. Store the Google
  Client ID and Client Secret in Neon, never in `VITE_*` variables. Neon's shared
  Google credentials are for development/testing; use your own for production.
- On Vercel, set `VITE_API_URL` to Railway and `VITE_NEON_AUTH_URL` to this
  branch's Auth URL, then rebuild. On Railway, set `FRONTEND_URL` to the exact
  Vercel frontend origin and use the same `NEON_AUTH_BASE_URL`. Backend CORS
  currently accepts one frontend origin; Neon trusting a preview does not
  automatically permit that preview to call FastAPI.

See the official [OAuth setup](https://neon.com/docs/auth/guides/setup-oauth),
[trusted domains](https://neon.com/docs/auth/guides/configure-domains), and
[React Auth UI guide](https://github.com/neondatabase-labs/ai-rules/blob/main/references/neon-auth-ui-react-spa.md).

FastAPI credentials are separate: `authClient.token()` issues a bearer JWT.
The installed Neon Auth 0.5.0-beta SDK incorrectly applies its session cache to
`/token`. The API client uses the SDK's `X-Force-Fetch` option to bypass that cache;
the SDK strips the header before sending the request. Remove this workaround
when an SDK upgrade fixes the cache behavior. Run the regression check with
`node --test tests/auth-api.test.mjs` from `frontend/`.
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

1. Run both apps, then open `/auth/sign-in`; only the Google login button should appear, without email/password fields.
2. Click Google, complete sign-in, and confirm you return to the dashboard with an Account session.
3. Open a story and select episode 2. The footer should show **Saved** after the authenticated progress request completes.
4. Rewind to episode 1: later facts disappear while watched history remains at episode 2.
5. Reload and reopen the story: the session and watched episode 2 should restore automatically.
6. Visit `/account/settings` to update account details or sign out; `/account/security` and `/account/sessions` redirect there.
7. Sign out via `/auth/sign-out`. The dashboard should show sign-in links; private API requests without a JWT must return 401.
8. Sign in as another user and verify there is no saved progress until that user updates an episode.

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
| `GET /api/media/search?q=...` | See [search behavior](docs/IMPLEMENTATION.md#search-and-universe-discovery) |
| `GET /api/universes/search?q=...&discover=false` | Public; `{ results: [{ franchise_id, title, entry_media_id, cover_url }], auto_open }`; five distinct cached franchises; `discover=true` permits bounded on-demand discovery when no cached match exists |
| `GET /api/media/{id}` | One `Media`; unknown IDs return 404 |
| `GET /api/media/{id}/universe` | Public cache-first franchise graph; `root_id` remains the exact selected work |
| `POST /api/media/{id}/universe/expand` | Public bounded frontier expansion; body `{ "expected_revision": N }`; stale revision is 409 |
| `GET /api/me/media-state?media_id=...` | Bearer token; 1–50 unique IDs; returns `{media_id, progress, completed, manual_unlocked}[]` |
| `PUT /api/me/media-state/{id}` | Bearer token; supplied `completed`/`manual_unlocked` flags only; preserves saved units |
| `GET /api/media/{id}/graph?progress=N` | Required non-negative completed unit; returns filtered `GraphResponse`; out-of-range returns 422 |
| `POST /api/extract` | `ExtractRequest`; returns 501 with a typed `not_implemented` message |
| `POST /api/ask` | `AskRequest`; returns 501 without generating an answer |
| `GET /api/me` | Bearer token required; returns `{ "id": "verified-user-subject" }` |
| `PUT /api/me/progress/{media_id}` | Bearer token plus `{ "unit": N }`; upserts only this user’s progress; invalid units return 422 |
| `GET /api/me/progress/{media_id}` | Bearer token; returns `UserProgress` or `null` when unsaved |

Visible character entities also include nullable `portrait_url` (medium) and
`portrait_large_url` (large) from AniList. The backend matches normalized names,
name order, and aliases against the selected media's `anilist_id`, after episode
filtering. Ambiguous matches keep monograms. Cast pages reuse the existing
one-hour AniList cache; names, aliases, biographies, and future cast entries are
never added to the response. Nodes lazy-load portraits; details use the larger
image, with monogram fallbacks on image errors or provider outages. AniList
portraits are general profile art, not episode-specific artwork.

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

The [implemented database schema](docs/IMPLEMENTATION.md#5-actual-database-schema)
is defined in `app/schema.sql`. Generated graphs use episode snapshots in JSONB
so they can be cached across users while retaining progress-specific descriptions.
The following normalized-table layout remains an optional future direction:

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
that owner in every query. Guest progress is transient; signed-in episode changes
save automatically and story entry restores watched progress. Plan foreign keys
for media/endpoints, uniqueness constraints,
and indexes by media/reveal unit. Keep source and review metadata with each fact.

**Important future limit:** a single reveal point on an entity only protects its
introductory description. Later aliases, identities, affiliations, biographies,
and changed relationships must be stored as separately revealable facts or
versions. Do not replace an early description with a full-story biography.

## Universe exploration and release guidance

Search results keep their exact AniList media ID and your typed query. Selecting
an anime opens a spacious React Flow canvas at a readable zoom near the selected
work. Pan and zoom to explore; **Fit View** shows the complete discovered graph.
Pan bounds and minimum zoom are derived from its layout. Select a destination
to smoothly focus it, inspect its connections, and use **Enter anime** (or
double-click an accessible node) to open the existing episode-filtered character
graph. **Return home** focuses the original selection. Returning from characters
keeps the universe canvas and camera mounted. The map uses the homepage's dark
Catppuccin Mocha palette and locally hosted Pixelify Sans typography, with cover
art, thin connections, and distinct locked/available/completed states.

Selecting a character focuses its node and opens a Motion detail panel on the
right half of the desktop canvas (a bottom panel on mobile). Closing restores
the previous camera. Details show only the filtered graph's descriptions,
relationships, and provenance. Character artwork is not supplied by the API,
so characters use monograms. Changing progress immediately removes old graphs
and details. Motion respects reduced-motion settings; layouts do not recalculate
while panning or zooming.

`universeModel.ts` normalizes stable typed connections while preserving the
original directed AniList evidence. PREQUEL reverses placement direction;
reciprocal SEQUEL/PREQUEL evidence shares one connection. Alternatives are
symmetric cross-links, never fabricated sequels. A deterministic, cycle-safe
primary sequel forest retains other connections as dashed links. Straight
continuation chains share an inferred branch; forks and multiple parents split
branches. Explicit alternatives, spinoffs, side stories and adaptations prevent
transitive branch merging. Different format families (TV/TV_SHORT/ONA versus
films, OVAs or specials) also remain separate, so an optional OVA prequel does not
become a TV-season viewing prerequisite. Adaptation/version branches remain connected nearby.
These heuristics describe provisional groups, not canonical continuity facts.

`universeLayout.ts` lazily loads ELK.js and places fixed-size nodes inside inferred
branch lanes, then arranges those lanes as left-to-right branching paths using a
deterministic semantic spanning forest (sequel links first, adaptation/version links next, branch links
then weak associations). Disconnected components are packed separately. This
scaffold only controls geometry; the rendered connections retain the general graph. Input
IDs/edges are sorted and layout uses a fixed seed. Release dates, watched state
and overlays are absent from geometry inputs. Expansion preserves all existing
media anchors, aligns new members to branch anchors when possible and appends
colliding cards. This favors spatial memory over a perfect refreshed layout;
branch regions/cross-links can become less tidy after several expansions.
Layout failure falls back to deterministic branch lanes without hiding nodes.

**Release guidance** numbers entries *within each branch*, rather than
interleaving unrelated continuities by global release date. Sorting compares
known year/month/day, puts missing components after known components at the same
year/month, then uses stable media ID. Partial dates stay labeled partial and
undated entries sort last. Nothing invents a date or treats a release sequence as
story chronology or guaranteed spoiler-free viewing.

The universe opens in **Focus Mode**, with an enlarged glowing world near the
middle-left and a compact details panel beside it (below it on small screens).
The camera frames a local neighborhood; remote worlds recede until visited.
Arrow keys follow spatially aligned connected neighbors. **Previous/Next** prefer
primary prequel/sequel connections, with other actual connections as fallbacks.
Click a world or a connection to travel. **Overview** smoothly fits all discovered
worlds; toggle it again to return to the same selection, or select a world to
focus it. Free panning, wheel/pinch zoom, and automatic focus panning are disabled
in both modes. Character graph camera controls remain independent.

React Flow interpolates the camera along straight connections; Motion animates
node scale, arrival rings, traveling light trails and the details panel. Layout
only runs when the discovered model changes, never during camera movement or
progress updates. Reduced-motion preferences disable the cinematic transitions.
The panel's short summary uses relationship/format metadata rather than provider
plot synopses, which have no spoiler-safe reveal boundary. Recorded progress is
shown as saved; explicit completion does not fabricate watched episode numbers.
**Enter World** opens the existing progress-filtered character graph.

All discovered nodes remain in the map. **Locked** uses **Undiscovered** in place
of the title across the map, details, connections, tooltips and screen-reader
announcements. Covers have a strong blur and muted Catppuccin Mocha overlay,
including on hover/focus. Actual connections remain visible, with no episode
metadata/story details or character entry. This is a presentation preference;
the public universe metadata API still returns titles and cover URLs.
**Available** can be entered; **Completed** remains accessible and has a watched
marker. Incomplete covers are dimmed. Each inferred branch has its own available
starting point, so alternate/spinoff branches can be explored in parallel.
Later dated releases in that branch are available after the preceding release
is confirmed complete. Undated works remain available rather than blocking
forever; partial-date suggestions are approximate. Existing positive watched
progress or a manual override grants entry regardless of the suggestion.
**Unlock anyway** changes availability only, preserving saved units/completions.
**I finished this anime** explicitly confirms completion, including uncertain
counts, without fabricating watched episode numbers.

Guest confirmations/overrides last for the current app session. Signed-in users
load all discovered works' state through deterministic bulk batches of at most
50 IDs and save flags immediately. Merged cached universes may contain more than
50 nodes; they all remain visible.
The compact episode stepper also accepts a typed episode number, with prologue
numbering preserved. Every signed-in change automatically persists watched units;
writes run in order and failures offer a retry. Character loading and generation
status appear in the center of the canvas. The account icon opens an animated
settings/logout dropdown. The frontend saves at least the previously recorded unit
and does not erase completion when you rewind. API completion flags are
authoritative; the frontend never infers completion from an unknown one-unit
fallback or generation coverage. Account changes clear user state. Entry locks
are navigation guidance, not new server authorization; public character API
access and backend reveal filtering remain unchanged.

`Media` adds nullable fuzzy `release_date: {year, month, day}` and
`total_units_known` (false by default; old snapshots remain compatible).
`Universe` retains `root_id`, `media`, raw `relationships` and `truncated`, and
adds nullable `franchise_id` and `cache` (`refreshed_at`, `stale`, `incomplete`,
`revision`, `can_expand`, `limitations`). A cached franchise can be reused through
different entry works while preserving the selected root. **Expand universe**
uses the cached revision, respects configured discovery bounds, and retains the
map on errors. Saved frontier expansion is not guaranteed complete discovery or
a full stale-metadata refresh. Names alone never establish membership.

Deploy the companion backend/cache migration before this frontend: apply its
additive schema with `python -m app.init_db` using the target direct database URL.
`FRANCHISE_CACHE_TTL_SECONDS` is backend-only (default 86400). Missing persistent
storage retains bounded live discovery with null cache evidence. Provider
metadata, membership and dates can be incomplete. Keep collection bounded and
on demand; AniList public API access is not a license to mirror its catalog.
Character extraction, Auth/JWT verification and episode reveal rules are unchanged.

Run `npm test` in `frontend/` (Node 24 recommended) for pure normalization,
release/progression/override, deterministic ELK, expansion-anchor, safe locked
panel and Auth API checks. Backend tests remain in `backend/tests`.

## AniList integration

See [search and reusable franchise discovery](docs/IMPLEMENTATION.md#search-and-universe-discovery)
for the implemented metadata flow and its limitations.
AniList is metadata, not a trustworthy episode-by-episode reveal dataset. Character
biographies and cast lists can themselves contain spoilers, so never send them
straight to a progress-filtered profile. Other media providers can be added later.

## Episode-summary source investigation

The standalone Kitsu/TVmaze comparison reuses the original Jikan probe's HTTP
client, AniList resolver, sampling, and metrics. Run it from `backend/`:

```bash
.venv/bin/python scripts/episode_provider_feasibility.py --output /tmp/truefan-episode-provider-results.json
```

It samples five numbered episodes from each of five anime per provider, verifies
Kitsu external-ID mappings, and uses TVDB IDs to match TVmaze where available.
It separates missing text from request errors and records numbering and specials.
Raw responses stay outside the repository; never commit the results file.
See [the comparison report](docs/episode-provider-feasibility.md) for measured
coverage, matching limits, and why episode safety still needs review. Kitsu is the
stronger candidate in this sample; TVmaze can supplement sparse information.
These provider probes are experiments, not production integrations, and make no
AI calls or Neon writes. The [earlier Jikan report](docs/jikan-feasibility.md) remains a historical
record of that investigation.

## Hugging Face extraction experiment

For a simple one-request check using a made-up story, set `HF_TOKEN` and
`HF_MODEL` in `backend/.env`, install `backend/requirements.txt`, and run from
`backend/`:

```bash
.venv/bin/python scripts/hf_extraction_smoke.py
```

This optional smoke test checks JSON structure, entity names, relationship
endpoints, and exact evidence quotes. It prints the model response and exits
with a nonzero status on failure. It makes no database writes, does not verify
semantic correctness or spoiler safety, and can consume inference credits.
Keep captured model responses outside the repository.

From `backend/`, using the server-only `HF_TOKEN` in `backend/.env`:

```bash
.venv/bin/python -m scripts.hf_extraction_feasibility --output /tmp/truefan-hf-extraction.json
.venv/bin/python -m unittest discover -s tests
```

This bounded experiment resolves UBW and samples the prologue plus episodes 1–5.
Kitsu is primary; TVmaze supplies a matched prologue when Kitsu's episode text is
null. Six independent requests per run use Qwen3-4B-Instruct-2507 through Hugging Face's
nscale provider, with structured JSON and Pydantic validation. Pass
`--model Qwen/Qwen2.5-72B-Instruct:deepinfra` to reproduce the larger-model
comparison; that model uses a custom Qwen license rather than Apache 2.0. Running the script
can consume inference credits. Raw descriptions/responses stay outside the repo.
Lexical grounding rejects missing names, fabricated evidence, and invalid edges;
semantic support and spoiler timing require separate review. Candidates are never
loaded by the production API. See [the extraction report](docs/hf-extraction-feasibility.md)
and [reviewed candidates](docs/data/ubw-extraction-candidates.json).

## Automated graph generation

```text
AniList
    ↓
media metadata + characters
    ↓
Kitsu episode descriptions / TVmaze fallback / curated summaries
    ↓
Hugging Face open-source model / Inference Providers
    ↓
structured entities + relationship assertions + source support + provenance
    ↓
automatic schema/source checks + approximate support boundaries
    ↓
Neon Postgres
    ↓
spoiler-aware graph API
```

`services/huggingface.py` now provides the runtime inference adapter. Runtime graphs
are automatically served as experimental/unverified; they are not manually moderated
or imported from offline candidate JSON. Support boundaries are approximate and not
advertised as guaranteed spoiler-safe. See the implementation guide below.

See [the automated pipeline guide](docs/automated-graph-generation.md) for API
contracts, job recovery, provider matching, UBW prologue numbering, quotas, storage,
and limitations. Before deploying the updated backend, run `python -m app.init_db`
with a direct Neon URL. Existing tables/progress remain intact. Configure server-side
`HF_MODEL`, `HF_TOKEN`, and `GENERATION_EPISODE_CAP`; defaults and other controls
are documented in `backend/.env.example`. Changing progress never reruns inference.

The frontend opens a universe from search, focuses media on selection, then opens an accessible work through **Enter anime** or double-click.
New graphs require Google authentication; cached graphs are shared. Save/Retrieve
progress still uses the existing user-owned endpoints. Initial generation is capped
and reports partial coverage honestly. No Vercel/Railway hosting settings were changed.

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

1. Install dependencies, link/deploy Neon Auth, and verify Google sign-in/session/JWT flow end to end.
2. Choose one real demo series; curate story units and review entity/relationship reveal points.
3. Expand the graph schema as more curated stories become available.
4. Coordinate the universe unlock UI with `fm/truefan-universe-explorer`; see the
   [backend contract and frontend dependency](docs/IMPLEMENTATION.md#7-http-api-reference).
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

The Google-only UI builds and typechecks with the installed official Neon packages.
All nine backend verifier, progress ownership, and graph tests pass using local
Ed25519 fixtures and mocked database queries. Browser inspection confirms the
sign-in page displays only Google, and clicking it reaches Google's live sign-in
page through Neon. The configured live JWKS endpoint returns HTTP 200 with an
Ed25519 public key; FastAPI returns 401 for missing and invalid bearer tokens.
The user's browser completed Google sign-in and received a live Neon session
and JWT. The installed SDK's session cache prevented the API client from
requesting a token; the workaround passes a local regression check using the
installed SDK and HTTP fixtures. Protected API success and Postgres save/retrieve
still require a live check after the fix.
A build, an OAuth redirect, or mocked JWT tests do not prove the complete live flow.

## Community (Figma: Truefan)

`/community` implements the Figma design in typed React components. Shared colors,
local Pixelify Sans/Inter fonts, starry backgrounds, and control styles live in
`frontend/src/index.css`; original Figma SVG assets live in `frontend/public/community`. The shared palette
is used throughout the app; Community and Library typography/form tokens are
scoped to their pages to preserve the homepage and constellation explorer styles. The palette
matches Truefan’s Community frame (`123:30`): charcoal `#1e1e2e`, panels
`#181825`, borders `#45475a`, pale text `#cdd6f4`, and lavender `#cba6f7`.
The sidebar links Explore, My Library (`/library`), and Community. Community has
Discussions, Theories, and Reviews, search/media filters, latest/popular sorting,
post links, optional review ratings, likes, and comments. There are no episode controls
on this page. My Library reads the signed-in user's existing saved progress.

Community data is stored in Neon Postgres. With backend dependencies and
`DATABASE_URL` configured, initialize its additive tables once:

```sh
cd backend
python -m app.init_community
```

The initializer does not populate the live feed. Optionally use
`python -m app.init_community --seed-demo` for three clearly marked example posts;
these have zero likes/comments. If storage is unavailable, the UI shows a labelled
design preview and disables publishing/reactions rather than inventing activity.
Deploy the updated backend and frontend to make these changes available online;
initialize the tables on the same Neon branch used by that deployment.

Community API contracts (also available in `/openapi.json`):

| Endpoint | Access / behavior |
| --- | --- |
| `GET /api/community/posts` | Public; `category`, `media`, `q`, `sort`, `include_spoilers`, `offset`; 20 posts per page and `has_more`. |
| `POST /api/community/posts` | Verified Neon bearer JWT; category, media, title, body, `contains_spoilers`, optional rating 1–5 for reviews. |
| `GET /api/community/posts/{id}` | Public; respects `include_spoilers`, including copied post links. |
| `PUT /api/community/posts/{id}/like` | Verified JWT; `{ "liked": true }` or false; one like per user/post. |
| `GET /api/community/posts/{id}/comments` | Public; filters parent and comment spoiler flags; latest 100 comments. |
| `POST /api/community/posts/{id}/comments` | Verified JWT; body and `contains_spoilers`; inherits a spoiler parent's flag. |
| `POST /api/community/presence` | Public heartbeat with browser `visitor_id` UUID and category `page`; optional verified JWT. |
| `GET /api/community/library` | Verified JWT; only the caller's saved media. |

The visitor badge counts activity within the last 90 seconds, refreshing every
25 seconds while the page is visible. Anonymous visitors are counted by browser,
and authenticated visitors are deduplicated by verified user ID across browsers.
It is an estimate of recent presence, not a fabricated fixed “128” or an exact count
of humans. Counts span the Community tabs. Public posts use stable pseudonyms;
ownership comes exclusively from the verified JWT, never request-supplied user IDs.

Spoiler posts and comments are excluded in backend queries by default, including
search/media options and comment counts. Authors supply spoiler flags; this does
not automatically detect spoilers or apply graph reveal points to community text.

Validation: frontend build/typecheck, existing SDK token regression, and community
API tests. Real Postgres regression tests use isolated temporary tables and verify
like deduplication, presence expiry/deduplication, filtering, and comments. Run them
with `TRUEFAN_COMMUNITY_DB_TESTS=1 python -m unittest discover -s tests -p test_community.py`.
These tests do not certify a live Google sign-in and publishing session.
