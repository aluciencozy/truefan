# Backend Track 1: the Brain

The goal is to test one paragraph before building a scraper or a large pipeline.
Lantern Harbor is our fictional demo; its summaries are in
`data/lantern_harbor_summaries.json`. Each summary is limited to its own episode.

## Recorded feasibility result (October 10, 2026)

Real HF calls used `Qwen/Qwen2.5-7B-Instruct` through `featherless-ai`.

| Experiment | Result |
| --- | --- |
| `artifacts/live_probe.json`, auto routing | HTTP 400 before generation |
| `artifacts/explicit_provider_probe.json`, grounded prompt | JSON generated; rejected because a quoted sentence was paraphrased |
| `artifacts/baseline.json`, baseline prompt | 1/1 passed structural and source-evidence checks |
| `artifacts/master_candidates.json`, grounded_v2 | 3/3 passed structural and source-evidence checks |

The improved prompt's three runs all extracted Mira, Sol, and Lantern Harbor,
plus `Mira -> Lantern Harbor: visits` and `Mira -> Sol: friend`, matching the
paragraph's explicit facts (friendship is symmetric). Quotes were copied exactly.
These are actual model outputs, not mocked responses. This small sample shows
feasibility and one observed prompt failure; it does not establish broad accuracy
or statistically demonstrate that v2 outperforms baseline. All facts remain
unverified pending human review. `artifacts/initial_probe.json` additionally
records a sandbox network failure, which says nothing about model quality.

## 1. Prompt engineering experiment

From `backend/`, using Python 3.11+ and installed `requirements.txt`:

```bash
python -m app.brain_experiment --provider featherless-ai --prompt-version baseline --runs 1 --output artifacts/baseline.json
python -m app.brain_experiment --provider featherless-ai --prompt-version grounded_v2 --runs 3 --output artifacts/master_candidates.json
```

Both commands send the first paragraph to Hugging Face Inference Providers.
Set `HF_TOKEN`, `HF_MODEL_ID`, and optionally `HF_PROVIDER` in `backend/.env`.
Choose a currently served instruct/chat model. Availability and structured-output
support depend on the model/provider. The experiment uses prompt-only JSON so
we can measure its reliability rather than assume constrained decoding works.
The provider flag above selects a provider verified as live during this experiment;
recheck availability if it stops working. `grounded_v2` additionally demonstrates
verbatim, contiguous evidence quotes after the first grounded run paraphrased a quote.
The prompts and Pydantic schema live in `app/services/huggingface.py`.
See [HF chat completion](https://huggingface.co/docs/inference-providers/tasks/chat-completion)
and [structured outputs](https://huggingface.co/docs/inference-providers/guides/structured-output).

The grounded prompt adds exact source evidence, our graph entity types, consistent
relationship labels, and instructions to omit unstated information. Inspect each
saved raw response against the paragraph. For episode 1, expect Mira (character),
Sol (character), Lantern Harbor (location), Mira visiting Lantern Harbor, and
Sol being Mira's friend. Check direction, completeness, and meaning by hand;
copied evidence alone does not prove a relationship is true.

A successful parse checks JSON shape, supported entity types, unique names,
source quotes, and valid endpoints. Every stored candidate gets its reveal point
from the input's source unit, and remains `verified: false`. Three successful
runs on one paragraph are a small feasibility signal, not a general reliability
claim. Next test more paragraphs, ambiguity, empty text, and adversarial content.

The master file is an experiment envelope containing runs and candidate facts,
not the public graph's `Entity`/`Relationship` format. It retains source text,
source hash, prompt/version, model, requested provider, timestamp, and run ID.
`auto` records the requested routing policy, not a confirmed underlying provider.
To publish later, a reviewer must verify facts and reveal points, assign stable
IDs, and write separately reviewed descriptions. No candidates are served by
the frontend or written to Neon by this experiment.

## 2. RAG logic draft

RAG means giving the answering model relevant story text before asking it a
question. For this small demo, no vector database is needed:

```text
Selected media + last finished unit X
  -> select curated summaries for that media using graph.is_revealed
  -> sort units in story order
  -> concatenate unit 1 ... X with source labels
  -> check context budget
  -> add question + instructions to answer only from that context
```

`app/services/rag.py` implements the draft. Progress 0 produces no story context.
Episode 1 excludes the Lightkeepers and Glass compass; episode 2 excludes the
compass. Names and source labels are filtered along with summary text. Rebuild
context whenever progress changes; do not carry later summaries or answers into
an earlier-progress conversation. Summaries must themselves be reviewed for
episode-local content: attaching unit 1 to a full-series wiki synopsis is unsafe.

The 12,000-character budget is a conservative draft limit, not a token count or
a claim about a particular model's context window. It fails clearly on overflow
rather than silently dropping earlier evidence. Before a live Q&A integration,
reserve tokens for instructions/question/answer using the chosen model's tokenizer.
For larger stories, retrieve only reviewed chunks that pass the same reveal
filter **before** ranking. Cite source units and abstain when context is insufficient.
A prompt does not guarantee an answering model will avoid outside knowledge;
answer validation and spoiler evaluations remain needed. `/api/ask` stays a 501
placeholder because this task requests a logic draft, not a deployed chatbot.

## 3. Pipeline blueprint

```text
Episode-specific wiki page (or our manual summary fixture)
  -> fetch permitted page, retain URL + revision + retrieval timestamp
  -> select only the episode summary section; strip navigation/future sections
  -> human-check source unit and episode-local content
  -> create ExtractRequest(media_id, summary, source, reveal_point)
  -> send paragraph + versioned prompt/schema to Hugging Face
  -> parse and validate JSON, quotes, names, relationship endpoints
  -> stamp source-unit reveal points + provenance in backend
  -> save unreviewed candidates to master JSON
  -> human review of truth, completeness, identity, and reveal points
  -> convert approved facts to graph schema with stable IDs/descriptions
  -> optional later import into Neon
  -> existing graph filter -> frontend
```

Keep failures alongside successful attempts for analysis. A failed/truncated
response must never become a graph fact. Preserve earlier experiments by using
a new output filename. Scraping is intentionally a planned stage; the implemented
proof of concept starts with manually authored summaries. Do not build a wiki
crawler until the model experiment is useful. No new HTTP contracts are introduced;
`/api/extract` stays disabled to avoid exposing a public billable ingestion endpoint.
