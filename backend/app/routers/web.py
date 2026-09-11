"""The web tier's HTTP face: /web/*.

Scrape, map, search, extract and agent answer inside the request. Crawl and
batch do too up to the synchronous page cap; beyond it (or with
`?async=true`) they become a job the worker runs, polled at /web/jobs/{id}.
Extract and agent are decisions made on the user's behalf, so each lands in
the audit ledger with the model, the sources and the prompt.
"""

from __future__ import annotations

import asyncio
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..db import get_session
from ..models import WebJob
from ..schemas import (
    Page,
    WebAgentIn,
    WebAgentOut,
    WebBatchIn,
    WebBatchOut,
    WebCapabilities,
    WebCrawlIn,
    WebCrawlOut,
    WebExtractIn,
    WebExtractOut,
    WebJobAccepted,
    WebJobOut,
    WebJobStatus,
    WebMapIn,
    WebMapOut,
    WebPage,
    WebScrapeIn,
    WebSearchIn,
    WebSearchOut,
)
from ..security import Authed
from ..web.factory import get_web
from ..web.fetch import FetchError
from ..web.firecrawl import FirecrawlError
from ..web.guard import BlockedUrl
from ..web.llm import LlmError, LlmNotConfigured
from ..web.service import NotAvailable, WebService
from ._common import Limit, Offset, get_or_404, paginate

router = APIRouter(prefix="/web", tags=["web"])
Session = Annotated[AsyncSession, Depends(get_session, scope="function")]
Web = Annotated[WebService, Depends(get_web)]


def _http(exc: Exception) -> HTTPException:
    if isinstance(exc, FetchError | BlockedUrl):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc))
    if isinstance(exc, NotAvailable | LlmNotConfigured):
        return HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc))
    if isinstance(exc, FirecrawlError | LlmError):
        return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
    if isinstance(exc, TimeoutError):
        return HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="The site did not answer within the request budget"
        )
    raise exc


@router.get("/capabilities", response_model=WebCapabilities, summary="What this deployment can do")
async def capabilities(web: Web, _: Authed) -> WebCapabilities:
    return WebCapabilities(**web.capabilities())


@router.post("/scrape", response_model=WebPage, summary="One URL to Markdown, HTML, text, links or a screenshot")
async def scrape(body: WebScrapeIn, web: Web, _: Authed) -> WebPage:
    try:
        async with _budget(web):
            page = await web.scrape(body.url, formats=tuple(body.formats), render=body.render, wait_ms=body.wait_ms)
    except Exception as exc:  # noqa: BLE001 - mapped to a status below
        raise _http(exc) from exc
    return WebPage(**page.as_dict())


@router.post("/map", response_model=WebMapOut, summary="Every URL a site publishes")
async def map_site(body: WebMapIn, web: Web, _: Authed) -> WebMapOut:
    try:
        async with _budget(web):
            return WebMapOut(**await web.map(body.url, limit=body.limit, search=body.search, sitemap=body.sitemap))
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc


@router.post("/search", response_model=WebSearchOut, summary="Search the web (Firecrawl)")
async def search(body: WebSearchIn, web: Web, _: Authed) -> WebSearchOut:
    try:
        return WebSearchOut(**await web.search(body.query, limit=body.limit, scrape=body.scrape))
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc


async def _enqueue(session: AsyncSession, kind: str, request: dict) -> WebJobAccepted:
    job = WebJob(kind=kind, status="queued", request=request)
    session.add(job)
    # Commit first: the worker may pick the message up before this request
    # would otherwise have committed, and find no row.
    await session.commit()
    from ..worker import run_web_job  # imported here so the API never needs a broker at import time

    # Kombu's publish is blocking; keep it off the event loop.
    await asyncio.to_thread(run_web_job.delay, job.id)
    return WebJobAccepted(id=job.id, kind=kind, status="queued")


def _budget(web: WebService) -> asyncio.Timeout:
    """One wall-clock cap on a synchronous web request, whatever the site does."""
    return asyncio.timeout(web.budget_seconds)


@router.post("/crawl", response_model=WebCrawlOut | WebJobAccepted, summary="Every page of a site, breadth first")
async def crawl(
    body: WebCrawlIn,
    web: Web,
    session: Session,
    _: Authed,
    run_async: Annotated[bool, Query(alias="async")] = False,
) -> WebCrawlOut | WebJobAccepted:
    if run_async or body.limit > web.limits.sync_max_pages:
        return await _enqueue(session, "crawl", body.model_dump())
    try:
        async with _budget(web):
            result = await web.crawl(
                body.url,
                limit=body.limit,
                max_depth=body.max_depth,
                include=body.include,
                exclude=body.exclude,
                formats=tuple(body.formats),
            )
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc
    return WebCrawlOut(**result)


@router.post("/batch", response_model=WebBatchOut | WebJobAccepted, summary="Many URLs at once")
async def batch(
    body: WebBatchIn,
    web: Web,
    session: Session,
    _: Authed,
    run_async: Annotated[bool, Query(alias="async")] = False,
) -> WebBatchOut | WebJobAccepted:
    if run_async or len(body.urls) > web.limits.sync_max_pages:
        return await _enqueue(session, "batch", body.model_dump())
    try:
        async with _budget(web):
            result = await web.batch(body.urls, formats=tuple(body.formats), render=body.render)
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc
    return WebBatchOut(**result)


@router.post(
    "/extract", response_model=WebExtractOut, summary="Scrape, then answer a prompt or fill a schema (needs a model)"
)
async def extract(body: WebExtractIn, web: Web, session: Session, _: Authed) -> WebExtractOut:
    try:
        result = await web.extract(body.urls, prompt=body.prompt, schema=body.schema_, render=body.render)
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc
    entry = await audit.record(
        session,
        actor="assistant",
        action="web_extract",
        subject_type="web",
        subject_id=(urlsplit(body.urls[0]).hostname or "")[:64],
        decision=f"Extracted structured data from {len(result['sources'])} page(s) with {result['model']}",
        rationale=body.prompt[:2000],
        confidence=0.7 if body.schema_ else 0.6,
        inputs={"sources": result["sources"], "schema": body.schema_ or None, "failures": result["failures"]},
    )
    return WebExtractOut(**result, audit_id=entry.id)


@router.post(
    "/agent",
    response_model=WebAgentOut,
    summary="Describe what you need; it maps or searches, reads and extracts (needs a model)",
)
async def agent(body: WebAgentIn, web: Web, session: Session, _: Authed) -> WebAgentOut:
    try:
        result = await web.agent(
            body.goal, start_url=body.start_url, schema=body.schema_, max_pages=body.max_pages, render=body.render
        )
    except Exception as exc:  # noqa: BLE001
        raise _http(exc) from exc
    entry = await audit.record(
        session,
        actor="assistant",
        action="web_agent",
        subject_type="web",
        subject_id=(urlsplit(body.start_url).hostname if body.start_url else "search")[:64],
        decision=f"Gathered data for: {body.goal[:200]}",
        rationale=" → ".join(result["steps"])[:8000],
        confidence=0.65 if body.schema_ else 0.55,
        inputs={"sources": result["sources"], "schema": body.schema_ or None, "failures": result["failures"]},
    )
    return WebAgentOut(**result, audit_id=entry.id)


@router.get("/jobs", response_model=Page[WebJobOut], summary="Crawls and batches run by the worker, newest first")
async def list_jobs(
    session: Session,
    _: Authed,
    status_: Annotated[WebJobStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[WebJobOut]:
    stmt = select(WebJob).order_by(WebJob.created_at.desc())
    if status_:
        stmt = stmt.where(WebJob.status == status_)
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[WebJobOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/jobs/{job_id}", response_model=WebJobOut)
async def get_job(job_id: str, session: Session, _: Authed) -> WebJobOut:
    return WebJobOut.model_validate(await get_or_404(session, WebJob, job_id, "Web job"))
