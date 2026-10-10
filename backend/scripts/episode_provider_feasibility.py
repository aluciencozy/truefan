"""Compare Kitsu and TVmaze episode text without changing production services."""
import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from typing import Any
from urllib.parse import urlencode, urlparse

from pydantic import BaseModel, ConfigDict, Field

try:
    from scripts.jikan_feasibility import Client, SERIES, metrics, resolve, sample_numbers, utc_now
except ModuleNotFoundError:
    from jikan_feasibility import Client, SERIES, metrics, resolve, sample_numbers, utc_now

KITSU = "https://kitsu.app/api/edge"
TVMAZE = "https://api.tvmaze.com"
JSON_API = "application/vnd.api+json"


class KitsuEpisode(BaseModel):
    model_config = ConfigDict(strict=True)
    number: int = Field(ge=0)
    seasonNumber: int | None = None
    canonicalTitle: str | None = None
    airdate: str | None = None
    description: str | None = None
    synopsis: str | None = None


class TVmazeEpisode(BaseModel):
    model_config = ConfigDict(strict=True)
    id: int = Field(gt=0)
    season: int = Field(gt=0)
    number: int | None = Field(default=None, ge=0)
    name: str | None = None
    airdate: str | None = None
    summary: str | None = None


class PlainText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag in ("p", "br", "div"):
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("p", "div"):
            self.parts.append(" ")


def plain_text(text: str | None) -> str | None:
    if text is None:
        return None
    parser = PlainText()
    parser.feed(text)
    return " ".join("".join(parser.parts).split())


def title_key(title: str) -> str:
    return re.sub(r"\W+", "", title.casefold())


def body(response: dict[str, Any]) -> Any:
    if response.get("status") != 200 or response["data"] is None:
        raise ValueError(f"Request failed: {response['url']}: {response.get('error', 'invalid response')}")
    return response["data"]


def kitsu_pages(client: Client, url: str) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()
    for _ in range(20):
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in ("kitsu.app", "kitsu.io") or url in seen:
            raise ValueError("Invalid or cyclic Kitsu pagination URL")
        seen.add(url)
        page = body(client.fetch(url, accept=JSON_API))
        if not isinstance(page.get("data"), list) or not isinstance(page.get("links"), dict):
            raise ValueError("Malformed Kitsu collection")
        # Search pages can overlap; the same resource ID is not a second adaptation.
        rows.update({row["id"]: row for row in page["data"]})
        url = page["links"].get("next")
        if url is None:
            return list(rows.values())
        if not isinstance(url, str):
            raise ValueError("Invalid Kitsu next link")
    raise ValueError("Kitsu pagination exceeds 20-page cap")


def match_kitsu(client: Client, entry: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    title = entry["title"]["romaji"] or entry["title"]["english"]
    url = KITSU + "/anime?" + urlencode({"filter[text]": title, "page[limit]": 20})
    candidates = kitsu_pages(client, url)
    matches = []
    keys = {title_key(value) for value in entry["title"].values() if value}
    for candidate in candidates:
        attrs = candidate["attributes"]
        if (attrs.get("subtype") != "TV" or not attrs.get("startDate", "").startswith(str(entry["startDate"]["year"]))
                or not keys.intersection(title_key(value) for value in attrs["titles"].values() if value)):
            continue
        mappings = kitsu_pages(client, f"{KITSU}/anime/{candidate['id']}/mappings?page%5Blimit%5D=20")
        ids = {row["attributes"]["externalSite"]: row["attributes"]["externalId"] for row in mappings}
        expected = {"anilist/anime": str(entry["id"]), "myanimelist/anime": str(entry["idMal"])}
        if any(ids[key] != value for key, value in expected.items() if key in ids):
            continue
        if any(ids.get(key) == value for key, value in expected.items()):
            matches.append((candidate, mappings))
    if len(matches) != 1:
        raise ValueError(f"No unique ID-verified Kitsu adaptation match ({len(matches)} matches)")
    return matches[0]


def match_tvmaze(client: Client, entry: dict[str, Any], mappings: list[dict[str, Any]]) -> tuple[dict[str, Any], int, str]:
    ids = {row["attributes"]["externalSite"]: row["attributes"]["externalId"] for row in mappings}
    tvdb = ids.get("thetvdb/series")
    season_hint = ids.get("thetvdb", "").split("/")
    if len(season_hint) == 2 and tvdb and season_hint[0] != tvdb:
        raise ValueError("Conflicting TVDB series and season mapping")
    season = int(season_hint[1]) if len(season_hint) == 2 and season_hint[1].isdigit() else 1
    if tvdb and tvdb.isdigit():
        response = client.fetch(TVMAZE + "/lookup/shows?" + urlencode({"thetvdb": tvdb}))
        if response.get("status") == 200:
            show = body(response)
            if show.get("type") != "Animation" or str(show["externals"].get("thetvdb")) != tvdb:
                raise ValueError("TVmaze lookup returned conflicting external ID or format")
            return show, season, "Kitsu MAL/AniList mapping -> TVDB series -> TVmaze external ID"
        if response.get("status") != 404:
            body(response)
    keys = {title_key(value) for value in entry["title"].values() if value}
    shows = []
    for title in dict.fromkeys(value for value in (entry["title"]["english"], entry["title"]["romaji"]) if value):
        candidates = body(client.fetch(TVMAZE + "/search/shows?" + urlencode({"q": title})))
        shows = [row["show"] for row in candidates if row["show"].get("type") == "Animation"
                 and title_key(row["show"]["name"]) in keys
                 and (row["show"].get("premiered") or "").startswith(str(entry["startDate"]["year"]))
                 and row["show"].get("language") == "Japanese"]
        if shows:
            break
    if len(shows) != 1:
        raise ValueError(f"No unique TVmaze title/year/animation/language match ({len(shows)} matches)")
    return shows[0], 1, "Title + premiere year + Animation + Japanese; no cross-database ID verification"


def normalize(provider: str, response: dict[str, Any], expected: dict[str, Any]) -> dict[str, Any]:
    row: dict[str, Any] = {"provider": provider, "url": response["url"], "requested_at": response["requested_at"],
                           "status": response.get("status"), "attempts": response["attempts"], "valid": False}
    try:
        data = body(response)
        if provider == "kitsu":
            resource = data["data"]
            episode = KitsuEpisode.model_validate(resource["attributes"])
            if (resource["id"] != expected["id"] or episode.number != expected["attributes"]["number"]
                    or episode.seasonNumber != expected["attributes"].get("seasonNumber")):
                raise ValueError("Kitsu episode identity/number/season mismatch")
            attrs = resource["attributes"]
            field = "description" if episode.description else "synopsis" if episode.synopsis else (
                "description" if "description" in attrs else "synopsis")
            raw = attrs.get(field)
            present = field in attrs
            number, season, title, airdate = episode.number, episode.seasonNumber, episode.canonicalTitle, episode.airdate
            episode_id = resource["id"]
        else:
            episode = TVmazeEpisode.model_validate(data)
            if (episode.id, episode.season, episode.number) != (expected["id"], expected["season"], expected["number"]):
                raise ValueError("TVmaze episode identity/number/season mismatch")
            raw, present, field = episode.summary, "summary" in data, "summary"
            number, season, title, airdate, episode_id = episode.number, episode.season, episode.name, episode.airdate, episode.id
        text = plain_text(raw)
        state = "missing" if not present else "null" if text is None else "nonempty" if text else "empty"
        row.update(valid=True, episode_id=episode_id, episode=number, season=season, title=title, airdate=airdate,
                   source_field=field, synopsis=text, synopsis_state=state, characters=len(text or ""),
                   words=len((text or "").split()), safety="unassessed", quality="unassessed")
    except (ValueError, KeyError, TypeError) as error:
        row["validation_error"] = str(error)
    return row


def collect(client: Client, provider: str, episodes: list[dict[str, Any]], result: dict[str, Any]) -> None:
    numbered = {}
    for item in episodes:
        number = item["attributes"]["number"] if provider == "kitsu" else item["number"]
        if number is not None and number > 0:
            if number in numbered:
                raise ValueError("Duplicate episode numbers in selected work/season")
            numbered[number] = item
    numbers = sorted(numbered)
    result["listed_numbers"] = numbers
    if len(numbers) < 3:
        raise ValueError("Fewer than three numbered episodes available")
    samples = sample_numbers(numbers) if len(numbers) >= 5 else numbers
    for number in samples:
        expected = numbered[number]
        url = f"{KITSU if provider == 'kitsu' else TVMAZE}/episodes/{expected['id']}"
        response = client.fetch(url, accept=JSON_API if provider == "kitsu" else "application/json")
        result["samples"].append(normalize(provider, response, expected))
    result["state"] = "sampled" if all(row["valid"] for row in result["samples"]) else "partial"


def run(output: Path) -> dict[str, Any]:
    client = Client()
    report: dict[str, Any] = {"started_at": utc_now(), "series": [], "requests": client.requests}
    for title, year, format_ in SERIES:
        item: dict[str, Any] = {"title": title, "kitsu": {"samples": []}, "tvmaze": {"samples": []}}
        report["series"].append(item)
        try:
            entry = resolve(client, title, year, format_)
            item["anilist"] = entry
        except (ValueError, TypeError, KeyError) as error:
            item["resolution_error"] = str(error)
            continue
        mappings = []
        for provider in ("kitsu", "tvmaze"):
            result = item[provider]
            first_request = len(client.requests)
            try:
                if provider == "kitsu":
                    media, mappings = match_kitsu(client, entry)
                    result["media"] = {"id": media["id"], "attributes": {key: media["attributes"].get(key)
                                       for key in ("titles", "startDate", "subtype", "episodeCount")}}
                    result["mappings"] = [row["attributes"] for row in mappings]
                    episodes = kitsu_pages(client, f"{KITSU}/anime/{media['id']}/episodes?page%5Blimit%5D=20")
                else:
                    media, season, evidence = match_tvmaze(client, entry, mappings)
                    result["media"] = {key: media.get(key) for key in ("id", "name", "premiered", "type", "externals")}
                    result.update(selected_season=season, match_evidence=evidence)
                    all_episodes = body(client.fetch(f"{TVMAZE}/shows/{media['id']}/episodes?specials=1"))
                    episodes = [row for row in all_episodes if row["season"] == season]
                    result["specials"] = [{key: row.get(key) for key in ("id", "season", "number", "name", "airdate")}
                                           for row in all_episodes if row["number"] is None]
                    result["total_show_episodes_including_specials"] = len(all_episodes)
                collect(client, provider, episodes, result)
            except (ValueError, TypeError, KeyError, AttributeError) as error:
                result["error"] = str(error)
                failures = [row for row in client.requests[first_request:] if row.get("status") is None
                            or row["status"] in (401, 403, 429) or row["status"] >= 500]
                result["state"] = "access_failed" if failures else (
                    "match_or_data_unavailable" if str(error).startswith(("No unique", "Fewer than three"))
                    else "provider_or_alignment_error")
            result["metrics"] = metrics(result["samples"], 5)
            print(json.dumps({"series": title, "provider": provider, "state": result["state"], "metrics": result["metrics"]}), flush=True)
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    report["metrics"] = {provider: metrics([row for item in report["series"] for row in item[provider]["samples"]], 25)
                         for provider in ("kitsu", "tvmaze")}
    report["finished_at"] = utc_now()
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/tmp/truefan-episode-provider-results.json"))
    args = parser.parse_args()
    output = args.output.resolve()
    if output.is_relative_to(Path(__file__).resolve().parents[2]):
        parser.error("Use an output outside the repository; responses contain copyrighted story text.")
    report = run(output)
    print(json.dumps({"output": str(output), "metrics": report["metrics"]}))
    return 1 if any(item.get("resolution_error") or item[provider].get("state") in
                   ("access_failed", "provider_or_alignment_error", "partial")
                    for item in report["series"] for provider in ("kitsu", "tvmaze")) else 0


if __name__ == "__main__":
    raise SystemExit(main())
