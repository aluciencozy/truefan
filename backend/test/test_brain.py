import json
from pathlib import Path
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from tempfile import TemporaryDirectory

from app.schemas import ExtractRequest, RevealPoint
from app.services.huggingface import generate_candidates, validate_candidates
from app.services.rag import build_context, build_qa_messages
from app.brain_experiment import main


class BrainTests(unittest.TestCase):
    def setUp(self) -> None:
        path = Path(__file__).resolve().parents[1] / "data/lantern_harbor_summaries.json"
        self.summaries = [ExtractRequest.model_validate(item) for item in json.loads(path.read_text())]
        self.summary = "Mira visits Lantern Harbor."
        self.candidates = {
            "entities": [
                {"name": "Mira", "type": "character", "evidence": self.summary},
                {"name": "Lantern Harbor", "type": "location", "evidence": self.summary},
            ],
            "relationships": [{"source": "Mira", "target": "Lantern Harbor",
                               "type": "visits", "evidence": self.summary}],
        }

    def test_valid_candidates(self) -> None:
        result = validate_candidates(json.dumps(self.candidates), self.summary)
        self.assertEqual(result.relationships[0].target, "Lantern Harbor")

    @patch("app.brain_experiment.generate_candidates")
    def test_experiment_saves_unreviewed_provenance(self, generate) -> None:
        generate.return_value = json.dumps(self.candidates)
        with TemporaryDirectory() as directory:
            source = Path(directory) / "source.json"
            output = Path(directory) / "master.json"
            source.write_text(json.dumps([{"media_id": "test", "summary": self.summary,
                                          "source": "manual:test/unit-2", "reveal_point": {"unit": 2}}]))
            with patch("sys.argv", ["experiment", "--input", str(source), "--output", str(output), "--runs", "1"]):
                self.assertEqual(main(), 0)
            stored = json.loads(output.read_text())
            fact = stored["runs"][0]["candidates"]["relationships"][0]
            self.assertEqual(fact["revealed_at"], {"unit": 2})
            self.assertEqual(fact["provenance"]["source"], "manual:test/unit-2")
            self.assertFalse(fact["provenance"]["verified"])
            self.assertEqual(stored["runs"][0]["review_status"], "pending")

    def test_reject_missing_endpoint(self) -> None:
        self.candidates["relationships"][0]["target"] = "Future villain"
        with self.assertRaises(ValueError):
            validate_candidates(json.dumps(self.candidates), self.summary)

    def test_reject_invented_evidence(self) -> None:
        self.candidates["relationships"][0]["evidence"] = "Mira rules the town."
        with self.assertRaises(ValueError):
            validate_candidates(json.dumps(self.candidates), self.summary)

    def test_reject_duplicates_wrong_types_and_non_json(self) -> None:
        self.candidates["entities"].append(self.candidates["entities"][0])
        with self.assertRaises(ValueError):
            validate_candidates(json.dumps(self.candidates), self.summary)
        with self.assertRaises(ValueError):
            validate_candidates('```json\n{}\n```', self.summary)
        self.candidates["entities"][0]["type"] = "organization"
        with self.assertRaises(ValueError):
            validate_candidates(json.dumps(self.candidates), self.summary)

    def test_no_future_summaries_even_when_rewinding(self) -> None:
        self.assertIn("Glass compass", build_context(self.summaries, "lantern-harbor", RevealPoint(unit=3)))
        early = build_context(self.summaries, "lantern-harbor", RevealPoint(unit=1))
        self.assertIn("Mira", early)
        self.assertNotIn("Lightkeepers", early)
        self.assertNotIn("Glass compass", early)
        self.assertNotIn("episode-2", early)
        self.assertEqual(build_context(self.summaries, "lantern-harbor", RevealPoint(unit=0)), "")

    def test_order_media_isolation_and_budget(self) -> None:
        context = build_context(self.summaries[::-1], "lantern-harbor", RevealPoint(unit=3))
        self.assertLess(context.index("[Unit 1"), context.index("[Unit 2"))
        self.assertEqual(build_context(self.summaries, "other-media", RevealPoint(unit=3)), "")
        with self.assertRaises(ValueError):
            build_context(self.summaries, "lantern-harbor", RevealPoint(unit=3), max_chars=5)
        self.assertIn("I don't know", build_qa_messages("", "Who is Mira?")[0]["content"])

    @patch("app.services.huggingface.InferenceClient")
    @patch("app.services.huggingface.settings")
    def test_provider_call_and_truncation(self, settings, client) -> None:
        settings.hf_token = "mock-token"
        settings.hf_provider = "auto"
        settings.hf_model_id = "test/model"
        completion = client.return_value.chat_completion
        completion.return_value = SimpleNamespace(choices=[SimpleNamespace(
            finish_reason="stop", message=SimpleNamespace(content=json.dumps(self.candidates)))])
        raw = generate_candidates(self.summaries[0])
        self.assertTrue(raw)
        self.assertEqual(completion.call_args.kwargs["messages"][1]["content"], self.summaries[0].summary)
        completion.return_value.choices[0].finish_reason = "length"
        with self.assertRaises(ValueError):
            generate_candidates(self.summaries[0])


if __name__ == "__main__":
    unittest.main()
