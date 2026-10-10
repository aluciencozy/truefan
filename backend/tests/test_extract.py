import io
import json
import socket
import unittest
import urllib.error
from unittest.mock import patch
from fastapi import HTTPException
from app.config import settings
from app.main import ALLOWED_ORIGINS, extract_media_graph
from app.schemas import GraphExtractRequest, RevealPoint
from app.services.seed_catalog import AOT_ENTITIES, SEED, validate


def request(progress: int, reveal: int = 1) -> GraphExtractRequest:
    return GraphExtractRequest(summary="Eren meets Mikasa.", source="recap",
                               reveal_point=RevealPoint(unit=reveal), progress=RevealPoint(unit=progress))


def model_reply(content: str) -> io.BytesIO:
    return io.BytesIO(json.dumps({"choices": [{"message": {"content": content}}]}).encode())


class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.object(settings, "database_url", ""))  # built-in fallback, no network
        self.enterContext(patch.object(settings, "hf_token", "test-token"))
        self.urlopen = self.enterContext(patch("app.services.huggingface.urllib.request.urlopen"))

    def assert_fallback_is_spoiler_safe(self, progress: int):
        graph = extract_media_graph("attack-on-titan", request(progress))
        self.assertEqual(graph.origin, "builtin")
        visible = {n.id for n in graph.nodes}
        self.assertEqual(visible, {e.id for e in AOT_ENTITIES if e.revealed_at.unit <= progress})
        self.assertTrue(all(e.source in visible and e.target in visible for e in graph.edges))
        text = graph.model_dump_json()
        for hidden in [e for e in AOT_ENTITIES if e.revealed_at.unit > progress]:
            self.assertNotIn(hidden.name, text)

    def test_rate_limit_timeout_and_garbage_fall_back_to_filtered_graph(self):
        failures = [urllib.error.HTTPError("u", 429, "Too Many Requests", {}, None), socket.timeout("slow"),
                    urllib.error.URLError("down"), "sorry, no JSON", '{"entities": []}']
        for failure in failures:
            self.urlopen.reset_mock(side_effect=True)
            if isinstance(failure, str):  # a fresh stream per call; a BytesIO can only be read once
                self.urlopen.side_effect = lambda *a, text=failure, **k: model_reply(text)
            else:
                self.urlopen.side_effect = failure
            for progress in [0, 1, 5, 25]:
                with self.subTest(failure=str(failure)[:20], progress=progress):
                    self.assert_fallback_is_spoiler_safe(progress)

    def test_missing_token_skips_the_provider(self):
        with patch.object(settings, "hf_token", ""):
            self.assertEqual(extract_media_graph("attack-on-titan", request(1)).origin, "builtin")
        self.urlopen.assert_not_called()

    def test_valid_model_output_becomes_unverified_react_flow_graph(self):
        content = json.dumps({"entities": [
            {"name": "Eren", "type": "character", "description": "A boy."},
            {"name": "Mikasa", "type": "wizard"}, {"name": "Eren"}],
            "relationships": [{"source": "Eren", "target": "Mikasa", "type": "friend"},
                              {"source": "Eren", "target": "Nobody", "type": "knows"}]})
        self.urlopen.return_value = model_reply("```json\n" + content + "\n```")
        graph = extract_media_graph("attack-on-titan", request(3, reveal=2))
        self.assertEqual(graph.origin, "ai")
        self.assertEqual([n.id for n in graph.nodes], ["eren", "mikasa"])
        self.assertEqual(graph.nodes[1].data.entity_type, "character")
        self.assertEqual([(e.source, e.target, e.label) for e in graph.edges], [("eren", "mikasa", "friend")])
        self.assertFalse(graph.nodes[0].data.provenance.verified)
        self.assertEqual(graph.nodes[0].data.revealed_at.unit, 2)

    def test_ai_facts_revealed_after_viewer_progress_are_not_returned(self):
        self.urlopen.return_value = model_reply('{"entities": [{"name": "Eren"}], "relationships": []}')
        graph = extract_media_graph("attack-on-titan", request(2, reveal=5))
        self.assertEqual((graph.origin, graph.nodes, graph.edges), ("ai", [], []))

    def test_unknown_media_and_out_of_range_progress(self):
        for media_id, progress, status in [("nope", 1, 404), ("attack-on-titan", 26, 422)]:
            with self.subTest(media_id=media_id), self.assertRaises(HTTPException) as raised:
                extract_media_graph(media_id, request(progress))
            self.assertEqual(raised.exception.status_code, status)


class SeedTests(unittest.TestCase):
    def test_seed_is_consistent_and_staggered(self):
        for media, entities, relationships in SEED:
            validate(media, entities, relationships)
        aot = dict((m.id, (e, r)) for m, e, r in SEED)["attack-on-titan"]
        self.assertGreaterEqual(len(aot[0]), 15)
        self.assertTrue({1, 5, 10} <= {e.revealed_at.unit for e in aot[0]})
        self.assertTrue({1, 5, 10} <= {r.revealed_at.unit for r in aot[1]})

    def test_cors_origins_are_explicit(self):
        self.assertNotIn("*", ALLOWED_ORIGINS)
        self.assertTrue({"http://localhost:3000", "http://127.0.0.1:3000"} <= set(ALLOWED_ORIGINS))


if __name__ == "__main__":
    unittest.main()
