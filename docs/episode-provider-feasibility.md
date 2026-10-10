# Kitsu and TVmaze episode-summary comparison

**Test date: 2026-10-10 UTC. Recommendation: Kitsu first, TVmaze as an optional
supplement, and reviewed Fate data for the demo.**

Both public APIs were reachable. We retrieved five individual episode resources
for each of five anime from each provider: **50 HTTP 200, identity-validated
episode responses**. Kitsu supplied nonempty text for **25/25 (100%)**; TVmaze
supplied it for **21/25 (84%)**. TVmaze's four missing summaries belong to UBW
and are actual JSON nulls, not network errors.

This is a small source-quality investigation, not production integration or a
proof of universal coverage. No AI extraction, database writes, or story-graph
publication occurred. Episode-level spoiler safety remains **unassessed**:
we inspected descriptions, not the underlying episodes or scripts.

## Method and reproducibility

The new standalone probe imports the HTTP client, AniList resolver, sample
selection, and coverage metrics from `jikan_feasibility.py`. It uses installed
Pydantic plus standard-library HTTP and HTML parsing; no new dependency.

```bash
cd backend
.venv/bin/python scripts/episode_provider_feasibility.py --output /tmp/truefan-episode-provider-results.json
.venv/bin/python -m unittest discover -s tests
```

Raw provider responses and normalized text are written outside the repository.
The console prints counts and availability states, not episode prose. A failed
request, malformed response, unmatched adaptation, or empty summary remain
distinct outcomes. Unknown coverage is not reported as missing text. Runs with
access, parsing, or alignment errors return a nonzero exit status after saving
results; verified absence of a match remains a reportable study result.

The main corrected run started at `2026-10-10T06:02:44.621302+00:00`. A focused
Odd Taxi TVmaze follow-up using its spaced title alias finished at
`2026-10-10T06:06:39.235229+00:00`. The combined artifact contains **86 logical
requests, all HTTP 200, with no retries, network failures, 429s, or 5xx responses**.
Coverage counts unique episode resources, excluding searches, listings, and
earlier diagnostic runs. The follow-up replaced the incomplete Odd Taxi TVmaze
result and appended its requests; the current script includes this alias handling.

Samples are the first, second, lower-middle, penultimate, and final positive
numbered episodes within the matched work/season. Specials are recorded separately.
We sampled corresponding numbered episodes across providers, not arbitrary rows
from the full franchise or all seasons of a TVmaze show.

Text metrics use whitespace-normalized plain text, HTML decoded/removed. Kitsu
uses `description`, falling back to `synopsis`; TVmaze uses `summary`. Source
credits included in text are retained in length counts. Nonempty coverage is not
a measure of useful relationship coverage.

## Matching the correct adaptations

AniList searches were verified using title, year, and TV format before accepting
the AniList ID and `idMal`. Kitsu candidates were checked using year, TV subtype,
title variants, and their external mappings. A matching title alone was insufficient;
conflicting AniList/MAL mappings were rejected.

For four works, Kitsu mappings supplied a TVDB series ID and a season hint. TVmaze
lookup returned the same TVDB external ID. Odd Taxi had no TVDB mapping in Kitsu;
its TVmaze match is weaker, corroborated by title aliases, 2021 premiere, Animation
type, Japanese language, and the five corresponding episode titles. It is not
claimed to have a verified cross-database ID chain.

| Work | AniList ID | MAL ID | Kitsu ID | TVmaze ID | TVDB series / selected TVmaze season |
| --- | --- | --- | --- | --- | --- |
| UBW, first 2014 TV part | 19603 | 22297 | 7882 | 1946 | 278626 / 1 |
| Attack on Titan, season 1 | 16498 | 16498 | 7442 | 919 | 267440 / 1 |
| Steins;Gate | 9253 | 9253 | 5646 | 2051 | 244061 / 1 |
| Death Note, 2006 animation | 1535 | 1535 | 1376 | 40 | 79481 / 1 |
| Odd Taxi, 2021 animation | 128547 | 46102 | 43932 | 53962 | 397208 returned by TVmaze; no Kitsu bridge / 1 |

Two matching pitfalls surfaced and were fixed in the experiment:

- Kitsu's paginated Attack on Titan search repeated resource `7442`. Deduplicating
  by resource ID prevents treating the same adaptation as two different matches.
  Distinct IDs with competing matches still fail rather than choosing the first.
- TVmaze search for AniList's English title `ODDTAXI` returned **RoOT**, a 2024
  live-action work, not the requested anime. Searching the romaji alias `Odd Taxi`
  found the 2021 animation. Year/type/language checks reject the live-action result.

These observations show why "take the first title search result" is unsuitable.
External-ID mappings are still provider metadata, not proof of safe story facts.

## Measured coverage and length

Each row uses five successful, validated episode responses. Medians and ranges
exclude null/empty text. Character counts are Unicode string lengths; words are
whitespace-separated tokens.

| Work | Episode numbers in both providers | Kitsu nonempty | TVmaze nonempty | Kitsu median characters (range) | TVmaze median characters (range) |
| --- | --- | --- | --- | --- | --- |
| UBW, first TV part | 1, 2, 6, 11, 12 | 5/5 | 1/5 | 420 (395–494) | 220 (220–220) |
| Attack on Titan S1 | 1, 2, 13, 24, 25 | 5/5 | 5/5 | 239 (141–243) | 266 (151–514) |
| Steins;Gate | 1, 2, 12, 23, 24 | 5/5 | 5/5 | 906 (781–939) | 145 (127–150) |
| Death Note | 1, 2, 19, 36, 37 | 5/5 | 5/5 | 128 (86–298) | 113 (89–125) |
| Odd Taxi | 1, 2, 7, 12, 13 | 5/5 | 5/5 | 169 (138–202) | 147 (116–180) |
| **Overall** | **25 distinct episodes per provider** | **25/25: 100%** | **21/25: 84%** | **241 (86–939)** | **147 (89–514)** |

| Work | Kitsu median words | TVmaze median words | Samples with an explicit character name/alias: Kitsu / TVmaze |
| --- | --- | --- | --- |
| UBW | 75 | 40 | 5/5 / 1/5 |
| Attack on Titan S1 | 41 | 49 | 3/5 / 4/5 |
| Steins;Gate | 156 | 24 | 5/5 / 5/5 |
| Death Note | 20 | 18 | 5/5 / 5/5 |
| Odd Taxi | 27 | 25 | 5/5 / 5/5 |
| **Overall explicit-name coverage** | — | — | **23/25 / 20/25** |

Explicit-name coverage comes from source-text inspection; it does not resolve
aliases into canonical identities or count unnamed groups as characters.
Kitsu's Attack on Titan samples 1 and 2 contain no explicit character names;
TVmaze sample 2 also contains none. The four null TVmaze UBW summaries contain
no names. All other sampled texts contain at least one specific character name
or alias. A single named protagonist is insufficient to build character relationships.

## Episode-number alignment

All 50 detail responses matched the resource ID, episode number, and season
metadata from their scoped listing. The selected episode titles correspond across
providers, allowing translation variations, punctuation, and added arc labels.
No offset was observed among the **sampled positive numbered episodes**. This
does not validate every unsampled episode or the timing of events within a synopsis.

- **UBW:** AniList counts 13 units in the first TV entry and includes the prologue.
  Kitsu `7882` has 12 numbered episodes and lists a separate prologue anime entry
  `9718` in search. TVmaze `1946` combines two TV seasons and specials: season 1
  has 12 numbered episodes plus a null-numbered prologue; season 2 has 13 numbered
  episodes plus a null-numbered Sunny Day special. Only season 1's numbered
  episodes were compared. These catalogs cannot share a guessed progress offset.
- **Other works:** scoped listings agree on 25 numbered AoT S1 episodes, 24
  Steins;Gate episodes, 37 Death Note episodes, and 13 Odd Taxi episodes.
  TVmaze also lists a later Odd Taxi film as a special; it was excluded.
- **Dates differ:** Kitsu is one day later for the five UBW and Death Note samples,
  and one day earlier for the five Steins;Gate samples. Three AoT dates differ
  by one day; two agree. All five Kitsu Odd Taxi air dates are null. Date-only
  matching would therefore reject good matches or misalign them. The cause of
  the date differences was not established.

## Information quality and extraction examples

The following are brief paraphrases of inspected source assertions, **not verified
canon or guaranteed safe graph facts**. Examples may reveal information through
the episode explicitly identified. No model was used.

| Source sample | Source-supported candidate information | Limit |
| --- | --- | --- |
| [Kitsu UBW episode 1](https://kitsu.app/api/edge/episodes/172701) | Rin revives Shirou; Lancer attacks him. | Useful explicit interactions; verify episode boundaries before publishing. |
| Kitsu UBW episode 6, “Mirage” | Shirou and Rin have a temporary truce. | Past-tense wording establishes support by episode 6, not the actual first reveal. |
| TVmaze UBW episode 1 | Shirou witnesses a fight between unnamed Servants. | Does not identify both combatants; importing their names from model memory would invent evidence. |
| TVmaze AoT episode 1 | Mikasa is described as Eren's foster sister and opposes his enlistment. | More character detail than Kitsu's sampled episode 1 teaser; still requires source review. |
| Kitsu Steins;Gate episode 1 | Okabe attends an event with his friend Mayuri and contacts Hashida. | Explicit names and interactions; much denser than TVmaze's short teaser. |
| TVmaze Death Note episode 19 | Matsuda is assigned to watch Misa. | A short summary can still support a narrow relationship assertion. |
| Both Odd Taxi episode 1 summaries | Odokawa drives passengers and visits an unnamed doctor. | The doctor cannot safely be assigned a canonical name from this text alone. |

Quality differs substantially by work:

- **UBW:** Kitsu provides the strongest seed material in this sample, with several
  names and concrete actions per synopsis. TVmaze's four nulls leave large gaps.
- **Attack on Titan:** both have usable events, but early Kitsu descriptions are
  generic. TVmaze can supplement named relationships omitted by Kitsu.
- **Steins;Gate:** Kitsu has detailed recaps; TVmaze's 23–29 word blurbs often leave
  people unnamed or compress events. In TVmaze sample 12, a pronoun about a
  future SERN affiliation is ambiguous; it should not become a confident edge.
- **Death Note:** most texts are short. They support some narrow assertions but
  do not describe every relationship or change. A narrator's shorthand about
  successors is not evidence that an earlier opponent still acts personally.
- **Odd Taxi:** all five descriptions name Odokawa, but no other character by
  name. The text repeats a generic introductory sentence. **All five provider
  pairs are identical after removing Kitsu's trailing source-credit marker**;
  using both does not supply independent confirmation or richer relationships.

Claims, beliefs, and invitations need their own status: a character claiming an
affiliation is not automatically proof of the affiliation. Neither provider's
description is a complete relationship dataset, even when every summary is nonempty.

## Availability, endpoints, and source considerations

The successful experiment used these public endpoints:

| Provider | Endpoint patterns actually used |
| --- | --- |
| AniList | `POST https://graphql.anilist.co`, title/year/format resolution |
| Kitsu | `GET https://kitsu.app/api/edge/anime?filter[text]=TITLE&page[limit]=20`, following pagination |
| Kitsu | `GET /api/edge/anime/{7882,7442,5646,1376,43932}/mappings?page[limit]=20` |
| Kitsu | `GET /api/edge/anime/{id}/episodes?page[limit]=20`, following pagination |
| Kitsu | `GET /api/edge/episodes/{episode_resource_id}`, five per anime |
| TVmaze | `GET https://api.tvmaze.com/lookup/shows?thetvdb={278626,267440,244061,79481}` |
| TVmaze | `GET /search/shows?q=ODDTAXI`, then `q=Odd Taxi` |
| TVmaze | `GET /shows/{1946,919,2051,40,53962}/episodes?specials=1` |
| TVmaze | `GET /episodes/{episode_resource_id}`, five per anime |

Actual bracket parameters are URL-encoded. Every complete URL, timestamp, status,
and response is in the local `/tmp` artifact. A simple JSON:API page cap of 20
and cycle/host checks prevent unbounded or off-provider pagination.

Initial Kitsu diagnostics returned **HTTP 406** with `Accept: application/json`
on both `kitsu.io` and `kitsu.app`. This was request negotiation, not missing
anime or unavailable infrastructure. `Accept: application/vnd.api+json` returned
HTTP 200, as required by [Kitsu's documentation](https://hummingbird-me.github.io/api-docs/).
The probe uses the verified `kitsu.app` endpoint. Diagnostics are excluded from
the 50-episode coverage denominator.

The shared client spaces all attempts by at least 2.1 seconds, uses a 20-second
socket timeout, and retries network failures, 429s, and 5xx errors at most three
times. It honors `Retry-After`, otherwise using two/four-second backoff.
[TVmaze documents](https://www.tvmaze.com/api) at least 20 requests per 10 seconds
per IP and cached responses. No numeric Kitsu rate limit was established from
the documentation inspected; conservative spacing is not evidence of its limit.

TVmaze's API documentation identifies CC BY-SA licensing and attribution
requirements. Kitsu descriptions sometimes credit an official site or Crunchyroll.
Preserve those references; API software licensing is not proof of rights to
republish episode prose. This report commits only metrics and short paraphrases,
not fetched summaries. Redistribution details need review before production use.

## Recommendation and fallback value

**Proceed with Kitsu as the first candidate for a small, reviewed extraction
experiment.** It supplied more complete UBW data and richer Steins;Gate text.
Do not adopt it as a guaranteed universal or automatically spoiler-safe provider.

TVmaze can help in two distinct cases: unavailable Kitsu text, or Kitsu text that
is nonempty but omits useful named interactions. In this sample, a null-only
fallback adds **zero** coverage because Kitsu already has 25/25 descriptions.
A richer-content supplement helps AoT, but adds no new Odd Taxi text and does not
solve UBW's numbering or verification requirements. Keep each source assertion
and its provenance separate rather than merging text into an assumed truth.

**Fate still needs curation, but its source material need not be written from
scratch.** Start with Kitsu's UBW descriptions, manually verify the prologue/TV-part
unit mapping, identities and aliases, concrete relationships, and reveal points,
then publish reviewed seed facts for the demo. This investigation has not
populated that dataset or proved all episodes have enough relationship evidence.

When neither source supports verified facts, keep universe discovery and saved
progress available and mark the story graph unavailable. Do not substitute
full-series biographies, cross-route knowledge, or model background knowledge.

## Engineering changes and checks

- Added `backend/scripts/episode_provider_feasibility.py`, importing the existing
  probe's client, resolver, sample selection, and metrics.
- Extended `backend/scripts/jikan_feasibility.py` with a selectable Accept header,
  final-URL recording, and clearing stale errors after a successful retry.
- Added `backend/tests/test_episode_provider_feasibility.py`, using synthetic
  episode text for normalization, identity mismatch, mapping conflict, alias
  handling, overlapping pagination, and specials tests.
- Updated README with the comparison command and report link.
- Production endpoints, schemas, frontend, auth, graph filtering, database, and
  hosting configuration remain unchanged. No extraction or production integration.

All 24 backend tests pass. Frontend typecheck, production build, and the existing
auth regression check pass. Report totals were checked against the saved API
responses. These checks do not verify a live login or database persistence.
