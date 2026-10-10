"""Bounded provider HTTP; shared throttling prevents request storms."""
import json
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_lock = threading.Lock()
_last: dict[str, float] = {}


def fetch(url: str, payload: dict | None = None, *, headers: dict | None = None,
          provider: str = 'anilist', retries: int = 2, timeout: int = 20) -> dict:
    for attempt in range(retries + 1):
        with _lock:
            interval = 2.1 if provider == 'kitsu' else 0.8
            time.sleep(max(0, interval - (time.monotonic() - _last.get(provider, 0))))
            _last[provider] = time.monotonic()
        request = Request(url, data=json.dumps(payload).encode() if payload else None,
                          headers={'User-Agent': 'TrueFan/0.2 episode-graph-prototype',
                                   'Accept': 'application/json', 'Content-Type': 'application/json', **(headers or {})})
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except HTTPError as error:
            retry = error.code == 429 or error.code >= 500
            delay = error.headers.get('Retry-After', '')
            error.close()
            if not retry or attempt == retries:
                raise ValueError(f'{provider} HTTP {error.code}') from None
            if delay.isdigit() and int(delay) > 30:
                raise ValueError(f'{provider} rate limited; retry later')
            time.sleep(float(delay) if delay.isdigit() else 2 ** (attempt + 1))
        except (URLError, TimeoutError, OSError):
            if attempt == retries:
                raise ValueError(f'{provider} request unavailable') from None
            time.sleep(2 ** (attempt + 1))
    raise ValueError('Provider unavailable')
