# Jikan episode-data feasibility

**Investigation date: 2026-10-10 UTC. Outcome: inconclusive because live data access failed.**

The reproducible probe is implemented, but the planned 25-episode quality study
has not been completed. No episode synopsis was retrieved or reviewed. These
results establish an environment connectivity limitation, not missing Jikan data
or poor coverage. Do not begin automatic publication or AI extraction on this evidence.

## What was checked

The [official REST v4 documentation](https://docs.api.jikan.moe/) and
[published OpenAPI specification](https://raw.githubusercontent.com/jikan-me/jikan-rest/master/storage/api-docs/api-docs.json)
were accessible through the research tool. The specification documents:

- `GET /anime/{id}` for confirming the selected MAL entry.
- `GET /anime/{id}/episodes?page=N` for paginated episode metadata. The listing
  schema does not include episode synopses.
- `GET /anime/{id}/episodes/{episode}` for individual episode details, including
  an integer `mal_id`, a title, and a nullable synopsis.
- `GET /anime/{id}/characters` for a work's cast, not episode-specific introductions.

Documented limits are 60 requests/minute and 3 requests/second. The specification
describes a 24-hour cache and cache-related response headers. It also warns that
MAL can independently rate-limit Jikan. These are documented behaviors, not
confirmed observations of live episode responses in this investigation.

The [AniList Media contract](https://docs.anilist.co/reference/object/media)
exposes nullable `idMal`. The probe checks title, year, and TV format before
accepting a mapping, then verifies the corresponding Jikan metadata. An
unavailable mapping is an unresolved entry, not permission to guess an ID.

## Series and sampling method

| Requested series | AniList search title / year | Planned distinct samples | Actual result |
| --- | --- | --- | --- |
| UBW, first 2014 TV part | Fate/stay night: Unlimited Blade Works / 2014 | First, second, middle, penultimate, final | Mapping obtained; Jikan confirmation blocked |
| Attack on Titan, season 1 | Shingeki no Kyojin / 2013 | Same five positions | Mapping obtained; Jikan confirmation blocked |
| Steins;Gate | Steins;Gate / 2011 | Same five positions | Mapping obtained; Jikan confirmation blocked |
| Death Note | Death Note / 2006 | Same five positions | Mapping obtained; Jikan confirmation blocked |
| Odd Taxi | Odd Taxi / 2021 | Same five positions | Mapping obtained; Jikan confirmation blocked |

The broader-network run obtained these live AniList mappings. Episode totals
are AniList metadata, not confirmed Jikan episode listings:

| Series | AniList ID | `idMal` | AniList episodes | AniList popularity |
| --- | --- | --- | --- | --- |
| UBW, first TV part | 19603 | 22297 | 13 | 267335 |
| Attack on Titan, season 1 | 16498 | 16498 | 25 | 1064069 |
| Steins;Gate | 9253 | 9253 | 24 | 599987 |
| Death Note | 1535 | 1535 | 37 | 970191 |
| Odd Taxi | 128547 | 46102 | 13 | 151945 |

Odd Taxi has the lowest recorded popularity among these samples and serves as
the smaller-title comparator. Jikan-side confirmation of these mappings and
exact episode counts, sample numbers, and titles remain incomplete.

Sampling uses sorted, distinct episode IDs from the complete listing. The middle
position is the lower middle for an even-sized list. Listings are capped at 20
pages; exceeding that cap produces an error instead of a truncated sample. Each
series must have at least five distinct episodes. The first sample is requested
again to compare its identity, title, and synopsis; repeats are excluded from coverage.

### UBW numbering caveat

[AniList's first TV entry](https://anilist.co/anime/19603) explicitly includes the
prologue and lists it as episode 0. Its [second TV part](https://anilist.co/anime/20792)
is a separate entry. The live second-part result maps AniList `20792` to MAL
`28701`, with year 2015 and 13 episodes. This does not establish how Jikan/MAL numbers those releases.
The probe separately resolves the second TV part for context, without sampling
it or merging it into the 2014 study. Do not apply a guessed episode offset or
equate an API episode ID with TrueFan's completed-unit count.

## Observed requests and evidence

The initial broader-network run ran from
`2026-10-10T05:45:33.501572+00:00` to
`2026-10-10T05:51:16.720573+00:00`, writing
`/tmp/truefan-jikan-results.json`. Seven AniList requests returned HTTP 200,
resolving the five study entries and the second TV part. An additional query
for a separate SPECIAL-format prologue did not yield a matching entry; the
current script removes that assumption and documents AniList's included prologue.

Five Jikan confirmation requests exhausted three attempts each, all reporting
`Network is unreachable`, with no HTTP status:

- `GET https://api.jikan.moe/v4/anime/22297`
- `GET https://api.jikan.moe/v4/anime/16498`
- `GET https://api.jikan.moe/v4/anime/9253`
- `GET https://api.jikan.moe/v4/anime/1535`
- `GET https://api.jikan.moe/v4/anime/46102`

This run made 12 logical requests and 22 attempts (7 AniList successes and 15
Jikan network failures). Its preliminary console metrics showed zero planned
sample yield; the current script reports unattempted episode fetch rates as
undefined and gives clearer Jikan confirmation errors. Neither version turns
unretrieved text into evidence of missing summaries.

The restricted-network run used:

```bash
cd backend
.venv/bin/python scripts/jikan_feasibility.py --output /tmp/truefan-jikan-results-local.json
```

It ran from `2026-10-10T05:48:02.487203+00:00` to
`2026-10-10T05:48:49.599729+00:00`. Six logical requests to
`POST https://graphql.anilist.co` used the five search titles above and the
second-part UBW title. Each exhausted three attempts: **18 failed attempts**,
all reporting temporary DNS resolution failure. No HTTP status was obtained.
Consequently, the probe did not reach the MAL confirmation, episode-list,
individual-episode, character-catalog, or repeat checks.

A final restricted-network run of the script's explicit incomplete-outcome
handling ran from `2026-10-10T05:50:20.732212+00:00` to
`2026-10-10T05:51:07.843281+00:00`. It again recorded six logical AniList requests
and 18 DNS failures, wrote `/tmp/truefan-jikan-results-final.json`, and exited 1
with `outcome: incomplete`. The later clearer-error change is covered by the
synthetic successful and blocked-Jikan workflow test.

A separate connectivity diagnostic requested
`GET https://api.jikan.moe/v4/anime/28701/episodes/1` with broader network access
and failed with `Network is unreachable`. The numeric ID in this diagnostic was
not independently confirmed; this request is excluded from the study. The
research tool also failed to retrieve that URL and
`https://api.jikan.moe/v4/anime/16498/episodes/1`. Neither failure supplies synopsis
evidence or verifies those IDs.

Raw results are local files under `/tmp`, not version-controlled artifacts. They
contain request timestamps, attempts, errors, and, on successful runs, provider
responses and normalized text. The script emits only metrics and errors to the
console. Its current version exits 1 after saving an incomplete investigation;
successful retrieval means ready for manual review, not verified story safety.

## Coverage and quality results

| Measure | Observed result |
| --- | --- |
| Planned distinct episode samples | 25 |
| Attempted study episode requests | 0 |
| Successful study episode responses | 0 |
| Fetch-success percentage | Not measurable: no study episode requests |
| Nonempty synopses / successful episode responses | Not measurable: denominator is zero |
| Nonempty synopsis yield / 25 planned samples | 0/25 retrieved; **not a missing-synopsis rate** |
| Median and range of synopsis lengths | Not measurable |
| Named characters, events, or supported relationship examples | Not assessed; no source text retrieved |
| Repeated-response consistency | Not tested |
| Episode safety | Unassessed for all five series |
| Observed 429s or provider 5xx responses | None observed; no study HTTP responses |

No extractable-fact examples are supplied because doing so would invent evidence.
Likewise, no claim about universal coverage or primary-source suitability follows
from this run.

## Reproduction and manual assessment

Run from a machine that can reach both public APIs:

```bash
cd backend
.venv/bin/python scripts/jikan_feasibility.py --output /tmp/truefan-jikan-results.json
.venv/bin/python -m unittest discover -s tests
```

The script uses standard-library HTTP tools and the existing Pydantic dependency.
Requests are sequential, spaced by at least 2.1 seconds, use a 20-second socket
timeout, and have at most three attempts. Network failures, 429s, and 5xx responses
are retried. `Retry-After` is honored in seconds or HTTP-date form; otherwise
retry delays are two and four seconds. The timeout is per socket operation,
not a guaranteed whole-run deadline. Outputs inside the repository are rejected.

For each successful sample, inspect its text locally and record:

- Missing, null, blank, or nonempty synopsis; missing or inconsistent titles/IDs.
- Character and word counts. Fewer than 30 words is flagged for inspection,
  not automatically classified as useless.
- Explicit character names, events, interactions, and whether a paraphrased
  relationship assertion is supported by that episode's text.
- Whether an episode-level reference corroborates the asserted fact and its
  boundary. Without that comparison, mark spoiler safety **unassessed**.

Report per-series and aggregate denominators separately. HTTP 200 responses with
malformed data count as HTTP successes but not valid samples. Failed requests
must not become empty synopses. A useful-source yield requires human assessment;
the script only calculates retrieval and nonempty-text metrics. Preserve distinct
requests and repeats when assessing reliability; immediate repeat agreement can
reflect the documented cache rather than independent upstream observations.

## Risks and recommendation

**Recommendation: rerun the probe on a connected machine before choosing Jikan
as an extraction source.** The source decision remains inconclusive. If the
next run provides meaningful episode text, try a small reviewed extraction
experiment; it still will not establish universal coverage or safe automatic
publication.

Episode prose may omit relationships, disclose later identities, use aliases,
or summarize events imprecisely. A cast list cannot determine a reveal point.
The earliest support found in sampled summaries is not necessarily the first
actual story reveal. These are risks to investigate, not observations about
unretrieved samples.

Keep the universe graph independent of story-data availability. For unsupported
works, offer neutral, reviewed discovery metadata and progress tracking, show
that the story graph is unavailable, and use reviewed seeds or permitted manual
summaries when available. Do not fall back to full-story biographies, model
background knowledge, or guessed relationships.

Retain provider URLs, episode identities, timestamps, and review status for any
future extracted assertion. Read [Jikan's terms](https://jikan.moe/terms) and the
underlying source's reuse conditions before retaining or redistributing text;
the terms page was unavailable during this investigation. The API software's
license does not establish rights to episode prose. This report commits no raw
copyrighted episode text. Future extraction must keep relationship endpoints
separate from provenance fields, validate typed output, and withhold unreviewed
facts from the public graph.

## Engineering changes and validation

- Added `backend/scripts/jikan_feasibility.py`, separate from production services.
- Added `backend/tests/test_jikan_feasibility.py` with synthetic text only.
- Updated README with the reproduction command and this report.
- No new dependencies, database migrations, production API changes, or AI calls.
- Existing frontend typecheck/build and auth regression check pass. All 16 backend
  tests pass, including seven experiment tests for normalization, metrics,
  pagination, mapping rejection, retry behavior, and a synthetic five-series run.

The investigation has stopped at the feasibility boundary. Live sampling and
manual quality review remain incomplete because of connectivity; no live login
or database persistence was verified by these checks.
