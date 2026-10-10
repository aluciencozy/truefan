import io
import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

from scripts.jikan_feasibility import (Client, episode_numbers, metrics, normalize,
                                      resolve, retry_delay, run, sample_numbers, SERIES)


def response(data, status=200):
    return {"url": "https://example.test/episodes/1", "requested_at": "2026-01-01T00:00:00Z",
            "status": status, "attempts": [], "data": {"data": data}}


class JikanFeasibilityTests(unittest.TestCase):
    def test_synopsis_states_and_strict_validation(self):
        for fields, state in [({}, "missing"), ({"synopsis": None}, "null"),
                              ({"synopsis": "  \n"}, "empty"),
                              ({"synopsis": " Mira meets Sol. "}, "nonempty")]:
            with self.subTest(state=state):
                row = normalize(response({"mal_id": 1, "title": "Arrival", **fields}), 1)
                self.assertTrue(row["valid"])
                self.assertEqual(row["synopsis_state"], state)
                self.assertEqual(row["characters"], len((fields.get("synopsis") or "").strip()))
        for data in [{"mal_id": 2}, {"mal_id": "1"}, {"mal_id": 1, "synopsis": 7},
                     {"mal_id": 1, "title": []}, None]:
            self.assertFalse(normalize(response(data), 1)["valid"])
        self.assertFalse(normalize(response({"mal_id": 1}, 503), 1)["valid"])

    def test_failed_requests_do_not_become_empty_synopses(self):
        samples = [normalize(response({"mal_id": 1, "synopsis": "Mira meets Sol."}), 1),
                   normalize(response({"mal_id": 1, "synopsis": None}), 1),
                   normalize(response(None, 503), 1)]
        result = metrics(samples, 5)
        self.assertAlmostEqual(result["fetch_success_percent"], 200 / 3)
        self.assertEqual(result["nonempty_percent_of_http_200"], 50)
        self.assertEqual(result["nonempty_percent_of_planned"], 20)
        self.assertIsNone(metrics([], 5)["nonempty_percent_of_http_200"])

    def test_pagination_and_sample_selection(self):
        client = Mock()
        client.fetch.side_effect = [
            {"data": {"data": [{"mal_id": 1}, {"mal_id": 2}], "pagination": {"has_next_page": True}}},
            {"data": {"data": [{"mal_id": n} for n in range(3, 13)], "pagination": {"has_next_page": False}}},
        ]
        numbers = episode_numbers(client, 42)
        self.assertEqual(sample_numbers(numbers), [1, 2, 6, 11, 12])
        self.assertTrue(client.fetch.call_args.args[0].endswith("page=2"))
        with self.assertRaises(ValueError):
            sample_numbers([1, 2, 3])
        client.fetch.side_effect = None
        client.fetch.return_value = {"data": {"data": [], "pagination": {"has_next_page": True}}}
        with self.assertRaisesRegex(ValueError, "page cap"):
            episode_numbers(client, 42)
        client.fetch.return_value["data"]["pagination"]["has_next_page"] = "false"
        with self.assertRaisesRegex(ValueError, "pagination"):
            episode_numbers(client, 42)

    def test_resolver_rejects_ambiguous_or_missing_mal_mapping(self):
        client = Mock()
        candidate = {"id": 12, "title": {"romaji": "Example", "english": None}, "startDate": {"year": 2020},
                     "format": "TV", "idMal": 42}
        body = {"data": {"Page": {"media": [candidate]}}}
        client.fetch.return_value = {"data": body}
        self.assertEqual(resolve(client, "Example", 2020, "TV")["idMal"], 42)
        candidate["idMal"] = None
        with self.assertRaises(ValueError):
            resolve(client, "Example", 2020, "TV")
        candidate["idMal"] = 42
        body["data"]["Page"]["media"].append(candidate)
        with self.assertRaises(ValueError):
            resolve(client, "Example", 2020, "TV")

    @patch("builtins.print")
    def test_complete_probe_with_synthetic_provider_responses(self, print_mock):
        entries = {title: (year, 100 + i) for i, (title, year, _) in enumerate(SERIES)}
        entries["Fate/stay night: Unlimited Blade Works 2nd Season"] = (2015, 105)

        def fetch(url, payload=None):
            if payload:
                title = payload["variables"]["search"]
                year, mal_id = entries[title]
                return {"data": {"data": {"Page": {"media": [{"id": mal_id + 1000, "idMal": mal_id,
                        "title": {"romaji": title, "english": None}, "startDate": {"year": year},
                        "format": "TV"}]}}}}
            if "/episodes?page=" in url:
                return {"data": {"data": [{"mal_id": n} for n in range(1, 13)],
                                 "pagination": {"has_next_page": False}}}
            if "/episodes/" in url:
                number = int(url.rsplit("/", 1)[1])
                return {**response({"mal_id": number, "title": "Synthetic arrival", "synopsis": "Mira meets Sol."}),
                        "url": url}
            if url.endswith("/characters"):
                return {"status": 200, "data": {"data": []}}
            mal_id = int(url.rsplit("/", 1)[1])
            title = next(title for title, (_, id_) in entries.items() if id_ == mal_id)
            return {"status": 200, "data": {"data": {"mal_id": mal_id, "type": "TV", "year": entries[title][0],
                                      "titles": [{"title": title}], "title": title}}}

        with patch.object(Client, "fetch", side_effect=fetch):
            report = run()
        self.assertEqual(report["outcome"], "ready_for_review")
        self.assertEqual(report["metrics"]["valid"], 25)
        self.assertEqual(report["metrics"]["nonempty"], 25)
        self.assertTrue(all(item["repeat_matches"] for item in report["series"]))
        self.assertTrue(all(row["safety"] == "unassessed" for item in report["series"] for row in item["samples"]))

        def unavailable_jikan(url, payload=None):
            return fetch(url, payload) if payload else {"status": None, "data": None, "error": "Network unreachable"}

        with patch.object(Client, "fetch", side_effect=unavailable_jikan):
            incomplete = run()
        self.assertEqual(incomplete["outcome"], "incomplete")
        self.assertEqual(incomplete["metrics"]["attempted"], 0)
        self.assertTrue(all("Jikan media confirmation failed" in item["error"] for item in incomplete["series"]))

    @patch("scripts.jikan_feasibility.time.sleep")
    @patch("scripts.jikan_feasibility.urlopen")
    def test_retry_after_and_transient_failure_recovery(self, opener, sleep):
        success = io.BytesIO(json.dumps({"data": {"mal_id": 1}}).encode())
        success.status = 200
        success.headers = {}
        opener.side_effect = [HTTPError("https://example.test", 429, "Busy", {"Retry-After": "7"}, None),
                              success]
        result = Client().fetch("https://example.test")
        self.assertEqual([row["status"] for row in result["attempts"]], [429, 200])
        sleep.assert_any_call(7)
        self.assertEqual(opener.call_args.kwargs["timeout"], 20)

    @patch("scripts.jikan_feasibility.time.sleep")
    @patch("scripts.jikan_feasibility.urlopen")
    def test_retries_are_bounded_and_permanent_errors_stop(self, opener, sleep):
        for error in [URLError("offline"), HTTPError("https://example.test", 503, "Down", {}, None)]:
            opener.reset_mock()
            opener.side_effect = error
            row = Client().fetch("https://example.test")
            self.assertEqual(len(row["attempts"]), 3)
            self.assertIsNone(row["data"])
        opener.side_effect = HTTPError("https://example.test", 404, "Missing", {}, None)
        self.assertEqual(len(Client().fetch("https://example.test")["attempts"]), 1)
        self.assertEqual(retry_delay("not a date", 2), 4)
        self.assertEqual(retry_delay("-1", 1), 0)


if __name__ == "__main__":
    unittest.main()
