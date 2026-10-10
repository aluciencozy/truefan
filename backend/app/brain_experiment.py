"""Run from backend/: python -m app.brain_experiment --runs 3."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from app.config import settings
from app.schemas import ExtractRequest
from app.services.huggingface import PROMPTS, generate_candidates, validate_candidates

DEFAULT_INPUT = Path(__file__).resolve().parents[1] / "data/lantern_harbor_summaries.json"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=Path("artifacts/master_candidates.json"))
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--model", default=settings.hf_model_id)
    parser.add_argument("--provider", default=settings.hf_provider)
    parser.add_argument("--prompt-version", choices=PROMPTS, default="grounded_v2")
    args = parser.parse_args()
    if not 1 <= args.runs <= 10:
        parser.error("--runs must be between 1 and 10")
    if args.output.exists():
        parser.error("Output exists; choose a new --output to preserve previous experiments")
    inputs = [ExtractRequest.model_validate(item) for item in json.loads(args.input.read_text())]
    if not inputs:
        parser.error("Input must contain at least one summary")
    # First paragraph only: feasibility before a large ingestion pipeline.
    request = inputs[0]
    records: list[dict] = []
    for attempt in range(args.runs):
        record = {"run_id": str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat(),
                  "model": args.model, "provider": args.provider,
                  "prompt_version": args.prompt_version, "prompt": PROMPTS[args.prompt_version],
                  "input": request.model_dump(),
                  "source_sha256": hashlib.sha256(request.summary.encode()).hexdigest(),
                  "review_status": "pending", "verified": False, "valid": False}
        try:
            raw = generate_candidates(request, model=args.model, prompt_version=args.prompt_version,
                                      provider=args.provider)
            record["raw_response"] = raw
            candidates = validate_candidates(raw, request.summary)
            record["candidates"] = candidates.model_dump()
            for group in record["candidates"].values():
                for fact in group:
                    fact["revealed_at"] = request.reveal_point.model_dump()
                    fact["provenance"] = {"source": request.source,
                                          "source_unit": request.reveal_point.unit,
                                          "verified": False}
            record["valid"] = True
            print(f"Run {attempt + 1}: valid JSON, evidence, and endpoints; human review pending")
        except Exception as exc:
            # Never persist exception text: HTTP errors may include credentials.
            record["error_type"] = type(exc).__name__
            response = getattr(exc, "response", None)
            record["http_status"] = getattr(response, "status_code", None)
            print(f"Run {attempt + 1}: failed ({type(exc).__name__}); check model/provider/token or output")
        records.append(record)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"status": "review_required", "runs": records,
                                      "valid_runs": sum(r["valid"] for r in records)}, indent=2) + "\n")
    print(f"Saved experiment to {args.output}; no graph or database was changed")
    return 0 if all(record["valid"] for record in records) else 1


if __name__ == "__main__":
    raise SystemExit(main())
