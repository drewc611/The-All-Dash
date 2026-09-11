"""The seven operations, on top of the fetcher, Firecrawl and the model.

scrape   one URL to Markdown, HTML, text, links or a screenshot
map      every URL a site publishes: its sitemaps, then the links off the front page
crawl    breadth-first over one site, bounded by pages, depth and path patterns
batch    many URLs, a few at a time
search   the web, through Firecrawl (the native path has no search engine)
extract  scrape, then ask the model for JSON that fits a prompt or a schema
agent    describe what you need: map or search, pick the pages, scrape, extract

Everything native is deterministic and free. Firecrawl and the model are
used only where named, and their absence is reported, not hidden.
"""

from __future__ import annotations

import asyncio
import fnmatch
import re
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from .fetch import Fetched, Fetcher, FetchError
from .firecrawl import Firecrawl
from .guard import BlockedUrl, check_url, match_path, normalise, same_site
from .html import parse_html
from .llm import Llm
from .llm import extract as llm_extract
from .sitemap import parse_sitemap

FORMATS = ("markdown", "html", "text", "links", "screenshot")
STOP = frozenset(
    "a an and are as at be by for from how in is it of on or that the this to what when where which who with".split()
)


class NotAvailable(Exception):
    """An operation that needs Firecrawl or a model, and neither is configured."""


@dataclass
class Page:
    url: str
    final_url: str
    status: int
    title: str = ""
    description: str = ""
    language: str = ""
    markdown: str = ""
    html: str | None = None
    text: str | None = None
    links: list[str] | None = None
    screenshot: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)
    engine: str = "native"
    fetched_ms: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "url": self.url,
            "final_url": self.final_url,
            "status": self.status,
            "title": self.title,
            "description": self.description,
            "language": self.language,
            "markdown": self.markdown,
            "html": self.html,
            "text": self.text,
            "links": self.links,
            "screenshot": self.screenshot,
            "metadata": self.metadata,
            "engine": self.engine,
            "fetched_ms": self.fetched_ms,
        }


@dataclass
class Limits:
    max_pages: int = 200
    sync_max_pages: int = 25
    concurrency: int = 4


class WebService:
    def __init__(
        self,
        fetcher: Fetcher,
        *,
        firecrawl: Firecrawl | None = None,
        llm: Llm | None = None,
        limits: Limits | None = None,
    ) -> None:
        self.fetcher = fetcher
        self.firecrawl = firecrawl
        self.llm = llm
        self.limits = limits or Limits()
        self.budget_seconds = 60.0

    async def aclose(self) -> None:
        await self.fetcher.aclose()
        if self.firecrawl:
            await self.firecrawl.aclose()
        if self.llm:
            await self.llm.aclose()

    def capabilities(self) -> dict[str, Any]:
        return {
            "native": ["scrape", "map", "crawl", "batch"],
            "firecrawl": bool(self.firecrawl),
            "search": bool(self.firecrawl),
            "render": bool(self.firecrawl),
            "screenshot": bool(self.firecrawl),
            "model": self.llm.config.model if self.llm and self.llm.config.configured else None,
            "extract": bool(self.llm and self.llm.config.configured),
            "agent": bool(self.llm and self.llm.config.configured),
            "limits": {"max_pages": self.limits.max_pages, "sync_max_pages": self.limits.sync_max_pages},
        }

    # ------------------------------------------------------------ scrape

    async def scrape(
        self, url: str, *, formats: tuple[str, ...] = ("markdown",), render: bool = False, wait_ms: int = 0
    ) -> Page:
        wants = set(formats) or {"markdown"}
        if render or "screenshot" in wants:
            if not self.firecrawl:
                raise NotAvailable("JavaScript rendering and screenshots need Firecrawl: set ALLDASH_FIRECRAWL_API_KEY")
            fc_formats = [f for f in ("markdown", "html", "links", "screenshot") if f in wants or f == "markdown"]
            # The same guard as the native path: a self-hosted Firecrawl inside
            # the cluster must not be a way around it.
            checked = await check_url(url, allow_private=self.fetcher.allow_private)
            item = await self.firecrawl.scrape(checked.url, formats=fc_formats, wait_ms=wait_ms)
            parsed = parse_html(item["html"], item["url"]) if item.get("html") else None
            return Page(
                url=normalise(url),
                final_url=item["url"],
                status=item["status"],
                title=item["title"] or (parsed.title if parsed else ""),
                description=item["description"],
                markdown=item["markdown"],
                html=item["html"] if "html" in wants else None,
                text=(parsed.text if parsed else re.sub(r"\s+", " ", item["markdown"]).strip())
                if "text" in wants
                else None,
                links=item["links"] if "links" in wants else None,
                screenshot=item["screenshot"] if "screenshot" in wants else None,
                engine="firecrawl",
            )
        fetched = await self.fetcher.get(url)
        return self._page_from(fetched, wants)

    def _page_from(self, fetched: Fetched, wants: set[str]) -> Page:
        if fetched.is_html:
            parsed = parse_html(fetched.text, fetched.final_url)
            return Page(
                url=fetched.url,
                final_url=fetched.final_url,
                status=fetched.status,
                title=parsed.title,
                description=parsed.description,
                language=parsed.language,
                markdown=parsed.markdown,
                html=fetched.text if "html" in wants else None,
                text=parsed.text if "text" in wants else None,
                links=parsed.links if "links" in wants else None,
                metadata=parsed.metadata,
                fetched_ms=fetched.elapsed_ms,
            )
        # Not HTML: plain text, JSON, XML or Markdown served as-is.
        body = (
            fetched.text
            if fetched.content_type.startswith(
                ("text/", "application/json", "application/xml", "application/javascript")
            )
            or not fetched.content_type
            else ""
        )
        if not body:
            raise FetchError(f"{fetched.final_url} is {fetched.content_type or 'binary'}, not a page")
        return Page(
            url=fetched.url,
            final_url=fetched.final_url,
            status=fetched.status,
            title=urlsplit(fetched.final_url).path.rsplit("/", 1)[-1] or fetched.final_url,
            markdown=body if fetched.content_type.startswith("text/markdown") else f"```\n{body}\n```",
            html=None,
            text=body if "text" in wants else None,
            links=[] if "links" in wants else None,
            fetched_ms=fetched.elapsed_ms,
        )

    # --------------------------------------------------------------- map

    async def map(
        self, url: str, *, limit: int = 200, search: str | None = None, sitemap: bool = True
    ) -> dict[str, Any]:
        start = normalise(url)
        found: list[str] = []
        seen: set[str] = set()
        sources: list[str] = []
        robots = await self.fetcher.robots(start)

        def add(candidates: list[str]) -> None:
            for candidate in candidates:
                try:
                    clean = normalise(candidate)
                except BlockedUrl:
                    continue
                if clean in seen or not same_site(clean, start):
                    continue
                if self.fetcher.respect_robots and not robots.allows(clean):
                    continue
                seen.add(clean)
                found.append(clean)

        if sitemap:
            origin = f"{urlsplit(start).scheme}://{urlsplit(start).netloc}"
            queue = deque(robots.sitemaps or [f"{origin}/sitemap.xml", f"{origin}/sitemap_index.xml"])
            visited_maps: set[str] = set()
            while queue and len(found) < limit and len(visited_maps) < 20:
                sitemap_url = queue.popleft()
                if sitemap_url in visited_maps:
                    continue
                visited_maps.add(sitemap_url)
                try:
                    fetched = await self.fetcher.get(sitemap_url, accept="application/xml,text/xml,text/plain;q=0.9")
                except FetchError:
                    continue
                if fetched.status != 200:
                    continue
                pages, nested = parse_sitemap(fetched.text, sitemap_url)
                add(pages)
                queue.extend(nested)
                if pages:
                    sources.append("sitemap")
        if len(found) < limit:
            try:
                front = await self.scrape(start, formats=("links",))
                add([front.final_url] + (front.links or []))
                if front.links:
                    sources.append("links")
            except (FetchError, NotAvailable):
                pass
        if search:
            needle = search.lower()
            found = [u for u in found if needle in u.lower()]
        return {
            "url": start,
            "urls": found[:limit],
            "total": len(found),
            "source": "+".join(dict.fromkeys(sources)) or "none",
        }

    # ------------------------------------------------------------- crawl

    async def crawl(
        self,
        url: str,
        *,
        limit: int = 20,
        max_depth: int = 2,
        include: list[str] | None = None,
        exclude: list[str] | None = None,
        formats: tuple[str, ...] = ("markdown",),
    ) -> dict[str, Any]:
        start = normalise(url)
        limit = min(limit, self.limits.max_pages)
        include = include or []
        exclude = exclude or []

        def wanted(candidate: str) -> bool:
            path = match_path(candidate)
            if exclude and any(fnmatch.fnmatch(path, pat) for pat in exclude):
                return False
            return not include or any(fnmatch.fnmatch(path, pat) for pat in include)

        queue: deque[tuple[str, int]] = deque([(start, 0)])
        seen = {start}
        pages: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        visited = 0
        wants = tuple(dict.fromkeys([*formats, "links"]))

        async def visit(item: tuple[str, int]) -> tuple[str, int, Page | None, str]:
            current, depth = item
            try:
                page = await self.scrape(current, formats=wants)
                return current, depth, page, ""
            except (FetchError, NotAvailable) as exc:
                return current, depth, None, str(exc)

        while queue and len(pages) < limit:
            batch = [queue.popleft() for _ in range(min(self.limits.concurrency, len(queue), limit - len(pages)))]
            results = await asyncio.gather(*(visit(item) for item in batch))
            for current, depth, page, error in results:
                visited += 1
                if page is None:
                    failures.append({"url": current, "error": error})
                    continue
                if page.status >= 400:
                    failures.append({"url": current, "error": f"HTTP {page.status}"})
                    continue
                if wanted(page.final_url) or current == start:
                    out = page.as_dict()
                    if "links" not in formats:
                        out["links"] = None
                    out["depth"] = depth
                    pages.append(out)
                if depth < max_depth:
                    for link in page.links or []:
                        try:
                            clean = normalise(link)
                        except BlockedUrl:
                            continue
                        if clean in seen or not same_site(clean, start) or not wanted(clean):
                            continue
                        seen.add(clean)
                        queue.append((clean, depth + 1))
        return {
            "url": start,
            "pages": pages,
            "failures": failures,
            "visited": visited,
            "truncated": bool(queue) and len(pages) >= limit,
        }

    # ------------------------------------------------------------- batch

    async def batch(
        self, urls: list[str], *, formats: tuple[str, ...] = ("markdown",), render: bool = False
    ) -> dict[str, Any]:
        semaphore = asyncio.Semaphore(self.limits.concurrency)
        pages: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []

        async def one(target: str) -> None:
            async with semaphore:
                try:
                    page = await self.scrape(target, formats=formats, render=render)
                except (FetchError, NotAvailable, BlockedUrl) as exc:
                    failures.append({"url": target, "error": str(exc)})
                    return
                if page.status >= 400:
                    failures.append({"url": target, "error": f"HTTP {page.status}"})
                else:
                    pages.append(page.as_dict())

        await asyncio.gather(*(one(u) for u in dict.fromkeys(urls)))
        order: dict[str, int] = {}
        for i, u in enumerate(urls):
            try:
                order.setdefault(normalise(u), i)
            except BlockedUrl:
                continue
        pages.sort(key=lambda p: order.get(p["url"], len(order)))
        return {"pages": pages, "failures": failures}

    # ------------------------------------------------------------ search

    async def search(self, query: str, *, limit: int = 5, scrape: bool = True) -> dict[str, Any]:
        if not self.firecrawl:
            raise NotAvailable(
                "Web search needs Firecrawl: set ALLDASH_FIRECRAWL_API_KEY. "
                "Scrape, map, crawl and batch work without it."
            )
        results = await self.firecrawl.search(query, limit=limit, scrape=scrape)
        return {"query": query, "results": results, "engine": "firecrawl"}

    # ----------------------------------------------------------- extract

    def _require_llm(self) -> Llm:
        if not self.llm or not self.llm.config.configured:
            raise NotAvailable(
                "Extract and agent need a model on the backend: "
                "set ALLDASH_LLM_PROVIDER, ALLDASH_LLM_MODEL and ALLDASH_LLM_API_KEY"
            )
        return self.llm

    async def extract(
        self, urls: list[str], *, prompt: str, schema: dict[str, Any] | None = None, render: bool = False
    ) -> dict[str, Any]:
        llm = self._require_llm()
        gathered = await self.batch(urls, formats=("markdown",), render=render)
        if not gathered["pages"]:
            raise FetchError(
                "None of the URLs could be read: " + "; ".join(f["error"] for f in gathered["failures"][:3])
            )
        data = await llm_extract(llm, pages=gathered["pages"], prompt=prompt, schema=schema)
        return {
            "data": data,
            "sources": [p["final_url"] for p in gathered["pages"]],
            "failures": gathered["failures"],
            "model": llm.config.model,
        }

    # ------------------------------------------------------------- agent

    async def agent(
        self,
        goal: str,
        *,
        start_url: str | None = None,
        schema: dict[str, Any] | None = None,
        max_pages: int = 5,
        render: bool = False,
    ) -> dict[str, Any]:
        llm = self._require_llm()
        steps: list[str] = []
        candidates: list[str] = []
        if start_url:
            mapped = await self.map(start_url, limit=200)
            steps.append(f"Mapped {mapped['total']} URLs on {urlsplit(mapped['url']).netloc} via {mapped['source']}")
            ranked = rank_urls(mapped["urls"], goal)
            candidates = [mapped["url"]] + [u for u in ranked if u != mapped["url"]]
            steps.append(
                f"Picked {min(max_pages, len(candidates))} pages by keyword match: "
                + ", ".join(urlsplit(u).path or "/" for u in candidates[:max_pages])
            )
        else:
            found = await self.search(goal, limit=max_pages, scrape=False)
            candidates = [r["url"] for r in found["results"] if r.get("url")]
            steps.append(f"Searched the web for the goal and took {len(candidates)} results")
        chosen = candidates[:max_pages]
        gathered = await self.batch(chosen, formats=("markdown",), render=render)
        steps.append(
            f"Read {len(gathered['pages'])} pages"
            + (f", {len(gathered['failures'])} failed" if gathered["failures"] else "")
        )
        if not gathered["pages"]:
            raise FetchError("No page could be read for this goal")
        data = await llm_extract(llm, pages=gathered["pages"], prompt=goal, schema=schema)
        steps.append(f"Extracted with {llm.config.model}")
        return {
            "data": data,
            "sources": [p["final_url"] for p in gathered["pages"]],
            "failures": gathered["failures"],
            "steps": steps,
            "model": llm.config.model,
        }


def keywords(text: str) -> list[str]:
    return [w for w in re.findall(r"[a-z0-9]{3,}", text.lower()) if w not in STOP]


def rank_urls(urls: list[str], goal: str) -> list[str]:
    """URLs whose path words overlap the goal first; shorter paths break ties."""
    words = set(keywords(goal))

    def score(u: str) -> tuple[int, int]:
        path_words = set(keywords(urlsplit(u).path.replace("/", " ").replace("-", " ").replace("_", " ")))
        return (-len(words & path_words), len(urlsplit(u).path))

    return sorted(urls, key=score)
