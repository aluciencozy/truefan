"""Live smoke test for the TrueFan API. Stdlib only.

Usage: python backend/scripts/smoke_api.py [base_url]
Set TRUEFAN_TEST_JWT to also exercise the authenticated routes (the token is never printed).
"""
import json
import os
import sys
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")
ORIGIN = "http://localhost:3000"
MEDIA = "lantern-harbor"
EXPECTED = {
    0: ([], []),
    1: (["mira", "sol", "harbor"], ["friends", "visits"]),
    2: (["mira", "sol", "harbor", "keepers"], ["friends", "visits", "maintains", "joins"]),
    3: (["mira", "sol", "harbor", "keepers", "compass"],
        ["friends", "visits", "maintains", "joins", "finds"]),
}
failures = 0


def call(method: str, path: str, headers: dict | None = None, body: object = None):
    """Return (status, lowercase-header dict, parsed JSON or None)."""
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    if data is not None:
        request.add_header("Content-Type", "application/json")
    try:
        response = urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    raw = response.read()
    try:
        parsed = json.loads(raw) if raw else None
    except ValueError:
        parsed = None
    return response.status if hasattr(response, "status") else response.code, \
        {k.lower(): v for k, v in response.headers.items()}, parsed


def check(name: str, ok: bool, detail: str = "") -> None:
    global failures
    failures += 0 if ok else 1
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  -> ' + detail if detail and not ok else ''}")


def expect_status(name: str, method: str, path: str, status: int, **kwargs):
    code, headers, body = call(method, path, **kwargs)
    check(f"{name} [{method} {path.split('?')[0]}] == {status}", code == status, f"got {code}")
    return code, headers, body


def has_media_shape(item: object) -> bool:
    keys = {"id", "title", "type", "progress_unit", "total_units", "description", "anilist_id"}
    return isinstance(item, dict) and keys <= item.keys()


def check_graph(progress: int, body: dict) -> None:
    ids = [e["id"] for e in body["entities"]]
    edge_ids = [r["id"] for r in body["relationships"]]
    want_entities, want_edges = EXPECTED[progress]
    check(f"progress={progress} entity ids", sorted(ids) == sorted(want_entities), str(ids))
    check(f"progress={progress} relationship ids", sorted(edge_ids) == sorted(want_edges), str(edge_ids))
    check(f"progress={progress} reveal <= progress",
          all(x["revealed_at"]["unit"] <= progress for x in body["entities"] + body["relationships"]))
    check(f"progress={progress} edge endpoints visible",
          all(r["source"] in ids and r["target"] in ids for r in body["relationships"]))
    check(f"progress={progress} no duplicate ids", len(ids) == len(set(ids)) and len(edge_ids) == len(set(edge_ids)))
    check(f"progress={progress} echoes progress/media_id",
          body["progress"] == {"unit": progress} and body["media_id"] == MEDIA)


def check_spoilers() -> None:
    # Hidden names/descriptions must not appear anywhere in the serialized JSON.
    all_entities = call("GET", f"/api/media/{MEDIA}/graph?progress=3")[2]["entities"]
    for progress in range(0, 3):
        text = json.dumps(call("GET", f"/api/media/{MEDIA}/graph?progress={progress}")[2])
        leaked = [e["id"] for e in all_entities if e["revealed_at"]["unit"] > progress
                  and (e["name"] in text or e["description"] in text or f'"{e["id"]}"' in text)]
        check(f"progress={progress} no spoiler leak", not leaked, f"leaked {leaked}")


def check_cors() -> None:
    for label, headers in [
        ("GET preflight", {"Origin": ORIGIN, "Access-Control-Request-Method": "GET"}),
        ("PUT preflight", {"Origin": ORIGIN, "Access-Control-Request-Method": "PUT",
                           "Access-Control-Request-Headers": "authorization,content-type"}),
    ]:
        code, resp, _ = call("OPTIONS", f"/api/me/progress/{MEDIA}", headers=headers)
        check(f"CORS {label} allows origin", code == 200 and resp.get("access-control-allow-origin") == ORIGIN,
              f"status={code} allow-origin={resp.get('access-control-allow-origin')} (is FRONTEND_URL={ORIGIN}?)")


def auth_label(code: int) -> str:
    return {401: "auth rejected", 503: "auth not configured"}.get(code, f"unexpected {code}")


def check_auth_without_token() -> None:
    for method, path, body in [("GET", "/api/me", None), ("GET", f"/api/me/progress/{MEDIA}", None),
                               ("PUT", f"/api/me/progress/{MEDIA}", {"unit": 1})]:
        code, _, _ = call(method, path, body=body)
        # No token: 401 when Neon Auth is configured, 503 when NEON_AUTH_BASE_URL is empty. Both are expected.
        check(f"no token [{method} {path}] -> {code} ({auth_label(code)})", code in (401, 503))
    code, _, _ = call("GET", "/api/me", headers={"Authorization": "Bearer abc"})
    check(f"malformed token -> {code} ({auth_label(code)}), never 500", code in (401, 503))


def check_auth_with_token(token: str) -> None:
    auth = {"Authorization": f"Bearer {token}"}
    code, _, body = call("GET", "/api/me", headers=auth)
    check("authed GET /api/me == 200 with id", code == 200 and bool(body and body.get("id")), f"got {code} ({auth_label(code)})")
    path = f"/api/me/progress/{MEDIA}"
    code, _, body = call("PUT", path, headers=auth, body={"unit": 2})
    check("authed PUT progress unit=2 == 200", code == 200 and body == {"media_id": MEDIA, "progress": {"unit": 2}}, f"got {code}")
    code, _, body = call("GET", path, headers=auth)
    check("authed GET progress round-trips unit=2", code == 200 and body == {"media_id": MEDIA, "progress": {"unit": 2}}, f"got {code}")
    code, _, _ = call("PUT", path, headers=auth, body={"unit": 99})
    check("authed PUT unit=99 == 422", code == 422, f"got {code}")


def main() -> int:
    print(f"Smoke testing {BASE}\n")
    code, _, body = expect_status("health", "GET", "/health", 200)
    check("health body", body == {"status": "ok", "mode": "demo"})

    _, _, body = expect_status("search match", "GET", "/api/media/search?q=lantern", 200)
    # Search merges the demo with live AniList results, so assert inclusion and shape, not exact length.
    check("search returns Media[] including the demo",
          isinstance(body, list) and all(has_media_shape(m) for m in body) and MEDIA in [m.get("id") for m in body])
    _, _, body = expect_status("search case-insensitive", "GET", "/api/media/search?q=LANTERN%20harbor", 200)
    check("search case-insensitive finds the demo", MEDIA in [m.get("id") for m in body])
    _, _, body = expect_status("search unlikely query", "GET", "/api/media/search?q=zzzzqqxx", 200)
    check("search unlikely query excludes the demo", isinstance(body, list) and MEDIA not in [m.get("id") for m in body])
    expect_status("search q=200 chars", "GET", "/api/media/search?q=" + "a" * 200, 200)
    expect_status("search q=201 chars", "GET", "/api/media/search?q=" + "a" * 201, 422)

    _, _, body = expect_status("media details", "GET", f"/api/media/{MEDIA}", 200)
    check("media shape", has_media_shape(body) and body["total_units"] == 3)
    expect_status("media unknown", "GET", "/api/media/nope", 404)

    for progress in range(0, 4):
        code, _, body = expect_status(f"graph progress={progress}", "GET", f"/api/media/{MEDIA}/graph?progress={progress}", 200)
        if code == 200:
            check_graph(progress, body)
    check_spoilers()
    expect_status("graph progress=4 (> total)", "GET", f"/api/media/{MEDIA}/graph?progress=4", 422)
    expect_status("graph progress missing", "GET", f"/api/media/{MEDIA}/graph", 422)
    expect_status("graph progress=-1", "GET", f"/api/media/{MEDIA}/graph?progress=-1", 422)
    expect_status("graph progress=abc", "GET", f"/api/media/{MEDIA}/graph?progress=abc", 422)
    expect_status("graph progress=1.5", "GET", f"/api/media/{MEDIA}/graph?progress=1.5", 422)
    expect_status("graph unknown media", "GET", "/api/media/nope/graph?progress=1", 404)

    good = {"media_id": MEDIA, "summary": "s", "source": "s", "reveal_point": {"unit": 1}}
    _, _, body = expect_status("extract placeholder", "POST", "/api/extract", 501, body=good)
    check("extract body is not_implemented", bool(body) and body.get("status") == "not_implemented")
    expect_status("extract bad body", "POST", "/api/extract", 422, body={"media_id": MEDIA})
    expect_status("extract unknown media", "POST", "/api/extract", 404, body={**good, "media_id": "nope"})
    ask = {"media_id": MEDIA, "progress": {"unit": 1}, "question": "who?"}
    _, _, body = expect_status("ask placeholder", "POST", "/api/ask", 501, body=ask)
    check("ask body is not_implemented", bool(body) and body.get("status") == "not_implemented")
    expect_status("ask bad body", "POST", "/api/ask", 422, body={"media_id": MEDIA})
    expect_status("ask unknown media", "POST", "/api/ask", 404, body={**ask, "media_id": "nope"})

    check_cors()
    check_auth_without_token()
    token = os.environ.get("TRUEFAN_TEST_JWT", "")
    if token:
        check_auth_with_token(token)
    else:
        print("SKIP  authenticated routes: TRUEFAN_TEST_JWT is not set (needs a Neon Auth JWT from .token())")

    print(f"\n{'ALL CHECKS PASSED' if not failures else f'{failures} CHECK(S) FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
