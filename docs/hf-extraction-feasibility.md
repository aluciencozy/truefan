# UBW relationship-extraction feasibility

**Test date: 2026-10-10 UTC. Recommendation: useful as a reviewed drafting aid,
not ready to generate and publish spoiler-safe graphs at runtime. Curated Fate
data is still needed.**

We tested the prologue and numbered episodes 1–5 individually, first with a small
instruction model and then with a larger comparison model. **Twelve real Hugging
Face Inference Providers requests completed** using the existing server-side
`HF_TOKEN`. No production integration, graph publication, database writes, UI
changes, or user-data changes occurred.

The small model yielded **3 retained relationships from 7 proposals**; the larger
model yielded **5 from 20** after schema validation, lexical grounding, and agent
review. These are source-supported candidates, not verified canon or confirmed
spoiler-safe facts. Better coverage from a larger model did not remove errors.

## Sources and numbering

Fresh AniList search confirmed the **2014 TV adaptation**, AniList **19603**, MAL
**22297**, with 13 listed episodes. Kitsu title/year/TV checks and external mappings
resolved **7882**, with 12 numbered episodes. Its mappings also connect TVDB
**278626 / season 1** to TVmaze show **1946**.

Kitsu's separately listed **Prologue**, anime **9718**, has the exact prologue title,
2014-10-05 start date, one episode, and MAL mapping **27821**. An AniList lookup by
that MAL ID returned **HTTP 404**: no separate prologue AniList ID was resolved.
Do not invent an ID or treat that lookup as a network failure. AniList's 13-unit
count and the provider catalogs support treating the prologue separately within
this experiment; production progress conventions still need an explicit mapping.

Kitsu episode **148847** is numbered **1 within the prologue entry**, with null
description, synopsis, title, season, and airdate. We did **not** substitute the
anime-level synopsis: that has a different scope. TVmaze's null-numbered season-1
special **2632937** matches the full prologue title and 2014-10-04 premiere date,
and provides the fallback text. The one-day catalog date difference is recorded.

| Experiment unit | Broadcast episode | Kitsu anime / episode | Actual text source | Characters in normalized text |
| --- | --- | --- | --- | --- |
| 1 | 0, prologue | 9718 / 148847, provider episode 1 | TVmaze 2632937 | 287 |
| 2 | 1 | 7882 / 172701 | Kitsu | 494 |
| 3 | 2 | 7882 / 172702 | Kitsu | 395 |
| 4 | 3 | 7882 / 172703 | Kitsu | 314 |
| 5 | 4 | 7882 / 172704 | Kitsu | 364 |
| 6 | 5 | 7882 / 172705 | Kitsu | 282 |

Kitsu supplied **5/6 nonempty episode descriptions**; the matched TVmaze fallback
raised text availability to **6/6**. All six Kitsu individual resources and the
TVmaze individual resource returned HTTP 200 with matching resource IDs and
numbering; Kitsu's included `media` relationship confirmed episode ownership.
The fallback is weak: it names Rin but no second specific character, and includes
commentary about episodes 1 and 2. Its text is not a confirmed spoiler boundary.

Endpoints used:

- `POST https://graphql.anilist.co`: title/year/format search and prologue MAL lookup.
- `GET https://kitsu.app/api/edge/anime?filter[text]=Fate/stay night: Unlimited Blade Works&page[limit]=20` (URL encoded).
- `GET https://kitsu.app/api/edge/anime/{7882,9718}/mappings?page[limit]=20`.
- `GET https://kitsu.app/api/edge/anime/{7882,9718}/episodes?page[limit]=20`.
- `GET https://kitsu.app/api/edge/episodes/{148847,172701,172702,172703,172704,172705}?include=media`.
- `GET https://api.tvmaze.com/lookup/shows?thetvdb=278626`.
- `GET https://api.tvmaze.com/shows/1946/episodes?specials=1`.
- `GET https://api.tvmaze.com/episodes/2632937`.
- `GET https://router.huggingface.co/v1/models`: live model/provider/pricing catalog.
- `POST https://router.huggingface.co/v1/chat/completions`: extraction.

Each final run logged 17 source requests: 16 HTTP 200 and the expected prologue
AniList 404. No source retries, 429s, or 5xx responses occurred in those runs.
Earlier diagnostics included a direct Kitsu URL returning 403 and incorrect
special-title matching; the final probe uses JSON:API negotiation, scoped listing
URLs, and the full verified special title. Missing text, absent catalog entries,
request failures, and alignment failures remain different states.

## Models and method

- [Qwen3-4B-Instruct-2507](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507),
  **Apache 2.0**, through `nscale`; initial small open-source instruction model.
- [Qwen2.5-72B-Instruct](https://huggingface.co/Qwen/Qwen2.5-72B-Instruct), through
  `deepinfra`; additional open-weight comparison, **custom Qwen license**, not
  Apache 2.0. It is not a drop-in licensing equivalent to the first model.

The prompt, schema, temperature 0, 2,000-token completion cap, and individual
source descriptions were identical across models. Source hashes matched across
both runs. No prior episodes, franchise facts, character directory, or model
background knowledge were supplied as evidence. Each episode had a separate call.
We instructed models to omit unnamed people, preserve uncertainty/direction,
quote exact evidence, avoid invented factions, and produce short descriptions and
labels. An instruction cannot guarantee that the model obeys it.

The [standalone script](../backend/scripts/hf_extraction_feasibility.py) reuses the
previous probe's throttled/retrying public-source client, matching, pagination,
and HTML normalization. Inference has a 60-second socket timeout and **no automatic
paid retries**. An inference failure stops the run and saves partial results.
Pydantic rejects extra fields, unknown kinds/types, wrong episode keys, descriptions
over 25 words or multiple sentences, long labels, and malformed JSON. An invalid
episode output is rejected as a whole. All 12 responses were valid JSON and
completed with `finish_reason=stop`; **one larger-model episode failed the stricter
Pydantic description constraint**.

Lexical checks reject absent names, non-verbatim evidence, self-edges, or edges
whose endpoints failed entity grounding. Passing these checks only creates a
pending candidate. It does not prove that a quote entails the description, that
an entity is a faction, or that a predicate has the right direction.

A separate agent review compared every proposed assertion with the complete
supplied source text, rejected unsupported meanings/types/directions, and recorded
reasons without silently correcting output. This is not expert anime annotation,
independent human verification, or episode viewing. Descriptive fragments and
short evidence spans also limit profile usefulness.

## Measured accuracy and useful output

Here, a **source-supported typed claim** means its predicate and direction follow
the complete description, irrespective of whether its proposed quote was exact.
A **retained relationship** must additionally survive episode schema validation,
lexical evidence checks, endpoint grounding, and semantic review. These two
measurements separate plausible claims with bad evidence from usable candidates.
Counts include repeated attack assertions, not only distinct permanent relations.

| Measure | Qwen3 4B / nscale | Qwen2.5 72B / deepinfra |
| --- | --- | --- |
| JSON responses / calls | 6/6 | 6/6 |
| Episodes passing Pydantic | 6/6 | 5/6 |
| Relationship proposals before rejection | 7 | 20 |
| Source-supported typed claims | 3/7 (42.9%) | 7/20 (35.0%) |
| Relationships surviving schema + lexical checks | 6 | 11 |
| Relationships retained after review | 3 | 5 |
| Retained fraction of all proposals | 42.9% | 25.0% |
| Confirmed spoiler-safe relationships | **0 assessed** | **0 assessed** |

This is proposal precision under the stated review rubric, **not recall**, universal
model accuracy, or a verified spoiler-safety rate. We did not create an exhaustive
expert gold graph. Larger-model claims can be source-supported yet rejected for
invented quotations or invalid endpoint extraction. The entire larger-model
episode 4 failed validation; its six edges were not salvaged or published.

| Episode | 4B proposals / retained | 72B proposals / retained |
| --- | --- | --- |
| Prologue | 0 / 0 | 1 / 0 |
| 1 | 3 / 2 | 4 / 2 |
| 2 | 2 / 0 | 4 / 1 |
| 3 | 0 / 0 | 3 / 0 |
| 4 | 0 / 0 | 6 / 0 |
| 5 | 2 / 1 | 2 / 2 |

Brief paraphrases of useful retained candidates, scoped to the source episode:

- Episode 1: Lancer attacks Shirou; Rin revives Shirou. Both models retained these.
- Episode 2: Shirou accompanies Rin to the church. Retained in the larger run.
- Episode 5: Rin attacks Shirou, followed by a temporary truce. Both models found
  the truce; only the larger run correctly typed the attack.

**Errors and missing information:**

- Both models reversed the episode-1 rescue: `Shirou → Kiritsugu / rescues`, even
  though the label said “saved by.” Canonical edge direction cannot follow the label.
- The small model used `commands` for accompanying someone, and `truce` for being
  told information and for an attack. The larger model used `hosts` for being
  blocked/overwhelmed and `attacks` for staying at a house or inferring involvement.
- The larger model invented an attack on Rin and described Lancer as attacking the
  estate; episode 2 does not state either. It also added “main character” status.
- Generic warriors, an unnamed student, a Servant role, and the Holy Grail Wars
  event were incorrectly turned into named characters/factions. **No verified
  named faction was established by this experiment.**
- Several evidence strings were paraphrases presented as exact quotations.
  Lexical validation rejected them and their dependent edges.
- The small model's Caster description lost Rin's perspective. A character's
  inference should not become an unconditional fact.
- Important source-supported actions were missed: Kiritsugu's correctly directed
  rescue, Kirei informing Shirou with valid evidence, and episode-4 school/house
  interactions. Episode 3 yielded no retained edges despite named encounters.
- Aliases differ: `Rin Tohsaka` versus `Rin`, `Shirou Emiya` versus `Shirou`.
  We did not automatically merge identities across episodes or continuities.
- Some descriptions were copied fragments rather than useful short sentences;
  the larger model exceeded the word limit in episode 4. Valid JSON is not a
  guarantee of readable, useful character profiles.

The enum includes `other`, but models still forced incompatible types. Definitions
and explicit actor-to-recipient examples are an obvious next prompt improvement;
this report does not claim that untested prompting would solve the problem.

## Latency and approximate inference cost

| Measure | 4B / nscale | 72B / deepinfra |
| --- | --- | --- |
| Prompt tokens reported | 1,489 | 1,489 |
| Completion tokens reported | 2,045 | 2,876 |
| Median per-call latency | 2.766 s | 30.815 s |
| Per-call range | 1.823–3.385 s | 8.380–52.320 s |
| Sum of six inference latencies | 16.155 s | 174.741 s |
| Input / output USD per million tokens, catalog snapshot | $0.01 / $0.03 | $0.36 / $0.40 |
| Estimated six-call inference cost | $0.00007624 | $0.00168644 |

Estimated total: **$0.00176268**, calculated from response `usage` and the live
router catalog's provider prices. This includes rejected completions. It is an
estimate, not an invoice or account-credit measurement; token accounting is what
the providers reported, not independently tokenized. See [HF pricing](https://huggingface.co/docs/inference-providers/pricing)
and [the provider model catalog](https://router.huggingface.co/v1/models).

The completed runs lasted 50.24 s and 208.61 s including source lookups/throttling.
The 4B run was `06:25:49.751–06:26:39.994 UTC`; the 72B run was
`06:27:11.311–06:30:39.922 UTC`. These sequential observations are not a load test.
No inference retries or network failures occurred. The larger-model run returns
nonzero because episode 4 was rejected, while still saving all six responses.

## Candidate artifact and reproduction

[Reviewable JSON](data/ubw-extraction-candidates.json) contains both models' candidates,
source IDs/URLs/hashes, support episode/unit, usage/latency, rejection reasons, and
explicitly null confirmed reveal timing. **Every fact remains `verified: false`.**
Evidence uses Unicode character offsets into normalized text and hashes instead
of committing raw episode descriptions. An absent exact quote has null offsets.
The artifact preserves original edge meanings; rejected predicates were not repaired.

Full source responses and model output are local, uncommitted artifacts:
`/tmp/truefan-hf-extraction.json` and `/tmp/truefan-hf-extraction-72b.json`.
The checked-in JSON is the separately reviewed snapshot, not automatically
rewritten or published by the script. Later runs may differ with model/provider changes.

```bash
cd backend
.venv/bin/python -m scripts.hf_extraction_feasibility --output /tmp/truefan-hf-extraction.json
.venv/bin/python -m scripts.hf_extraction_feasibility --model Qwen/Qwen2.5-72B-Instruct:deepinfra --output /tmp/truefan-hf-extraction-72b.json
.venv/bin/python -m unittest discover -s tests
```

Public-source requests use the existing 2.1-second throttle and bounded retry/backoff.
The model receives one externally hosted episode description per request; do not
add secrets, user progress records, or private material to these prompts. Kitsu
credits these numbered descriptions to the official site; provider access does
not establish permission to redistribute full text. TVmaze's attribution/share-alike
terms still apply. Future caching/publication needs a source-rights decision; this
experiment commits short candidate claims and evidence references, not full summaries.

## Decision and remaining scope

**Kitsu + Hugging Face can draft sparse, useful candidate interactions, but this
experiment does not justify automatic spoiler-safe runtime graph publication.**
Cost was tiny; the central problems were incorrect predicates/direction, missing
relationships, weak identity modeling, and unverified reveal boundaries. TVmaze
filled the prologue text gap but supplied no retained named relationship there.
It is a metadata/text fallback, not automatic independent confirmation.

Use curated Fate data for the polished demonstration, including verified episode
boundaries, prologue mapping, canonical identities within the work, evolving
relationships, and concise descriptions. If a later phase explores extraction,
start with reviewed candidates, explicitly defined relation semantics, a small
annotated evaluation set, and separate source support from verified reveal timing.
Keep unavailable graphs honest and let franchise exploration/progress work independently.
Any future ingestion should be bounded and cached, rather than invoked on every
hover or automatically exposing model output to users.

`first_supported_episode` means the earliest supporting description **in this
sample with these exact identifiers**; it does not prove when the viewer first
learns the fact. Experiment units 1–6 distinguish prologue 0 from numbered 1–5.
Confirmed spoiler-safe reveal timing remains null. We did not watch episodes,
measure complete graph recall, test other anime, perform expert review, or implement
production persistence/extraction. Those limits prevent a stronger safety claim.

Validation: **30 backend tests**, frontend typecheck/build, and the existing auth
API regression test passed. Build retains existing large-chunk and dependency
annotation warnings. No live Neon login or deployment validation was performed.
