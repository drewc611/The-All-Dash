"""Firecrawl, when a key is set: search, JavaScript rendering, screenshots.

Only the parts the native path cannot do are routed here. The client is a
thin, typed wrapper over the v1 REST API; nothing is cached.
"""

from __future__ import annotations

from typing import Any

import httpx


class FirecrawlError(Exception):
    pass


class Firecrawl:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.firecrawl.dev",
        *,
        timeout: float = 60.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            transport=transport,
            timeout=httpx.Timeout(timeout),
            headers={"authorization": f"Bearer {api_key}", "content-type": "application/json"},
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        try:
            response = await self._client.post(f"{self.base_url}{path}", json=body)
        except httpx.HTTPError as exc:
            raise FirecrawlError(f"Firecrawl unreachable: {exc.__class__.__name__}") from exc
        data: dict[str, Any] = {}
        try:
            data = response.json()
        except ValueError:
            pass
        if response.status_code >= 400 or data.get("success") is False:
            raise FirecrawlError(f"Firecrawl {response.status_code}: {data.get('error') or response.text[:200]}")
        return data

    async def _get(self, path: str) -> dict[str, Any]:
        try:
            response = await self._client.get(f"{self.base_url}{path}")
        except httpx.HTTPError as exc:
            raise FirecrawlError(f"Firecrawl unreachable: {exc.__class__.__name__}") from exc
        if response.status_code >= 400:
            raise FirecrawlError(f"Firecrawl {response.status_code}: {response.text[:200]}")
        return response.json()

    async def search(self, query: str, *, limit: int = 5, scrape: bool = True) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"query": query, "limit": limit}
        if scrape:
            body["scrapeOptions"] = {"formats": ["markdown"]}
        data = await self._post("/v1/search", body)
        out: list[dict[str, Any]] = []
        for item in data.get("data") or []:
            out.append(
                {
                    "url": item.get("url") or item.get("metadata", {}).get("sourceURL") or "",
                    "title": item.get("title") or item.get("metadata", {}).get("title") or "",
                    "description": item.get("description") or item.get("metadata", {}).get("description") or "",
                    "markdown": item.get("markdown") or "",
                }
            )
        return out

    async def scrape(self, url: str, *, formats: list[str], wait_ms: int = 0) -> dict[str, Any]:
        body: dict[str, Any] = {"url": url, "formats": formats}
        if wait_ms:
            body["waitFor"] = wait_ms
        data = await self._post("/v1/scrape", body)
        item = data.get("data") or {}
        meta = item.get("metadata") or {}
        return {
            "url": meta.get("sourceURL") or url,
            "title": meta.get("title") or "",
            "description": meta.get("description") or "",
            "markdown": item.get("markdown") or "",
            "html": item.get("html") or "",
            "links": item.get("links") or [],
            "screenshot": item.get("screenshot") or "",
            "status": int(meta.get("statusCode") or 200),
        }

    async def map(self, url: str, *, limit: int, search: str | None = None) -> list[str]:
        body: dict[str, Any] = {"url": url, "limit": limit}
        if search:
            body["search"] = search
        data = await self._post("/v1/map", body)
        return [str(u) for u in data.get("links") or []]
