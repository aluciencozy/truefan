import io
import json
import unittest
from unittest.mock import Mock, patch

from scripts.episode_provider_feasibility import (JSON_API, collect, kitsu_pages,
                                                 match_kitsu, match_tvmaze, normalize, plain_text)
from scripts.jikan_feasibility import Client


def response(data, status=200):
    return {"url": "https://example.test/episodes/1", "requested_at": "2026-01-01T00:00:00Z",
            "status": status, "attempts": [], "data": data}


class EpisodeProviderTests(unittest.TestCase):
    def test_html_and_missing_descriptions_are_distinct_from_fetch_failure(self):
        expected = {"id": 10, "season": 1, "number": 1}
        for fields, state in [({}, "missing"), ({"summary": None}, "null"),
                              ({"summary": "<p> </p>"}, "empty"),
                              ({"summary": "<p>Mira &amp; Sol</p><p>meet.</p>"}, "nonempty")]:
            with self.subTest(state=state):
                sample = normalize("tvmaze", response({**expected, **fields}), expected)
                self.assertTrue(sample["valid"])
                self.assertEqual(sample["synopsis_state"], state)
        self.assertEqual(plain_text("<p>Mira &amp; Sol</p><p>meet.</p>"), "Mira & Sol meet.")
        self.assertFalse(normalize("tvmaze", response(None, 503), expected)["valid"])
        for data in [{**expected, "number": 2}, {**expected, "season": 2},
                     {**expected, "summary": 42}]:
            self.assertFalse(normalize("tvmaze", response(data), expected)["valid"])

    def test_kitsu_description_fallback_and_episode_identity(self):
        expected = {"id": "10", "attributes": {"number": 1, "seasonNumber": 1}}
        episode = {**expected, "attributes": {**expected["attributes"], "description": None,
                                              "synopsis": "Mira meets Sol."}}
        sample = normalize("kitsu", response({"data": episode}), expected)
        self.assertEqual(sample["source_field"], "synopsis")
        self.assertEqual(sample["synopsis_state"], "nonempty")
        episode["id"] = "11"
        self.assertFalse(normalize("kitsu", response({"data": episode}), expected)["valid"])

    def test_kitsu_mapping_rejects_same_title_with_conflicting_external_id(self):
        entry = {"id": 1, "idMal": 2, "title": {"romaji": "Example", "english": None},
                 "startDate": {"year": 2020}}
        candidate = {"id": "10", "attributes": {"titles": {"en": "Example"}, "startDate": "2020-01-01", "subtype": "TV"}}
        client = Mock()
        client.fetch.side_effect = [response({"data": [candidate], "links": {}}), response({"data": [
            {"id": "50", "attributes": {"externalSite": "myanimelist/anime", "externalId": "999"}}], "links": {}})]
        with self.assertRaisesRegex(ValueError, "ID-verified"):
            match_kitsu(client, entry)

    def test_tvmaze_uses_external_id_and_season_mapping(self):
        mappings = [{"attributes": {"externalSite": "thetvdb/series", "externalId": "50"}},
                    {"attributes": {"externalSite": "thetvdb", "externalId": "50/2"}}]
        client = Mock()
        client.fetch.return_value = response({"id": 8, "type": "Animation", "externals": {"thetvdb": 50}})
        _, season, evidence = match_tvmaze(client, {}, mappings)
        self.assertEqual(season, 2)
        self.assertIn("external ID", evidence)
        self.assertIn("thetvdb=50", client.fetch.call_args.args[0])
        client.fetch.return_value["data"]["externals"]["thetvdb"] = 51
        with self.assertRaisesRegex(ValueError, "conflicting"):
            match_tvmaze(client, {}, mappings)

    def test_tvmaze_tries_title_alias_and_rejects_live_action_adaptation(self):
        client = Mock()
        entry = {"title": {"english": "EXAMPLESHOW", "romaji": "Example Show"}, "startDate": {"year": 2021}}
        client.fetch.side_effect = [response([{"show": {"id": 9, "name": "RoOT", "premiered": "2024-01-01",
                                                "type": "Scripted", "language": "Japanese"}}]),
                                   response([{"show": {"id": 10, "name": "Example Show", "premiered": "2021-01-01",
                                                "type": "Animation", "language": "Japanese"}}])]
        show, _, evidence = match_tvmaze(client, entry, [])
        self.assertEqual(show["id"], 10)
        self.assertIn("no cross-database ID verification", evidence)
        self.assertIn("Example+Show", client.fetch.call_args.args[0])

    def test_pagination_rejects_cycles_and_foreign_hosts(self):
        client = Mock()
        start = "https://kitsu.app/api/edge/anime?page=1"
        for next_url in [start, "https://example.test/api/edge/anime"]:
            client.fetch.return_value = response({"data": [], "links": {"next": next_url}})
            with self.assertRaisesRegex(ValueError, "pagination"):
                kitsu_pages(client, start)
        client.fetch.side_effect = [response({"data": [{"id": "1"}], "links": {"next": start + "&offset=20"}}),
                                    response({"data": [{"id": "1"}, {"id": "2"}], "links": {}})]
        self.assertEqual([row["id"] for row in kitsu_pages(client, start)], ["1", "2"])

    def test_sampling_excludes_specials_and_rejects_number_collisions(self):
        episodes = [{"id": n, "season": 1, "number": n, "summary": None} for n in range(1, 13)]
        episodes.append({"id": 99, "season": 1, "number": None})
        client = Mock()
        client.fetch.side_effect = lambda url, **kwargs: response(next(row for row in episodes if row["id"] == int(url.rsplit("/", 1)[1])))
        result = {"samples": []}
        collect(client, "tvmaze", episodes, result)
        self.assertEqual([row["episode"] for row in result["samples"]], [1, 2, 6, 11, 12])
        self.assertEqual(result["state"], "sampled")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            collect(client, "tvmaze", episodes + [episodes[0]], {"samples": []})

    @patch("scripts.jikan_feasibility.time.sleep")
    @patch("scripts.jikan_feasibility.urlopen")
    def test_shared_client_sends_json_api_accept_header(self, opener, sleep):
        success = io.BytesIO(json.dumps({"data": []}).encode())
        success.status, success.headers = 200, {}
        opener.return_value = success
        Client().fetch("https://kitsu.app/api/edge/anime", accept=JSON_API)
        self.assertEqual(opener.call_args.args[0].get_header("Accept"), JSON_API)


if __name__ == "__main__":
    unittest.main()
