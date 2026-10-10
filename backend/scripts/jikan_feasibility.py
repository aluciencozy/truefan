"""Standalone public-API probe; never imports the production app or writes to Neon."""
import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import json
from pathlib import Path
import statistics
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field, ValidationError

ANILIST = "https://graphql.anilist.co"
JIKAN = "https://api.jikan.moe/v4"
SERIES = [
    ("Fate/stay night: Unlimited Blade Works", 2014, "TV"),
    ("Shingeki no Kyojin", 2013, "TV"),
    ("Steins;Gate", 2011, "TV"),
    ("Death Note", 2006, "TV"),
    ("Odd Taxi", 2021, "TV"),
]
QUERY = """query ($search: String!) {
  Page(perPage: 10) { media(search: $search, type: ANIME) {
    id idMal title { romaji english } format startDate { year } episodes popularity
  } }
}"""


class Episode(BaseModel):
    model_config = ConfigDict(strict=True)
    mal_id: int = Field(gt=0)
    title: str | None = None
    synopsis: str | None = None


class EpisodePage(BaseModel):
    model_config = ConfigDict(strict=True)
    data: list[Episode]
    pagination: dict[str, Any]


class Candidate(BaseModel):
    model_config = ConfigDict(strict=True)
    id: int = Field(gt=0)
    idMal: int | None = Field(default=None, gt=0)
    title: dict[str, str | None]
    startDate: dict[str, int | None]
    format: str
    episodes: int | None = None
    popularity: int | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def retry_delay(value: str | None, attempt: int) -> float:
    if value:
        try:
            return max(0, float(value))
        except ValueError:
            try:
                return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
            except (ValueError, TypeError, OverflowError):
                pass
    return float(2 ** attempt)


class Client:
    def __init__(self) -> None:
        self.last_attempt = 0.0
        self.requests: list[dict[str, Any]] = []

    def fetch(self, url: str, payload: dict[str, Any] | None = None, *,
              accept: str = "application/json") -> dict[str, Any]:
        record: dict[str, Any] = {"url": url, "requested_at": utc_now(), "attempts": [], "data": None}
        self.requests.append(record)
        for attempt in range(1, 4):
            time.sleep(max(0, 2.1 - (time.monotonic() - self.last_attempt)))
            self.last_attempt = time.monotonic()
            headers = {"User-Agent": "TrueFan-feasibility/0.1", "Accept": accept}
            if payload is not None:
                headers["Content-Type"] = "application/json"
            request = Request(url, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
            retry_after = None
            try:
                with urlopen(request, timeout=20) as response:
                    record["status"] = response.status
                    record["final_url"] = getattr(response, "url", url)
                    record["headers"] = {key: response.headers.get(key) for key in
                                         ("ETag", "Last-Modified", "Expires", "X-Request-Fingerprint")}
                    record["data"] = json.load(response)
                    record.pop("error", None)
                record["attempts"].append({"at": utc_now(), "status": record["status"]})
                return record
            except HTTPError as error:
                record["status"] = error.code
                record["error"] = f"HTTP {error.code}"
                retry_after = error.headers.get("Retry-After")
                retryable = error.code == 429 or 500 <= error.code < 600
                error.close()
            except (URLError, TimeoutError, OSError) as error:
                record["status"] = None
                record["error"] = str(error)
                retryable = True
            except (ValueError, UnicodeError) as error:
                record["error"] = f"Invalid JSON: {error}"
                retryable = False
            record["attempts"].append({"at": utc_now(), "status": record.get("status"), "error": record["error"]})
            if not retryable or attempt == 3:
                return record
            time.sleep(retry_delay(retry_after, attempt))
        return record


def resolve(client: Client, title: str, year: int, format_: str) -> dict[str, Any]:
    response = client.fetch(ANILIST, {"query": QUERY, "variables": {"search": title}})
    body = response["data"]
    if not isinstance(body, dict) or body.get("errors"):
        raise ValueError("AniList request failed or returned GraphQL errors")
    candidates = [Candidate.model_validate(entry) for entry in body["data"]["Page"]["media"]]
    matches = [entry for entry in candidates if title in entry.title.values()
               and entry.startDate.get("year") == year and entry.format == format_]
    if len(matches) != 1 or matches[0].idMal is None:
        raise ValueError("No unique title/year/format match with idMal; inspect candidate response")
    return matches[0].model_dump()


def episode_numbers(client: Client, mal_id: int) -> list[int]:
    numbers: set[int] = set()
    # shortcut: cap listings at 20 pages; raise instead of sampling a truncated catalog.
    for page in range(1, 21):
        response = client.fetch(f"{JIKAN}/anime/{mal_id}/episodes?page={page}")
        listing = EpisodePage.model_validate(response["data"])
        numbers.update(episode.mal_id for episode in listing.data)
        has_next = listing.pagination.get("has_next_page")
        if not isinstance(has_next, bool):
            raise ValueError("Missing/invalid pagination.has_next_page")
        if not has_next:
            return sorted(numbers)
    raise ValueError("Episode listing exceeds page cap")


def sample_numbers(numbers: list[int]) -> list[int]:
    if len(numbers) < 5:
        raise ValueError("Fewer than five distinct listed episodes")
    return [numbers[0], numbers[1], numbers[(len(numbers) - 1) // 2], numbers[-2], numbers[-1]]


def normalize(response: dict[str, Any], number: int) -> dict[str, Any]:
    result: dict[str, Any] = {"episode": number, "url": response["url"],
                              "requested_at": response["requested_at"], "status": response.get("status"),
                              "attempts": response["attempts"], "valid": False}
    try:
        if response.get("status") != 200:
            raise ValueError(response.get("error", "Request failed"))
        episode = Episode.model_validate(response["data"]["data"])
        if episode.mal_id != number:
            raise ValueError(f"Episode identity mismatch: received {episode.mal_id}")
        synopsis = episode.synopsis.strip() if episode.synopsis is not None else None
        state = "missing" if "synopsis" not in episode.model_fields_set else (
            "null" if synopsis is None else "nonempty" if synopsis else "empty")
        result.update(valid=True, returned_episode=episode.mal_id, title=episode.title,
                      synopsis=synopsis, synopsis_state=state, characters=len(synopsis or ""),
                      words=len((synopsis or "").split()), safety="unassessed", quality="unassessed",
                      short_synopsis_under_30_words=bool(synopsis) and len(synopsis.split()) < 30)
    except (ValidationError, ValueError, TypeError, KeyError) as error:
        result["validation_error"] = str(error)
    return result


def metrics(samples: list[dict[str, Any]], planned: int) -> dict[str, Any]:
    successful = [row for row in samples if row.get("status") == 200]
    valid = [row for row in samples if row.get("valid")]
    nonempty = [row for row in valid if row["synopsis_state"] == "nonempty"]
    lengths = [row["characters"] for row in nonempty]
    return {"planned": planned, "attempted": len(samples), "http_200": len(successful),
            "valid": len(valid), "nonempty": len(nonempty),
            "fetch_success_percent": 100 * len(successful) / len(samples) if samples else None,
            "nonempty_percent_of_http_200": 100 * len(nonempty) / len(successful) if successful else None,
            "nonempty_percent_of_planned": 100 * len(nonempty) / planned,
            "median_nonempty_characters": statistics.median(lengths) if lengths else None,
            "nonempty_character_range": [min(lengths), max(lengths)] if lengths else None}


def run() -> dict[str, Any]:
    client = Client()
    report: dict[str, Any] = {"started_at": utc_now(), "series": [], "ubw_related_entries": [],
                              "requests": client.requests}
    for title, year, format_ in SERIES:
        item: dict[str, Any] = {"title": title, "year": year, "samples": []}
        report["series"].append(item)
        try:
            entry = resolve(client, title, year, format_)
            item["anilist"] = entry
            mal_id = entry["idMal"]
            metadata = client.fetch(f"{JIKAN}/anime/{mal_id}")
            if metadata.get("status") != 200 or not isinstance(metadata["data"], dict):
                raise ValueError(f"Jikan media confirmation failed: {metadata.get('error', 'Invalid response')}")
            data = metadata["data"]["data"]
            if data["mal_id"] != mal_id or data["type"] != "TV" or data["year"] != year:
                raise ValueError("Jikan media identity/year/format mismatch")
            if not any(name["title"] in entry["title"].values() for name in data["titles"]):
                raise ValueError("Jikan titles do not confirm the AniList entry")
            item["jikan_identity"] = {key: data.get(key) for key in ("mal_id", "title", "year", "type", "episodes")}
            numbers = episode_numbers(client, mal_id)
            item["listed_episodes"] = numbers
            characters = client.fetch(f"{JIKAN}/anime/{mal_id}/characters")
            item["character_catalog_status"] = characters.get("status")
            item["character_catalog_is_episode_evidence"] = False
            for number in sample_numbers(numbers):
                response = client.fetch(f"{JIKAN}/anime/{mal_id}/episodes/{number}")
                item["samples"].append(normalize(response, number))
            repeat = client.fetch(f"{JIKAN}/anime/{mal_id}/episodes/{numbers[0]}")
            repeated = normalize(repeat, numbers[0])
            item["repeat_valid"] = repeated["valid"]
            item["repeat_matches"] = (repeated["valid"] and item["samples"][0]["valid"]
                                       and all(repeated.get(key) == item["samples"][0].get(key)
                                               for key in ("returned_episode", "title", "synopsis")))
            if repeated["valid"]:
                item["repeat_synopsis_sha256"] = hashlib.sha256((repeated["synopsis"] or "").encode()).hexdigest()
        except (ValueError, TypeError, KeyError) as error:
            item["error"] = str(error)
        item["metrics"] = metrics(item["samples"], 5)
        print(json.dumps({"series": title, "metrics": item["metrics"], "error": item.get("error")}), flush=True)
    # AniList includes the prologue in the first TV entry; do not invent a separate AniList ID.
    report["ubw_prologue_note"] = "Check provider episode titles/numbering: AniList includes the prologue in the first TV entry."
    for title, year, format_ in [("Fate/stay night: Unlimited Blade Works 2nd Season", 2015, "TV")]:
        try:
            report["ubw_related_entries"].append(resolve(client, title, year, format_))
        except (ValueError, TypeError, KeyError) as error:
            report["ubw_related_entries"].append({"title": title, "year": year, "format": format_, "error": str(error)})
    report["metrics"] = metrics([row for item in report["series"] for row in item["samples"]], 25)
    report["outcome"] = "ready_for_review" if (report["metrics"]["valid"] == 25
                        and all(item.get("repeat_valid") for item in report["series"])) else "incomplete"
    report["finished_at"] = utc_now()
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/tmp/truefan-jikan-results.json"))
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error("Use an output outside the repository; responses may contain copyrighted story text.")
    report = run()
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"output": str(output), "metrics": report["metrics"], "outcome": report["outcome"]}))
    return 0 if report["outcome"] == "ready_for_review" else 1


if __name__ == "__main__":
    raise SystemExit(main())
