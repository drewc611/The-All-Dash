"""One polite HTTP client for everything the web tier reads.

Every request goes through the SSRF guard (including each redirect hop),
respects robots.txt, waits its turn per host, stops reading at a size cap and
gives up on a timeout. The transport is injectable so the test suite can put
a fake site behind it.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

import httpx

from .guard import BlockedUrl, check_url, normalise
from .sitemap import Robots, parse_robots

MAX_REDIRECTS = 5


@dataclass
class Fetched:
    url: str
    final_url: str
    status: int
    content_type: str
    body: bytes
    elapsed_ms: int
    headers: dict[str, str] = field(default_factory=dict)

    @property
    def text(self) -> str:
        charset = "utf-8"
        if "charset=" in self.content_type:
            charset = self.content_type.split("charset=", 1)[1].split(";", 1)[0].strip().strip('"') or "utf-8"
        try:
            return self.body.decode(charset, errors="replace")
        except LookupError:
            return self.body.decode("utf-8", errors="replace")

    @property
    def is_html(self) -> bool:
        return "html" in self.content_type or "xml" in self.content_type and b"<html" in self.body[:2048].lower()


class FetchError(Exception):
    """A fetch that did not produce a page: blocked, refused by robots, too big, unreachable."""


class _HostGate:
    """At most one request per host per `interval` seconds."""

    def __init__(self, interval: float) -> None:
        self.interval = interval
        self._next: dict[str, float] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def wait(self, host: str, interval: float | None = None) -> None:
        lock = self._locks.setdefault(host, asyncio.Lock())
        async with lock:
            gap = interval if interval is not None else self.interval
            now = time.monotonic()
            due = self._next.get(host, 0.0)
            if due > now:
                await asyncio.sleep(due - now)
                now = time.monotonic()
            self._next[host] = now + gap


class Fetcher:
    def __init__(
        self,
        *,
        user_agent: str,
        timeout: float = 20.0,
        max_bytes: int = 5 * 1024 * 1024,
        per_host_interval: float = 0.5,
        respect_robots: bool = True,
        allow_private: bool = False,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.user_agent = user_agent
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.respect_robots = respect_robots
        self.allow_private = allow_private
        self._gate = _HostGate(per_host_interval)
        self._robots: dict[str, Robots] = {}
        self._client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(timeout),
            follow_redirects=False,
            headers={
                "user-agent": user_agent,
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def robots(self, url: str) -> Robots:
        """The robots.txt for the URL's origin, fetched once per origin."""
        checked = await check_url(url, allow_private=self.allow_private)
        origin = f"{checked.scheme}://{checked.host}"
        if origin in self._robots:
            return self._robots[origin]
        rules = Robots()
        try:
            await self._gate.wait(checked.host)
            response = await self._client.get(f"{origin}/robots.txt")
            if response.status_code == 200 and len(response.content) < 512 * 1024:
                rules = parse_robots(response.text, origin, agent="alldash")
        except httpx.HTTPError:
            pass
        self._robots[origin] = rules
        return rules

    async def get(self, url: str, *, accept: str | None = None) -> Fetched:
        """GET with guarded redirects, robots and the size cap."""
        started = time.perf_counter()
        current = normalise(url)
        for _ in range(MAX_REDIRECTS + 1):
            try:
                checked = await check_url(current, allow_private=self.allow_private)
            except BlockedUrl as exc:
                raise FetchError(str(exc)) from exc
            rules = await self.robots(checked.url) if self.respect_robots else Robots()
            if self.respect_robots and not rules.allows(checked.url):
                raise FetchError(f"robots.txt disallows {checked.url}")
            await self._gate.wait(checked.host, rules.crawl_delay)
            headers = {"accept": accept} if accept else {}
            try:
                async with self._client.stream("GET", checked.url, headers=headers) as response:
                    if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                        current = (
                            httpx.URL(checked.url).join(response.headers["location"]).copy_with(fragment=None).__str__()
                        )
                        continue
                    declared = response.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > self.max_bytes:
                        raise FetchError(f"{checked.url} is {int(declared)} bytes, over the {self.max_bytes} byte cap")
                    chunks: list[bytes] = []
                    size = 0
                    async for chunk in response.aiter_bytes():
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise FetchError(f"{checked.url} exceeds the {self.max_bytes} byte cap")
                        chunks.append(chunk)
                    return Fetched(
                        url=normalise(url),
                        final_url=checked.url,
                        status=response.status_code,
                        content_type=response.headers.get("content-type", "").lower(),
                        body=b"".join(chunks),
                        elapsed_ms=int((time.perf_counter() - started) * 1000),
                        headers={
                            k: v
                            for k, v in response.headers.items()
                            if k in ("last-modified", "etag", "content-language")
                        },
                    )
            except httpx.TimeoutException as exc:
                raise FetchError(f"{checked.url} timed out after {self.timeout:.0f}s") from exc
            except httpx.HTTPError as exc:
                raise FetchError(f"{checked.url}: {exc.__class__.__name__}") from exc
        raise FetchError(f"{url}: too many redirects")
