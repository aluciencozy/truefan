import json
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.config import settings
from app.main import app
from app.services import demo
from app.schemas import RevealPoint

client = TestClient(app)
MEDIA = "lantern-harbor"
EXPECTED = {
    0: (set(), set()),
    1: ({"mira", "sol", "harbor"}, {"friends", "visits"}),
    2: ({"mira", "sol", "harbor", "keepers"}, {"friends", "visits", "maintains", "joins"}),
    3: ({"mira", "sol", "harbor", "keepers", "compass"}, {"friends", "visits", "maintains", "joins", "finds"}),
}


def graph(progress, media=MEDIA):
    return client.get(f"/api/media/{media}/graph", params={"progress": progress})


class GraphTests(unittest.TestCase):
    def test_exact_reveal_sets_and_invariants(self):
        for progress, (entity_ids, edge_ids) in EXPECTED.items():
            with self.subTest(progress=progress):
                response = graph(progress)
                self.assertEqual(response.status_code, 200)
                body = response.json()
                ids = [e["id"] for e in body["entities"]]
                edges = body["relationships"]
                self.assertEqual(set(ids), entity_ids)
                self.assertEqual({e["id"] for e in edges}, edge_ids)
                self.assertEqual(len(ids), len(set(ids)))
                self.assertEqual(len(edges), len({e["id"] for e in edges}))
                self.assertEqual(body["progress"]["unit"], progress)
                self.assertEqual(body["media_id"], MEDIA)
                for item in body["entities"] + edges:
                    self.assertLessEqual(item["revealed_at"]["unit"], progress)
                for edge in edges:
                    self.assertIn(edge["source"], ids)
                    self.assertIn(edge["target"], ids)

    def test_no_spoiler_leak_at_progress_1(self):
        text = json.dumps(graph(1).json())
        for hidden in ["compass", "Glass compass", "Lightkeepers"]:
            self.assertNotIn(hidden, text)

    def test_edge_with_hidden_endpoint_is_dropped(self):
        early = [r.model_copy(update={"revealed_at": RevealPoint(unit=1)}) if r.id == "finds" else r
                 for r in demo.RELATIONSHIPS]
        with patch("app.main.RELATIONSHIPS", early):
            body = graph(1).json()
        self.assertEqual({e["id"] for e in body["relationships"]}, {"friends", "visits"})

    def test_invalid_progress_and_unknown_media(self):
        for params in [{}, {"progress": -1}, {"progress": "abc"}, {"progress": "1.5"}, {"progress": 4}]:
            with self.subTest(params=params):
                self.assertEqual(client.get(f"/api/media/{MEDIA}/graph", params=params).status_code, 422)
        with patch("app.main.cached_generation", return_value=None):
            self.assertEqual(graph(1, "nope").status_code, 404)
        self.assertEqual(client.get("/api/media/nope").status_code, 404)


class MiscEndpointTests(unittest.TestCase):
    def test_health(self):
        response = client.get("/health")
        self.assertEqual((response.status_code, response.json()), (200, {"status": "ok", "mode": "demo"}))

    def test_me_without_token_is_401(self):
        with patch.object(settings, "neon_auth_base_url", "https://auth.example.test/neondb/auth"):
            self.assertEqual(client.get("/api/me").status_code, 401)

    def test_extract_and_ask_are_501(self):
        extract = client.post("/api/extract", json={"media_id": MEDIA, "summary": "s", "source": "x",
                                                    "reveal_point": {"unit": 1}})
        ask = client.post("/api/ask", json={"media_id": MEDIA, "progress": {"unit": 1}, "question": "who?"})
        for response in (extract, ask):
            self.assertEqual(response.status_code, 501)
            self.assertEqual(response.json()["status"], "not_implemented")


class SearchTests(unittest.TestCase):
    def setUp(self):
        # Offline: AniList returns nothing and the DB fallback is never reached.
        self.enterContext(patch("app.main.anilist.search_media", return_value=[]))
        self.enterContext(patch("app.main.franchises.search_local", return_value=[]))

    def search(self, q):
        return client.get("/api/media/search", params={"q": q})

    def test_match_no_match_and_case_insensitive(self):
        self.assertEqual([m["id"] for m in self.search("lantern").json()], [MEDIA])
        self.assertEqual([m["id"] for m in self.search("LANTERN hArBoR").json()], [MEDIA])
        self.assertEqual(self.search("zzzz").json(), [])

    def test_length_limit(self):
        self.assertEqual(self.search("a" * 200).status_code, 200)
        self.assertEqual(self.search("a" * 201).status_code, 422)

    def test_provider_failure_is_502_not_500(self):
        with patch("app.main.anilist.search_media", side_effect=ValueError("down")):
            self.assertEqual(self.search("zzzz").status_code, 502)


if __name__ == "__main__":
    unittest.main()
