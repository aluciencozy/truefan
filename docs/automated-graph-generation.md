# Automated experimental character graphs

The running application now uses AniList discovery, Kitsu episode descriptions,
TVmaze fallback, configurable Hugging Face inference, and shared Neon caching.
It does not import the offline feasibility candidate files or require moderation.

## Configuration and deployment

Keep existing Auth, CORS, DATABASE_URL and VITE_API_URL configuration. Apply
`backend/app/schema.sql` with `python -m app.init_db`, using a direct Neon connection
for setup. The setup is additive/idempotent; existing user_progress rows are preserved.
Set these server-only Railway/local variables and redeploy the backend normally:

| Variable | Default | Meaning |
| --- | --- | --- |
| HF_TOKEN | required | Existing HF Inference Providers credential |
| HF_MODEL | Qwen/Qwen3-4B-Instruct-2507:nscale | Model ID and optional provider suffix |
| HF_RESPONSE_FORMAT | schema | `schema`, `json`, or `prompt` for provider compatibility |
| GENERATION_EPISODE_CAP | 6 | Initial story units; 1–24, prologue counts as one |
| GENERATION_JOBS_PER_USER | 3 | Accepted generation requests per verified user per rolling day |
| GENERATION_GLOBAL_DAILY_LIMIT | 20 | Accepted generation requests across users per rolling day |
| GENERATION_MAX_CONCURRENT | 2 | Shared database-wide active jobs; 1–4 |
| GENERATION_LEASE_SECONDS | 180 | Renewable worker lease; 120–600 |
| GENERATION_ADMIN_SUBJECT | empty | Verified JWT sub allowed to request refresh |
| UNIVERSE_NODE_CAP | 25 | Maximum discovered nodes; 1–50 |
| UNIVERSE_DEPTH | 1 | Relation traversal depth; 0–2 |

Nothing adds a frontend secret or changes hosting configuration. HF_MODEL selection
is centralized in settings; routes, graph logic and frontend contain no model choice.
Structured JSON is the default. A different compatible instruction model can use
JSON mode or prompt-only output; all modes use the same Pydantic/grounding checks.
Requests can consume credits. Completed episode outputs retain their original model
ID when later extension/retry runs use a different configured model.

## API and browser flow

- `GET /api/media/search?q=...`: existing Media contract extended with AniList IDs,
  covers, format and prologue flag; empty search keeps the fictional demo available.
- `GET /api/media/{id}`: neutral metadata; IDs use `anilist-{numeric-id}`.
- `GET /api/media/{id}/universe`: `root_id`, `media`, typed media relationships,
  and `truncated`. Bounded breadth-first traversal follows actual AniList relations.
  It does not invent continuity corrections or turn alternate routes into sequels.
- `GET /api/media/{id}/graph?progress=N`: existing backend-filtered graph, plus
  `experimental` and `generation`. A missing cache returns an empty graph with
  `not_generated`; GET never causes inference or a user-progress write.
- `GET /api/media/{id}/generation`: status, processed count, supported story units,
  cap, generic error and timestamp; no raw episode text, tokens or future graph facts.
- `POST /api/media/{id}/generation`: verified Neon bearer JWT required, returns 202.
  JSON `operation` is `start` (default), `retry`, `extend`, or `refresh`.
- Existing `/api/me/progress/{id}` GET/PUT now accept selected AniList works; verified
  JWT sub still owns each user's independent progress. Account Save/Retrieve controls
  remain available. Saved progress is not automatically written by generation.
- Legacy `/api/extract` and `/api/ask` remain demo-only 501 placeholders. Generation
  uses the media-scoped endpoint, rather than accepting client-provided summaries.

Searching opens the universe view; clicking a work opens its character graph.
If uncached, the frontend attempts authenticated generation once, then polls every
three seconds while a job is queued/retrieving/generating. Guests can inspect cached
results and are prompted to sign in for new graphs. Generate/Retry controls allow
retrying after sign-in or provider errors. Polling is cancelled on navigation or
progress changes; no inference is triggered by changing progress or reloading a
cached work. The frontend displays partial coverage and experimental warnings.

AniList discovery is capped and reports truncation honestly. Relation labels are
metadata connections, not a prescribed watch order or authoritative continuity map.
Media-level plot synopses are intentionally excluded. Manga relation nodes can be
explored as metadata, but automated story extraction currently supports anime only.
Unknown episode totals use a one-unit metadata fallback; series with incomplete
catalog totals need additional progress mapping before larger ingestion.

## Providers, numbering and extraction

Kitsu searches are scoped by format/year and verified against AniList/MAL mappings.
Conflicting IDs or ambiguous matches fail instead of taking the first title result.
Collections paginate with cycle/host validation and a ten-page bound. Requests use
JSON:API negotiation, a descriptive user agent, a 2.1-second Kitsu throttle, timeouts,
and bounded backoff for public-provider requests. TVmaze fallback requires an exact
TVDB series and season mapping and Animation type; there is no guessed title fallback.

UBW AniList 19603 maps to Kitsu 7882, numbered episodes 1–12. Its prologue uses the
separate Kitsu 9718/MAL 27821 mapping and episode resource; TVmaze supplies a matched
null-numbered prologue when Kitsu text is absent. **Story unit 0 means not started,
unit 1 means prologue completed, and unit 2 means numbered episode 1 completed.**
Other anime use their numbered episode as the story unit. No game milestone or film
progress normalization is implemented beyond the existing generic contracts.

Episodes are processed separately and chronologically. Only the selected episode's
text reaches inference; future descriptions and prior model knowledge are not supplied
as context. Empty/very short descriptions are skipped. Inference has a timeout and
no automatic paid retries because a timed-out request may already have completed.
Invalid records are rejected individually while valid records survive. A malformed
episode envelope does not crash the entire job; errors are checkpointed. Partial
record failures are recorded and can be retried without removing successful episodes.

The adapter handles optional aliases, single fenced JSON blocks, repeated arrow
notation in endpoints, and one-word labels expanded with a named recipient. Missing
named endpoint nodes can use a minimal source-grounded mention description, only
when the endpoint name is explicitly present; no relationship is invented to fill gaps.
Output permits characters, explicit aliases, concise descriptions and relationships,
including empty lists. Source checks reject nonexistent names, invented evidence,
invalid endpoints, obvious role/event-as-character mistakes, certain incompatible
predicate types, and the observed reversed passive rescue direction. Short aliases
are deduplicated when they match one existing full name; ambiguous matches remain
separate. Relationship deduplication retains the earliest identical directed type.
These heuristics are intentionally limited and can still make mistakes.

## Storage, jobs and filtering

Two additive tables reuse existing psycopg connections:

- `generated_graphs`: one shared row per media; neutral metadata, published and
  working JSONB episode snapshots, model, cap, status, requesting subject, fenced
  lease token/expiry, restart attempts, generic errors and timestamps.
- `graph_generation_requests`: rolling quota ledger with verified subject/media
  and timestamp. It contains no tokens or user viewing-progress values.

The JSONB documents hold episode identifiers/titles/URLs/source hashes, short model
claims/evidence, episode support units and model IDs; no full description bodies are
persisted or sent in graph responses. Facts always carry `verified=false`. Existing
`user_progress` remains independent and user-owned. One generated graph serves all users.

FastAPI lifespan starts a small bounded worker set. Queuing/claiming uses short
transaction advisory locks and atomic row selection, so duplicate requests do not
create overlapping jobs. Workers renew leases every 30 seconds and checkpoint every
episode. All writes are fenced by the current lease token and unexpired lease; a stale
worker cannot overwrite a resumed job. After a Railway restart, queued/expired jobs
resume, re-fetch source descriptions and skip fully successful checkpoints. Three interrupted
claims exhaust automatic recovery; an authenticated retry resets the restart budget.
A crash between a paid response and its checkpoint can repeat that single inference;
exactly-once external billing is not promised.

`start` on an existing graph is idempotent and free of new inference. `retry` retries
failed/unavailable episodes while keeping successful snapshots; daily quotas still
apply. Increase the cap and request `extend` to process additional units without
removing previous facts. Existing graphs do not automatically extend when a slider
moves. `refresh` is restricted to GENERATION_ADMIN_SUBJECT and stages replacements;
a failed/incomplete refresh keeps the old published graph. A successful capped refresh
can replace it when every selected episode validates. There is no anonymous or
client-selected-model regeneration endpoint.

Partial results are published incrementally. Final states are ready, partial, empty
or failed; a cap below the media total produces partial even if all selected episodes
succeed. Supported units list actual successfully analyzed episodes, including gaps.
It does not assert that later episodes have been examined or that a relationship
exists in every analyzed episode.

All reveal comparisons remain in `services/graph.py`. Entities keep episode-specific
name/description/provenance snapshots; filtering selects the latest snapshot at or
before requested progress. Edges require their support unit and both visible endpoints.
This avoids future profile descriptions leaking when users rewind. Future episode
provenance/evidence is not returned merely because a character appeared earlier.
Relationships are historical assertions, not a fully reconciled current alliance model.

## Accuracy, source rights and limits

Experimental labels are mandatory. Source-derived support units are approximate
boundaries, not guaranteed first reveals. Synopsis authors and models can include
spoilers or unsupported interpretations even with these checks. Aliases, uncertain
beliefs, temporal changes, direction and class/identity distinctions remain imperfect.
The feature automatically serves unverified results, as authorized for this prototype;
it does not import reviewed Fate fixtures or require a moderation workflow.

Kitsu source credits and TVmaze resource links are retained. API access does not establish
redistribution rights. The app stores concise generated claims and brief evidence;
full descriptions remain transient. A broader public deployment still needs a rights
review of underlying descriptions and TVmaze attribution/share-alike requirements.

The synchronous provider/worker implementation is appropriate to the bounded hackathon
server; workers poll every five seconds while enabled. No external queue is required.
The quota ledger grows with accepted requests; retention cleanup is deferred. Process
restart recovery needs an always-running backend with the new schema and HF_TOKEN.
No generation occurs when storage/token is unconfigured; demo functionality still works.

## Verification performed

The configured Neon database received the additive tables after testing the schema
in an isolated namespace and rolling it back. Existing progress rows were not changed.
Real Postgres lifecycle tests also used separate temporary schemas that were removed.
Neon management credentials were unavailable, so this was schema isolation, not a
Neon branch-clone test. The schema changes are only new tables/indexes.

A real automatic UBW run retrieved the prologue plus episodes 1–5, called HF, and
persisted the results. The first run exposed one-word labels causing whole-episode
rejection; per-record validation and adapter normalization corrected that failure.
Retry reused successful checkpoints. The resulting cache has **7 visible characters
and 8 relationships through the capped range**, with one failed episode (story unit 4,
numbered episode 3). At numbered episode 1 (story unit 2) it returns **4 characters and
3 relationships**. Progress 0 returns none. A second service caller reused the document
without enqueueing another job. These counts are not an accuracy evaluation.

The service-level smoke callers used synthetic test subjects, not real signed-in
Google users; no claim is made that this proves live Neon login. API tests verify the
costly endpoint rejects unauthenticated requests and derives identity from its verified
dependency. Existing auth regression tests remain passing.

Fifty backend tests passed, including real Postgres concurrency/quota/fencing/refresh
checks. Frontend typecheck, build and auth API regression passed. Local browser checks
cover live AniList search, dynamic universe navigation and cached character rendering
at episode 1. Selecting Not started clears the graph.
Existing large-bundle/dependency annotation warnings remain. Vercel/Railway deployment
was not pushed; the new application code still needs the normal deployment workflow.
