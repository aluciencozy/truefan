"""One-request extraction smoke test using a made-up story; no database writes."""

import json
import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv
from huggingface_hub import InferenceClient
from pydantic import BaseModel, ConfigDict, Field, ValidationError


PARAGRAPH = """
Ava and Kai are members of the Dawn Rescue Team.
Ava is Kai's sister. The team protects the town of Brookhaven.
"""

INSTRUCTIONS = """
Extract entities and relationships from the supplied paragraph.
Use only explicitly stated facts. Do not invent information.
Return only valid JSON, without Markdown fences or commentary.

Use this structure:
{
  "entities": [
    {"name": "entity name", "type": "character|organization|place"}
  ],
  "relationships": [
    {
      "source": "entity name",
      "target": "entity name",
      "type": "relationship label",
      "evidence": "exact quote from the paragraph"
    }
  ]
}

Every relationship source and target must appear in entities.
"""


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Entity(StrictModel):
    name: str = Field(min_length=1)
    type: Literal["character", "organization", "place"]


class Relationship(StrictModel):
    source: str = Field(min_length=1)
    target: str = Field(min_length=1)
    type: str = Field(min_length=1)
    evidence: str = Field(min_length=1)


class Extraction(StrictModel):
    entities: list[Entity] = Field(min_length=1)
    relationships: list[Relationship] = Field(min_length=1)


def validate_output(answer: str) -> Extraction:
    result = Extraction.model_validate_json(answer)
    names = {entity.name for entity in result.entities}
    for entity in result.entities:
        if entity.name not in PARAGRAPH:
            raise ValueError("An entity name is absent from the paragraph.")
    for relationship in result.relationships:
        if not {relationship.source, relationship.target} <= names:
            raise ValueError("A relationship endpoint is absent from entities.")
        if relationship.evidence not in PARAGRAPH:
            raise ValueError("Relationship evidence is absent from the paragraph.")
    return result


def main() -> int:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    token = os.environ.get("HF_TOKEN", "").strip()
    model = os.environ.get("HF_MODEL", "").strip()
    if not token or not model:
        print("FAILED: Set HF_TOKEN and HF_MODEL in backend/.env.")
        return 1

    client = InferenceClient(api_key=token, timeout=60)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": INSTRUCTIONS},
                {"role": "user", "content": PARAGRAPH},
            ],
            max_tokens=700,
            temperature=0,
        )
    except Exception as error:
        # Avoid printing provider exceptions that may contain request details.
        print(f"FAILED: Hugging Face request failed ({type(error).__name__}).")
        return 1

    answer = response.choices[0].message.content or ""
    print("MODEL RESPONSE:")
    print(answer)
    try:
        result = validate_output(answer)
    except (ValidationError, ValueError) as error:
        print(f"\nFAILED: JSON, schema, endpoint, or evidence check failed.\n{error}")
        return 1

    print("\nSUCCESS: JSON, schema, endpoints, and evidence passed basic checks.")
    print(json.dumps(result.model_dump(), indent=2))
    print("Facts still need semantic review; this test does not verify spoiler safety.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
