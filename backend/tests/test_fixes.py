"""Regression tests for the review findings: guard, robots, order, FK, clock, jobs, windows."""

from __future__ import annotations

import asyncio
import ipaddress
from datetime import date, timedelta

import httpx
import pytest

from app import worker
from app.clock import day_bounds, today_local
from app.config import get_settings
from app.db import get_sessionmaker
from app.models import WebJob
from app.web.guard import BlockedUrl, _is_public, check_url, match_path, normalise
from app.web.pinned import PinnedBackend
from app.web.sitemap import parse_robots
from tests.conftest import KEY
from tests.test_web import SITE, service


async def test_guard_rejects_malformed_ports_and_shared_address_space():
    for bad in ["http://example.com:abc/", "http://example.com:99999/", "http://[::1"]:
        with pytest.raises(BlockedUrl, match="Malformed"):
            normalise(bad)
    assert _is_public(ipaddress.ip_address("100.64.0.1")) is False
    assert _is_public(ipaddress.ip_address("8.8.8.8")) is True
    with pytest.raises(BlockedUrl):
        await check_url("http://100.64.0.1/")


def test_robots_and_globs_match_the_normalised_path():
    robots = parse_robots("User-agent: *\nDisallow: /private/\nCrawl-delay: 86400\n", "https://example.com")
    assert robots.allows("https://example.com/docs/../private/secret") is False
    assert robots.allows("https://example.com/%70rivate/secret") is False
    assert robots.allows("https://example.com/docs/intro") is True
    assert robots.crawl_delay == 10.0
    assert match_path("https://example.com/a/b/../c/") == "/a/c/"


async def test_pinned_backend_dials_the_vetted_address():
    seen: list[tuple[str, int]] = []

    class Inner:
        async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):  # noqa: ASYNC109
            seen.append((host, port))
            raise ConnectionError("stop here")

    backend = PinnedBackend({"example.com": "93.184.216.34"})
    backend._inner = Inner()  # type: ignore[assignment]
    with pytest.raises(ConnectionError):
        await backend.connect_tcp("Example.com", 443)
    assert seen == [("93.184.216.34", 443)]


async def test_robots_uses_the_port_and_batch_keeps_input_order():
    seen: list[str] = []
    web = service(seen)
    try:
        await web.fetcher.robots("http://example.com:8080/page")
        assert any(u.startswith("http://example.com:8080/robots.txt") for u in seen)
        result = await web.batch(["Example.com/docs/pricing", "https://example.com/"])
        assert [p["title"] for p in result["pages"]] == ["Pricing", "Example Co"]
        crawled = await web.crawl("https://example.com/docs/intro", limit=10, max_depth=1, exclude=["/docs/deep*"])
        assert all("deep" not in p["url"] for p in crawled["pages"])
    finally:
        await web.aclose()


async def test_a_malformed_link_on_a_page_does_not_abort_a_crawl():
    web = service()
    try:
        SITE["/docs/odd"] = ("text/html", "<html><head><title>Odd</title></head><body><a href='http://example.com:abc/'>bad</a><a href='/docs/pricing'>ok</a></body></html>")
        result = await web.crawl("https://example.com/docs/odd", limit=5, max_depth=1)
        assert sorted(p["title"] for p in result["pages"]) == ["Odd", "Pricing"]
    finally:
        SITE.pop("/docs/odd", None)
        await web.aclose()


async def test_foreign_keys_are_checked_for_invoices_and_expenses(client):
    bad = {"number": "INV-9", "client": "X", "amount_cents": 100, "issued_on": "2026-09-01", "due_on": "2026-09-30", "project_id": "nope"}
    r = await client.post("/invoices", json=bad, headers=KEY)
    assert r.status_code == 422 and "Project nope" in r.json()["detail"]
    r = await client.post("/expenses", json={"vendor": "V", "amount_cents": 5, "spent_on": "2026-09-01", "project_id": "nope"}, headers=KEY)
    assert r.status_code == 422


async def test_a_future_as_of_does_not_mark_invoices_overdue(client):
    soon = (today_local() + timedelta(days=30)).isoformat()
    r = await client.post("/invoices", json={"number": "INV-F", "client": "X", "amount_cents": 100, "issued_on": today_local().isoformat(), "due_on": soon, "status": "sent"}, headers=KEY)
    assert r.status_code == 201, r.text
    marked = await client.post("/invoices/mark-overdue?as_of=2099-01-01", headers=KEY)
    assert marked.status_code == 200 and marked.json() == []
    assert (await client.get(f"/invoices/{r.json()['id']}", headers=KEY)).json()["status"] == "sent"


def test_today_and_day_bounds_follow_the_configured_zone(monkeypatch):
    monkeypatch.setenv("ALLDASH_TIMEZONE", "Pacific/Auckland")
    get_settings.cache_clear()
    try:
        start, end = day_bounds(date(2026, 1, 15))
        assert start.isoformat() == "2026-01-14T11:00:00+00:00"
        assert (end - start) == timedelta(days=1)
        assert isinstance(today_local(), date)
    finally:
        monkeypatch.delenv("ALLDASH_TIMEZONE")
        get_settings.cache_clear()


async def test_burn_rate_windows_are_the_same_length(client):
    today = today_local()
    for days_ago, cents in ((0, 100), (29, 100), (30, 1000), (59, 1000)):
        r = await client.post("/expenses", json={"vendor": "V", "amount_cents": cents, "spent_on": (today - timedelta(days=days_ago)).isoformat()}, headers=KEY)
        assert r.status_code == 201
    burn = (await client.get("/finance/burn-rate?window_days=30", headers=KEY)).json()
    assert burn["expenses_cents"] == 200
    assert burn["previous_window_cents"] == 2000


async def test_a_lost_worker_and_an_unstorable_result_leave_the_job_failed(client, monkeypatch):
    async with get_sessionmaker()() as session:
        running = WebJob(kind="batch", status="running", request={"urls": ["https://example.com/"]})
        session.add(running)
        await session.commit()
        running_id = running.id
    monkeypatch.setattr(worker, "settings", get_settings())
    out = await asyncio.to_thread(worker.run_web_job.run, running_id)
    assert out["status"] == "failed"
    async with get_sessionmaker()() as session:
        job = await session.get(WebJob, running_id)
        assert "lost" in job.error

    monkeypatch.setattr(worker, "build_web_service", lambda settings: service())
    async with get_sessionmaker()() as session:
        queued = WebJob(kind="batch", status="queued", request={"urls": ["https://example.com/docs/intro"], "formats": ["markdown", "html"]})
        session.add(queued)
        await session.commit()
        queued_id = queued.id
    out = await asyncio.to_thread(worker.run_web_job.run, queued_id)
    assert out["status"] == "done"
    async with get_sessionmaker()() as session:
        job = await session.get(WebJob, queued_id)
        assert job.result["pages"][0]["title"] == "Intro"
        assert "html" not in job.result["pages"][0]


async def test_enqueue_commits_before_dispatch(client, monkeypatch):
    from app import worker as w

    seen: list[str] = []

    def delay(job_id: str) -> None:
        # By the time the message is published the row must already be visible to another session.
        async def _look() -> None:
            async with get_sessionmaker()() as session:
                assert await session.get(WebJob, job_id) is not None
        asyncio.run(_look())
        seen.append(job_id)

    monkeypatch.setattr(w.run_web_job, "delay", delay)
    app = client._transport.app  # type: ignore[attr-defined]
    app.state.web = service()
    try:
        r = await client.post("/web/crawl?async=true", json={"url": "https://example.com"}, headers=KEY)
        assert r.status_code == 200 and seen == [r.json()["id"]]
    finally:
        await app.state.web.aclose()


async def test_the_request_budget_turns_a_stalling_site_into_a_504(client):
    class Stalling(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            await asyncio.sleep(0.5)
            return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html><title>slow</title></html>")

    from app.web.factory import build_web_service

    settings = get_settings().model_copy(update={"web_allow_private": True, "web_per_host_interval": 0, "web_respect_robots": False})
    web = build_web_service(settings, transport=Stalling())
    web.budget_seconds = 0.05
    app = client._transport.app  # type: ignore[attr-defined]
    app.state.web = web
    try:
        r = await client.post("/web/scrape", json={"url": "https://example.com/"}, headers=KEY)
        assert r.status_code == 504, r.text
    finally:
        await web.aclose()
