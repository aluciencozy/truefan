# TrueFan Spine: Live Neon Hookup and Fix Pass

Repo: TrueFan, branch `spine/api-core`. I'm **The Spine** (backend, DB, API routing).
This continues `SPINE_API_VERIFICATION.md`. I have now put real values for
`DATABASE_URL`, `NEON_AUTH_BASE_URL` (and possibly `NEON_AUTH_JWKS_URL`) in `backend/.env`.

Goals:
1. Confirm and finish the `JSONDecodeError` fix in `backend/app/auth.py`.
2. Make `python -m app.init_db` and the progress endpoints work against the **live** Neon DB, with no 500s.
3. Run `python backend/scripts/smoke_api.py` and get `ALL CHECKS PASSED`.

---

## 0. Hard rules

1. **Never run `git commit`, `git push`, `git merge`, `git rebase`, `git reset`, `git stash`,
   or `git checkout -- <file>`.** I commit and push from my own terminal. Read-only git
   (`status`, `diff`, `log`, `branch --show-current`) is fine. At the end, *print* the git
   commands for me and do not run them.
2. **Secrets:** never print, echo, log, or paste the values in `backend/.env`.
   - No `cat .env` and no `print(settings.database_url)`.
   - When you need to inspect them, use a script that prints a **redacted** shape only: scheme, host, db name, query-param *names*, and whether a password is present.
   - Never write secrets into code, tests, README, or `.env.example`.
   - Don't edit `backend/.env` yourself. If a value looks wrong, tell me exactly what to change and I'll do it.
3. Follow `AGENTS.md`. Keep diffs small, add no new dependencies without asking, keep
   all reveal logic in `services/graph.py`, and don't change API contracts.
4. **"All endpoints return 200" is NOT the goal.** The contract deliberately returns:
   - **422** for bad or out-of-range `progress`
   - **404** for unknown media
   - **501** for `/api/extract` and `/api/ask`
   - **401** for a missing or invalid token
   
   `smoke_api.py` already *expects* those codes. Success means **every smoke check
   PASSes and nothing returns 500**. Never "fix" a check by making an endpoint return 200
   when the contract says otherwise.

---

## 1. Current state (already verified by reading the files)

- `backend/app/auth.py` **already contains a fix**: `current_user` catches
  `(jwt.PyJWKClientConnectionError, json.JSONDecodeError)` and returns 503
  "Identity provider temporarily unavailable". A test,
  `test_jwks_garbage_and_missing_kid_never_500`, exists in `tests/test_auth.py`.
  - Why it was needed: `PyJWKClient.fetch_data` only wraps network errors. If the JWKS URL
    answers with HTML, such as a wrong path or a login/error page, `json.load` raises
    `JSONDecodeError`, which escaped as a **500**.
  - **That fix only stops the crash. The likely real cause is a wrong `NEON_AUTH_BASE_URL`
    or JWKS URL, and you need to find it (step 3).**
- `backend/app/services/progress.py` turns every `psycopg.Error` into 503, and
  `tests/test_progress.py::test_database_failures_become_503` covers missing-table and
  unreachable-DB cases.
- `backend/app/config.py` loads `backend/.env` **once at import time**.
  `uvicorn --reload` does **not** watch `.env`, so **restart uvicorn after any `.env` change.**
  `jwks_client` is also `lru_cache`d per URL.
- `backend/app/database.py` uses `psycopg.connect(..., connect_timeout=5)`.
- `init_db.py` runs `schema.sql`, which does `CREATE TABLE IF NOT EXISTS public.user_progress` and is safe to re-run.
- There are two venvs: `backend/venv/` and a repo-root `.venv/`. Use whichever has the
  requirements installed (`python -c "import fastapi, psycopg, jwt"`), and tell me which.
- `smoke_api.py` sends CORS preflights with `Origin: http://localhost:3000`. If
  `FRONTEND_URL` in `.env` is set to a Vercel URL, those two checks will fail locally.
  That's a config mismatch, not a bug.

---

## 2. Step 1: Baseline

```bash
git branch --show-current            # must be spine/api-core, otherwise STOP
git status --short
cd backend && source venv/bin/activate   # or: source ../.venv/bin/activate
python -m unittest discover -s tests -v
```
All unit tests must pass before you touch anything.

## 3. Step 2: Validate `.env` shape (redacted)

Write a throwaway check (don't save it in the repo) that loads `app.config.settings` and prints
**only** the following:

- **`DATABASE_URL`:**
  - It starts with `postgresql://` or `postgres://`, with no surrounding quotes, no leading `psql `, and no trailing `'`. Neon's console "psql" snippet is a common paste mistake.
  - The host ends in `.neon.tech`, and you should say whether it's the `-pooler` host.
  - A password is present (yes/no only).
  - The query params include `sslmode=require`. List the param **names** only.
  - The database name.
- **`NEON_AUTH_BASE_URL`:**
  - It's `https://`, show the host plus path (no secrets live in this URL, but still don't print query strings).
  - There's no trailing `/.well-known/...` already appended.
- **`NEON_AUTH_JWKS_URL`:** whether it's empty or set, and if set, whether it's https.
- **`FRONTEND_URL`:** print it.

Report anything malformed and tell me the exact correction to make in `.env`.

## 4. Step 3: Auth root cause (`JSONDecodeError`)

1. Compute the JWKS URL exactly the way `verification_config()` does, then fetch it:
   ```bash
   curl -sS -o /tmp/jwks.json -w "%{http_code} %{content_type}\n" "<computed jwks url>"
   python -c "import json;d=json.load(open('/tmp/jwks.json'));print([(k.get('kty'),k.get('crv'),k.get('alg'),bool(k.get('kid'))) for k in d['keys']])"
   ```
   The expected result is HTTP 200, `application/json`, and at least one key with `kty=OKP` and `crv=Ed25519`.
   If you get HTML, a 404, or a redirect, the base URL is wrong. It must be the full branch
   Auth URL from the Neon Console, the same as `VITE_NEON_AUTH_URL` in `frontend/.env`
   (compare the host and path only).
2. Keep the existing `JSONDecodeError` → 503 catch. Also check these and fix them if they apply, with a test for each:
   - `jwt.PyJWKClientError("...did not contain any signing keys")` currently maps to **401**. Since that's a server misconfiguration, return **503** for it instead. Only do this if PyJWT raises that exact class/message path; read the installed `jwt/jwks_client.py`.
   - Any other exception that can escape `current_user` and cause a 500, such as `ValueError` from a malformed key. Return 503 for provider/config faults and 401 for bad tokens.
3. Run `python -m unittest discover -s tests -v` again.

## 5. Step 4: Live database init with no 500s

1. Test connectivity without printing the URL:
   ```bash
   python -c "from app.database import connection; c=connection().__enter__(); print(c.execute('select version()').fetchone()[0][:40]); print('ssl:', c.pgconn.ssl_in_use)"
   ```
2. Run `python -m app.init_db`. It should print "Application progress table is ready."
   - **Timeout or "connection refused":** Neon compute may be cold. Retry once. If it keeps
     failing, propose raising `connect_timeout` from 5 to 10–15 in `database.py`. A cold start can exceed 5s.
   - **`channel_binding` / SSL errors:** report the psycopg/libpq version (`python -c "import psycopg;print(psycopg.__version__, psycopg.pq.version())"`).
   - **Permission / pooler errors on DDL:** AGENTS.md says init should use the **direct**
     (non-`-pooler`) URL. Tell me to run init with the direct URL. You can do it as a one-off with
     `DATABASE_URL=... python -m app.init_db` typed by me, not by you.
3. Verify the table exists:
   `python -c "from app.database import connection;c=connection().__enter__();print(c.execute(\"select to_regclass('public.user_progress')\").fetchone())"`
4. Confirm every DB failure path in the **API** is a 503, never a 500. Use the existing unit
   test and also check by hand: start uvicorn with a deliberately bad `DATABASE_URL` env
   override (not by editing `.env`, e.g. `DATABASE_URL=postgresql://x@127.0.0.1:1/x uvicorn app.main:app --port 8001`),
   send `PUT /api/me/progress/lantern-harbor` with a valid token, and expect 503.

## 6. Step 5: Run the smoke test

```bash
cd backend && uvicorn app.main:app --port 8000      # restart it after any .env change
python backend/scripts/smoke_api.py                 # from repo root, in another terminal
```
- Without a token: no-token auth checks should now show **401 (auth rejected)**, not 503,
  because Neon Auth is configured. A 503 means `NEON_AUTH_BASE_URL` isn't being loaded.
- **With a token**, to test the live DB round-trip:
  1. I run the frontend (`cd frontend && npm run dev`) on http://localhost:3000 and sign in.
  2. I open DevTools → Network, click **Verify API session**, and copy the `Authorization: Bearer …` value from the `/api/me` request.
  3. I run `TRUEFAN_TEST_JWT='<token>' python backend/scripts/smoke_api.py`.
  
  Give me these exact steps. Don't try to obtain a token yourself, and never echo it.
  Expected results: `GET /api/me` 200, `PUT progress {"unit":2}` 200, `GET progress` returns it, and `{"unit":99}` returns 422.

For every FAIL, classify it as **Bug** (fix the code + add a test), **Config** (tell me the
exact `.env` / Neon Console change), or **Expected-by-contract** (the check itself is wrong; fix the
script only with a clear justification). Re-run until `ALL CHECKS PASSED`.

---

## 7. Final report

1. Smoke output summary (PASS/FAIL counts), with no-token and with-token runs if available
2. JWKS root cause: what URL was wrong (host/path only) or confirmation it's healthy
3. `init_db` result plus the `to_regclass` output
4. Each issue found: Bug / Config / Expected, plus the fix
5. Files changed plus `git diff --stat`
6. Commands for **me** to run (do not run them):
   ```bash
   cd backend && python -m unittest discover -s tests -v
   python backend/scripts/smoke_api.py
   git status && git diff
   git add backend/app/auth.py backend/app/database.py backend/tests/ backend/scripts/smoke_api.py
   git commit -m "<suggested message>"
   git push origin spine/api-core
   ```
   Adjust the `git add` list to what actually changed, and **never** include `backend/.env`.
   Confirm `.env` is git-ignored with `git check-ignore backend/.env`.

**Do not commit or push. Stop after the report.**
