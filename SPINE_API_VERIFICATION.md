# TrueFan — Spine (Track 2) API Verification Task

You are working in the TrueFan repo (spoiler-aware media knowledge graph) on branch
`spine/api-core`. I am **The Spine**: backend, database, and API routing. Your job is to
verify and harden the FastAPI backend so the React Flow frontend always gets a correct,
spoiler-safe payload.

---

## 0. Hard rules (read first, follow throughout)

1. **NEVER run `git commit`, `git push`, `git merge`, `git rebase`, `git reset`,
   `git checkout <file>`, `git stash`, or anything else that changes git history or the
   remote.** I commit and push myself from my own terminal. Read-only git
   (`git status`, `git diff`, `git branch --show-current`, `git log`) is fine.
   At the very end, *print* the git commands I should run and do not run them yourself.
2. Read `AGENTS.md` and the README's "API contracts" table before changing anything.
   Those are the project rules, and they override your defaults.
3. All reveal comparisons stay in `backend/app/services/graph.py` (`is_revealed`).
   Don't duplicate `<=` checks in `main.py` or anywhere else.
4. Keep diffs small and hackathon-sized. Don't add new frameworks, ORMs or abstractions.
   Don't add a dependency to `requirements.txt` without asking me first.
5. Never print, log, or write secrets (`DATABASE_URL`, `HF_TOKEN`, JWTs, Neon keys).
   Never edit `.env` files; only `.env.example` if a variable is genuinely missing.
6. If you change an API contract (path, param, response shape), update
   `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts` **and** the README contract
   table in the same change. Prefer not to change contracts at all.

---

## 1. Context you need (already verified by reading the code)

### Terminology mapping (important)
I talk about `unlock_episode <= current_episode`. In this codebase that is:

| My words | Code |
|---|---|
| `unlock_episode` | `Entity.revealed_at.unit` / `Relationship.revealed_at.unit` (`RevealPoint`) |
| `current_episode` | `?progress=N` query param → `RevealPoint(unit=N)` |
| the filter | `is_revealed(reveal, progress)` → `reveal.unit <= progress.unit` in `services/graph.py` |

**Do not rename fields to `unlock_episode`.** The frontend types, README contract and
tests depend on `revealed_at.unit` / `progress`. Just verify the semantics match.

### Files
- `backend/app/main.py` has the routes, CORS, and the `get_demo()` 404 guard.
- `backend/app/schemas.py` has the Pydantic models (`Media`, `Entity`, `Relationship`, `GraphResponse`, `RevealPoint`, ...).
- `backend/app/services/graph.py` has `is_revealed` and `filter_graph`. Edges must pass the reveal check **and** both endpoints must be visible.
- `backend/app/services/demo.py` is the in-memory fixture `lantern-harbor` (3 episodes).
- `backend/app/services/progress.py` handles the Neon Postgres progress read/upsert (503 when DB is missing or unavailable).
- `backend/app/auth.py` does Neon Auth JWT verification (EdDSA only; 401 without a token or with a bad one, 503 when unconfigured).
- `backend/tests/` holds the `unittest` tests: `test_graph.py`, `test_auth.py`, `test_progress.py`.
- On the frontend, `frontend/src/lib/api.ts`, `types.ts` and `components/GraphCanvas.tsx` consume the payload. Every `relationship.source/target` must match an `entity.id` or React Flow will draw dangling edges.

### Endpoint contract (from README + main.py)
| Endpoint | Auth | Expected |
|---|---|---|
| `GET /health` | none | `200 {"status":"ok","mode":"demo"}` |
| `GET /api/media/search?q=` | none | `200 Media[]`, case-insensitive title match; `q` max 200 chars (201 → 422) |
| `GET /api/media/{id}` | none | `200 Media`; unknown id → `404` |
| `GET /api/media/{id}/graph?progress=N` | none | `200 GraphResponse`; missing/negative/non-int `progress` → `422`; `N > total_units` → `422`; unknown id → `404` |
| `POST /api/extract`, `POST /api/ask` | none | `501` typed `not_implemented` (by design); bad body → `422`; unknown media → `404` |
| `GET /api/me` | Bearer JWT | no token → `401`; Neon Auth unconfigured → `503` |
| `GET/PUT /api/me/progress/{id}` | Bearer JWT | no token → `401`; DB unconfigured/unreachable → `503`; PUT body `{"unit": N}` |

### Expected graph payloads for `lantern-harbor`
| `progress` | entity ids | relationship ids |
|---|---|---|
| 0 | `[]` | `[]` |
| 1 | `mira, sol, harbor` | `friends, visits` |
| 2 | `mira, sol, harbor, keepers` | `friends, visits, maintains, joins` |
| 3 | `mira, sol, harbor, keepers, compass` | `friends, visits, maintains, joins, finds` |
| 4 | — | `422` (exceeds `total_units=3`) |

Invariants for **every** 200 graph response:
- every entity and relationship has `revealed_at.unit <= progress.unit`
- every relationship's `source` and `target` is in the returned entity id set
- no entity id or relationship id is duplicated
- `response.progress.unit == N` and `response.media_id == id`
- no hidden entity's `name`/`description` appears anywhere in the JSON (spoiler leak check)

---

## 2. Step-by-step task

Use a task list, and work through these in order.

### Step 1: Environment check (no changes)
```bash
git branch --show-current          # expect spine/api-core; if not, STOP and tell me
git status --short
cd backend
ls -d .venv venv 2>/dev/null       # AGENTS.md says .venv, but the repo has venv/ — use whichever exists
source venv/bin/activate || source .venv/bin/activate
python -c "import fastapi, pydantic_settings, psycopg, jwt; print('deps ok')"
```
If deps are missing, run `pip install -r requirements.txt` inside the venv (or `uv pip install -r requirements.txt`).

### Step 2: Run the existing tests
```bash
cd backend && python -m unittest discover -s tests -v
```
Report pass/fail. If something fails, diagnose the root cause before touching code.

### Step 3: Start the server and run the live smoke matrix
In one terminal (or as a background process you clean up afterwards):
```bash
cd backend && uvicorn app.main:app --port 8000
```
Then create **`backend/scripts/smoke_api.py`**, a stdlib-only script (no `requests`/`httpx`) that I can re-run myself
any time with `python backend/scripts/smoke_api.py [base_url]`. It must:
- default `base_url` to `http://localhost:8000`
- check every row of the contract table above (status code + body shape)
- check every row of the expected-payloads table, plus all the invariants
- send CORS preflights (`OPTIONS` with `Origin: http://localhost:3000` and
  `Access-Control-Request-Method: GET`, and one for `PUT` with
  `Access-Control-Request-Headers: authorization,content-type`) and assert
  `access-control-allow-origin` echoes the origin
- treat `401`/`503` on `/api/me*` as **expected** when no token / no Neon config is set,
  and label them "auth not configured" vs "auth rejected" in the output
- print one PASS/FAIL line per check and exit non-zero on any FAIL
- never print `Authorization` header values

If `TRUEFAN_TEST_JWT` is set in the environment, also test the authenticated routes with
it (`/api/me`, `PUT` then `GET` progress round-trip with `{"unit": 2}`, and `{"unit": 99}` → 422).
Otherwise skip those checks and say why.

Also give me the equivalent **raw curl commands** in your final report so I can run them by hand:
```bash
curl -i http://localhost:8000/health
curl -i 'http://localhost:8000/api/media/search?q=lantern'
curl -i 'http://localhost:8000/api/media/lantern-harbor'
for p in 0 1 2 3 4; do curl -s -o /dev/null -w "progress=$p -> %{http_code}\n" "http://localhost:8000/api/media/lantern-harbor/graph?progress=$p"; done
curl -s 'http://localhost:8000/api/media/lantern-harbor/graph?progress=2' | python -m json.tool
curl -i 'http://localhost:8000/api/media/lantern-harbor/graph'            # expect 422 (missing progress)
curl -i 'http://localhost:8000/api/media/lantern-harbor/graph?progress=-1' # expect 422
curl -i 'http://localhost:8000/api/media/nope/graph?progress=1'            # expect 404
curl -i http://localhost:8000/api/me                                        # expect 401
curl -i -X OPTIONS http://localhost:8000/api/me/progress/lantern-harbor \
  -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

### Step 4: Lock in the reveal filter with tests
Add `backend/tests/test_api.py` using `fastapi.testclient.TestClient` **only if `httpx`
is already installed** in the venv (`python -c "import httpx"`). If it isn't, ask me
before adding it to `requirements.txt`. Cover:
- parametrized `progress` 0–3 → exact entity/relationship id sets from the table
- the invariants (reveal ≤ progress, both endpoints visible, no duplicates)
- a spoiler-leak check: serialize the JSON for progress=1 and assert `"compass"`,
  `"Glass compass"`, `"Lightkeepers"` do not appear
- a fixture that injects an edge revealed early whose endpoint is hidden
  (e.g. `finds` with `revealed_at.unit=1`) → edge must be dropped
- `422` for missing / negative / non-integer / > total `progress`; `404` for unknown media
- `/health` and `/api/media/search` (match, no match, case-insensitive, `q` of 201 chars → 422)
- `/api/me` → 401 without a token (patch `settings.neon_auth_base_url` so it isn't a 503)

Run the full suite again afterwards.

### Step 5: Hunt for 500 / 422 / auth errors and fix real bugs
For every non-2xx you see, classify it:
- **By design** (keep): 422 for missing/invalid/out-of-range `progress`, 404 unknown media,
  501 extract/ask, 401 missing/invalid token, 503 unconfigured Neon Auth or DB.
- **Config** (explain the fix; don't change code): e.g. `FRONTEND_URL` not matching the
  browser origin (CORS failure that shows up as a "network error" in the browser), `NEON_AUTH_BASE_URL`
  empty → 503, `DATABASE_URL` empty → 503, `python -m app.init_db` not run → 503.
- **Bug** (fix it): any **500**, any response that fails `response_model` validation,
  any edge with a hidden endpoint, any field leaking a future reveal, frontend/backend type drift.

Specific things to probe and report on:
1. Force unexpected exceptions. Hit `/api/me` with a malformed token (`Bearer abc`), a token
   with no `kid`, and an unreachable JWKS URL. Each must be 401/503, **never 500**.
   Check which `jwt`/`PyJWKClient` exceptions can escape the `try` in `auth.py`.
2. `progress.py`: confirm every DB failure path becomes 503, not 500, including the
   case where the `user_progress` table doesn't exist yet.
3. `GET /api/me/progress/{id}` returning `null` must still be a 200 the frontend can parse.
4. CORS: `allow_origins` is a single exact origin. Confirm Vite runs on `:3000` (see
   `frontend/vite.config.ts`). Tell me what `FRONTEND_URL` must be on Railway for the
   Vercel origin. Don't widen to `*`, because the auth header is involved.
5. `search` with `q=""` currently returns the demo media (empty string is "in" every
   title). Tell me whether that's what the frontend expects (check `MediaControls.tsx`)
   and only change it if it breaks the UI.
6. Contract drift: compare `/openapi.json` with `frontend/src/lib/types.ts` field by field.

For every fix, show me the problem, the root cause, the minimal diff, and the test that proves it.

### Step 6: Verify the frontend receives what it expects
Without changing frontend code unless there's a real bug: read `GraphCanvas.tsx`
and confirm the `GraphResponse` maps cleanly to React Flow (`entity.id` → node id,
`relationship.source/target` → edge endpoints, `relationship.id` → unique edge id).
Optionally run `cd frontend && npm run typecheck`.

---

## 3. Final report format

When you're done, reply with:

1. **Summary table:** each endpoint, the status codes you observed, and PASS/FAIL
2. **Reveal filter verdict:** whether `unlock ≤ current` holds for nodes and edges at progress 0–4, with evidence
3. **Errors found:** each one classified as By design / Config / Bug, with the fix
4. **Files changed:** the list plus a short `git diff --stat`
5. **Commands for me to run** (don't run them yourself):
   ```bash
   cd backend && python -m unittest discover -s tests -v
   python backend/scripts/smoke_api.py
   git status
   git diff
   git add <the files you changed>
   git commit -m "<suggested message>"
   git push origin spine/api-core
   ```
6. Any open questions or decisions that need me.

Reminder: **do not commit or push.** Stop after the report.
