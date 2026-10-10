import json
import os
from pathlib import Path

from dotenv import load_dotenv
from huggingface_hub import InferenceClient

# Load settings from the .env beside this script.
load_dotenv(Path(__file__).resolve().parent / ".env")

client = InferenceClient(
    api_key=os.environ["HF_TOKEN"],
    timeout=60,
)

# Made-up story for our first test.
paragraph = """
Ava and Kai are members of the Dawn Rescue Team.
Ava is Kai's sister. The team protects the town of Brookhaven.
"""

instructions = """
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

response = client.chat.completions.create(
    model=os.environ["HF_MODEL"],
    messages=[
        {"role": "system", "content": instructions},
        {"role": "user", "content": paragraph},
    ],
    max_tokens=700,
)

answer = response.choices[0].message.content or ""

print("MODEL RESPONSE:")
print(answer)

# Check whether Python can read the response as JSON.
try:
    result = json.loads(answer)
except json.JSONDecodeError:
    print("\nFAILED: The response is not valid JSON.")
else:
    print("\nSUCCESS: The response is valid JSON.")
    print(json.dumps(result, indent=2))