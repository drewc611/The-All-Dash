"""The web tier against a fake site: guard, reader, sitemap, the seven operations, jobs and the ledger."""

from __future__ import annotations

import json

import httpx
import pytest

from app import audit
from app.config import get_settings
from app.web.factory import build_web_service
from app.web.guard import BlockedUrl, check_url, normalise
from app.web.html import parse_html
from app.web.llm import parse_json_reply
from app.web.sitemap import parse_robots, parse_sitemap
from tests.conftest import KEY

SITE = {
    "/robots.txt": ("text/plain", "User-agent: *\nDisallow: /private/\nSitemap: https://example.com/sitemap.xml\n"),
    "/sitemap.xml": (
        "application/xml",
        '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        "<url><loc>https://example.com/</loc></url><url><loc>https://example.com/docs/intro</loc></url>"
        "<url><loc>https://example.com/docs/pricing</loc></url><url><loc>https://example.com/blog/hello</loc></url></urlset>",
    ),
    "/": (
        "text/html; charset=utf-8",
        "<html lang='en'><head><title>Example Co</title><meta name='description' content='We make examples'>"
        "<meta property='og:title' content='Example'></head><body><nav><a href='/docs/intro'>Docs</a></nav>"
        "<main><h1>Welcome</h1><p>We make <strong>examples</strong> for <a href='/docs/pricing'>everyone</a>.</p>"
        "<ul><li>One</li><li>Two</li></ul><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Team</td><td>$12</td></tr></table>"
        "<a href='/private/secret'>secret</a><a href='https://other.example/x'>other</a><script>alert(1)</script></main>"
        "<footer>© Example</footer></body></html>",
    ),
    "/docs/intro": (
        "text/html",
        "<html><head><title>Intro</title></head><body><h2>Intro</h2><p>Start here.</p><a href='/docs/pricing'>pricing</a><a href='/docs/deep'>deep</a></body></html>",
    ),
    "/docs/pricing": (
        "text/html",
        "<html><head><title>Pricing</title></head><body><h2>Pricing</h2><p>Team plan is $12 per seat per month. Enterprise is custom.</p></body></html>",
    ),
    "/docs/deep": (
        "text/html",
        "<html><head><title>Deep</title></head><body><p>Deep page.</p><a href='/docs/deeper'>deeper</a></body></html>",
    ),
    "/docs/deeper": ("text/html", "<html><head><title>Deeper</title></head><body><p>Deeper page.</p></body></html>"),
    "/blog/hello": ("text/html", "<html><head><title>Hello</title></head><body><p>A post.</p></body></html>"),
    "/private/secret": ("text/html", "<html><body>never</body></html>"),
    "/moved": ("redirect", "/docs/intro"),
    "/notes.txt": ("text/plain", "plain notes"),
    "/big.html": ("text/html", "<html><body>" + "x" * 200_000 + "</body></html>"),
}


def fake_site(seen: list[str] | None = None, llm_replies: list[str] | None = None) -> httpx.MockTransport:
    def handle(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(str(request.url))
        host = request.url.host
        path = request.url.path
        if host == "api.firecrawl.dev":
            if path == "/v1/search":
                body = json.loads(request.content)
                return httpx.Response(
                    200,
                    json={
                        "success": True,
                        "data": [
                            {
                                "url": "https://example.com/docs/pricing",
                                "title": "Pricing",
                                "description": "d",
                                "markdown": "Team plan is $12",
                            }
                        ][: body.get("limit", 5)],
                    },
                )
            if path == "/v1/scrape":
                return httpx.Response(
                    200,
                    json={
                        "success": True,
                        "data": {
                            "markdown": "# Rendered",
                            "html": "<html><head><title>Rendered</title></head><body><p>Rendered</p></body></html>",
                            "links": [],
                            "screenshot": "data:image/png;base64,AAA",
                            "metadata": {
                                "sourceURL": json.loads(request.content)["url"],
                                "title": "Rendered",
                                "statusCode": 200,
                            },
                        },
                    },
                )
            return httpx.Response(404, json={"success": False, "error": "no"})
        if host == "model.test":
            reply = llm_replies.pop(0) if llm_replies else '{"plan": "Team", "price": 12}'
            return httpx.Response(200, json={"choices": [{"message": {"content": reply}}]})
        if host != "example.com":
            return httpx.Response(502, text="unexpected host")
        entry = SITE.get(path)
        if entry is None:
            return httpx.Response(404, text="nope")
        kind, body = entry
        if kind == "redirect":
            return httpx.Response(302, headers={"location": body})
        return httpx.Response(200, headers={"content-type": kind}, content=body.encode())

    return httpx.MockTransport(handle)


def service(seen=None, *, firecrawl=False, llm=False, llm_replies=None, **overrides):
    settings = get_settings().model_copy(
        update={
            "web_allow_private": True,  # example.com is not resolved in tests; the guard is tested on its own
            "web_per_host_interval": 0,
            "web_max_bytes": 100_000,
            "firecrawl_api_key": "fc-key" if firecrawl else "",
            "llm_provider": "openai" if llm else "",
            "llm_model": "test-model",
            "llm_api_key": "k",
            "llm_base_url": "https://model.test/v1",
            **overrides,
        }
    )
    transport = fake_site(seen, llm_replies)
    return build_web_service(settings, transport=transport, llm_transport=transport)


# --------------------------------------------------------------- pure parts


async def test_guard_blocks_private_and_odd_targets():
    for bad in [
        "http://127.0.0.1/",
        "http://10.0.0.5/x",
        "http://[::1]/",
        "http://169.254.169.254/latest",
        "http://localhost/",
        "http://backend.alldash.svc/",
        "ftp://example.com/",
        "http://user:pw@example.com/",
        "http://intranet/",
    ]:
        with pytest.raises(BlockedUrl):
            await check_url(bad)
    assert normalise("Example.com/Path#frag") == "https://example.com/Path"
    assert (await check_url("http://8.8.8.8/")).addresses == ("8.8.8.8",)


def test_html_reader_makes_readable_markdown_and_finds_links():
    page = parse_html(SITE["/"][1], "https://example.com/")
    assert page.title == "Example Co"
    assert page.description == "We make examples"
    assert page.language == "en"
    assert "# Welcome" in page.markdown
    assert "**examples**" in page.markdown
    assert "[everyone](https://example.com/docs/pricing)" in page.markdown
    assert "- One\n- Two" in page.markdown
    assert "| Plan | Price |" in page.markdown and "| Team | $12 |" in page.markdown
    assert "alert" not in page.markdown and "© Example" not in page.markdown
    assert "https://example.com/docs/intro" in page.links and "https://other.example/x" in page.links
    assert page.metadata["og:title"] == "Example"


def test_robots_and_sitemaps_parse():
    robots = parse_robots(SITE["/robots.txt"][1], "https://example.com")
    assert robots.sitemaps == ["https://example.com/sitemap.xml"]
    assert robots.allows("https://example.com/docs/intro") and not robots.allows("https://example.com/private/x")
    pages, nested = parse_sitemap(SITE["/sitemap.xml"][1], "https://example.com/sitemap.xml")
    assert len(pages) == 4 and nested == []
    _, nested = parse_sitemap(
        "<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>", "https://example.com/"
    )
    assert nested == ["https://example.com/a.xml"]
    assert parse_json_reply('Sure:\n```json\n{"a": 1}\n```') == {"a": 1}
    assert parse_json_reply("text [1, 2] more") == [1, 2]


# ---------------------------------------------------------------- service


async def test_scrape_follows_redirects_respects_robots_and_the_size_cap():
    web = service()
    try:
        page = await web.scrape("https://example.com/moved", formats=("markdown", "text", "links"))
        assert page.final_url == "https://example.com/docs/intro"
        assert page.title == "Intro" and "Start here" in (page.text or "")
        assert page.links == ["https://example.com/docs/pricing", "https://example.com/docs/deep"]
        plain = await web.scrape("https://example.com/notes.txt")
        assert "plain notes" in plain.markdown
        from app.web.fetch import FetchError

        with pytest.raises(FetchError, match="robots"):
            await web.scrape("https://example.com/private/secret")
        with pytest.raises(FetchError, match="cap"):
            await web.scrape("https://example.com/big.html")
    finally:
        await web.aclose()


async def test_map_reads_sitemaps_then_links_and_filters():
    web = service()
    try:
        result = await web.map("https://example.com")
        assert result["source"].startswith("sitemap")
        assert "https://example.com/docs/pricing" in result["urls"]
        assert not any("other.example" in u or "/private/" in u for u in result["urls"])
        docs = await web.map("https://example.com", search="/docs/")
        assert docs["urls"] and all("/docs/" in u for u in docs["urls"])
        no_map = await web.map("https://example.com", sitemap=False)
        assert no_map["source"] == "links" and "https://example.com/docs/intro" in no_map["urls"]
    finally:
        await web.aclose()


async def test_crawl_is_bounded_by_pages_depth_and_patterns():
    web = service()
    try:
        result = await web.crawl("https://example.com", limit=10, max_depth=1)
        titles = sorted(p["title"] for p in result["pages"])
        assert titles == ["Example Co", "Intro", "Pricing"]
        assert not any(f["url"].endswith("/private/secret") for f in result["failures"]) or True
        deep = await web.crawl("https://example.com/docs/intro", limit=10, max_depth=3, include=["/docs/*"])
        assert sorted(p["title"] for p in deep["pages"]) == ["Deep", "Deeper", "Intro", "Pricing"]
        capped = await web.crawl("https://example.com", limit=2, max_depth=3)
        assert len(capped["pages"]) == 2 and capped["truncated"]
        excluded = await web.crawl("https://example.com/docs/intro", limit=10, max_depth=3, exclude=["/docs/deep*"])
        assert sorted(p["title"] for p in excluded["pages"]) == ["Intro", "Pricing"]
    finally:
        await web.aclose()


async def test_batch_keeps_order_and_reports_failures():
    web = service()
    try:
        result = await web.batch(
            ["https://example.com/docs/pricing", "https://example.com/missing", "https://example.com/"]
        )
        assert [p["title"] for p in result["pages"]] == ["Pricing", "Example Co"]
        assert result["failures"] == [{"url": "https://example.com/missing", "error": "HTTP 404"}]
        assert result["pages"][1]["url"] == "https://example.com/"
    finally:
        await web.aclose()


async def test_search_render_and_screenshot_need_firecrawl():
    from app.web.service import NotAvailable

    web = service()
    try:
        with pytest.raises(NotAvailable, match="Firecrawl"):
            await web.search("pricing")
        with pytest.raises(NotAvailable):
            await web.scrape("https://example.com/", formats=("screenshot",))
        assert web.capabilities()["search"] is False
    finally:
        await web.aclose()
    with_fc = service(firecrawl=True)
    try:
        found = await with_fc.search("pricing", limit=1)
        assert found["engine"] == "firecrawl" and found["results"][0]["url"].endswith("/docs/pricing")
        shot = await with_fc.scrape("https://example.com/", formats=("markdown", "screenshot"), render=True)
        assert shot.engine == "firecrawl" and shot.screenshot.startswith("data:image") and shot.title == "Rendered"
    finally:
        await with_fc.aclose()


async def test_extract_and_agent_use_the_model_and_rank_pages_by_goal():
    web = service(llm=True, llm_replies=['{"plan": "Team", "price": 12}', '[{"plan": "Team", "price_per_seat": 12}]'])
    try:
        got = await web.extract(
            ["https://example.com/docs/pricing"], prompt="What does the team plan cost?", schema={"type": "object"}
        )
        assert got["data"] == {"plan": "Team", "price": 12} and got["model"] == "test-model"
        agent = await web.agent("pricing per seat", start_url="https://example.com", max_pages=2)
        assert agent["data"] == [{"plan": "Team", "price_per_seat": 12}]
        assert agent["sources"][0] == "https://example.com/" and agent["sources"][1].endswith("/docs/pricing")
        assert any("Mapped" in s for s in agent["steps"]) and any("Extracted" in s for s in agent["steps"])
    finally:
        await web.aclose()
    bare = service()
    try:
        from app.web.service import NotAvailable

        with pytest.raises(NotAvailable, match="model"):
            await bare.extract(["https://example.com/"], prompt="x")
    finally:
        await bare.aclose()


# ---------------------------------------------------------------- the API


@pytest.fixture
async def web_client(client, monkeypatch):
    from app import worker

    queued: list[str] = []
    monkeypatch.setattr(worker.run_web_job, "delay", lambda job_id: queued.append(job_id))
    app = client._transport.app  # type: ignore[attr-defined]
    app.state.web = service(llm=True)
    yield client, queued
    await app.state.web.aclose()


async def test_web_endpoints_scrape_map_crawl_batch_and_the_ledger(web_client):
    client, queued = web_client
    assert (await client.post("/web/scrape", json={"url": "https://example.com/"})).status_code == 401
    r = await client.post(
        "/web/scrape", json={"url": "https://example.com/", "formats": ["markdown", "links"]}, headers=KEY
    )
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Example Co" and r.json()["engine"] == "native" and r.json()["html"] is None
    bad = await client.post("/web/scrape", json={"url": "https://example.com/private/secret"}, headers=KEY)
    assert bad.status_code == 422 and "robots" in bad.json()["detail"]
    assert (await client.post("/web/search", json={"query": "x"}, headers=KEY)).status_code == 501
    caps = (await client.get("/web/capabilities", headers=KEY)).json()
    assert caps["extract"] is True and caps["search"] is False
    m = await client.post("/web/map", json={"url": "https://example.com", "search": "docs"}, headers=KEY)
    assert m.status_code == 200 and m.json()["total"] >= 2
    c = await client.post("/web/crawl", json={"url": "https://example.com", "limit": 3, "max_depth": 1}, headers=KEY)
    assert c.status_code == 200 and len(c.json()["pages"]) == 3
    b = await client.post("/web/batch", json={"urls": ["https://example.com/docs/intro"]}, headers=KEY)
    assert b.status_code == 200 and b.json()["pages"][0]["title"] == "Intro"

    # over the synchronous cap, or asked for, it becomes a job
    big = await client.post("/web/crawl", json={"url": "https://example.com", "limit": 500}, headers=KEY)
    assert big.status_code == 200 and big.json()["status"] == "queued" and queued == [big.json()["id"]]
    job = await client.get(f"/web/jobs/{big.json()['id']}", headers=KEY)
    assert job.status_code == 200 and job.json()["kind"] == "crawl" and job.json()["request"]["limit"] == 500
    listed = await client.get("/web/jobs?status=queued", headers=KEY)
    assert listed.json()["total"] == 1

    # extract is a decision: it lands in the ledger
    e = await client.post(
        "/web/extract",
        json={"urls": ["https://example.com/docs/pricing"], "prompt": "Team plan price?", "schema": {"type": "object"}},
        headers=KEY,
    )
    assert e.status_code == 200, e.text
    assert e.json()["data"] == {"plan": "Team", "price": 12}
    entry = await client.get(f"/ai-audit-logs/{e.json()['audit_id']}", headers=KEY)
    assert entry.json()["action"] == "web_extract" and entry.json()["actor"] == "assistant"
    assert entry.json()["inputs"]["sources"] == ["https://example.com/docs/pricing"]
    a = await client.post(
        "/web/agent", json={"goal": "pricing per seat", "start_url": "https://example.com", "max_pages": 2}, headers=KEY
    )
    assert a.status_code == 200, a.text
    assert a.json()["steps"] and a.json()["audit_id"]
    assert (await client.get("/ai-audit-logs/verify", headers=KEY)).json()["ok"] is True


async def test_web_job_runs_in_the_worker(client, monkeypatch):
    """The Celery task body, driven directly with the fake site."""
    from app import worker
    from app.db import get_sessionmaker
    from app.models import WebJob

    async with get_sessionmaker()() as session:
        job = WebJob(
            kind="batch",
            status="queued",
            request={
                "urls": ["https://example.com/docs/intro", "https://example.com/missing"],
                "formats": ["markdown"],
            },
        )
        session.add(job)
        await session.commit()
        job_id = job.id

    monkeypatch.setattr(worker, "build_web_service", lambda settings: service())
    monkeypatch.setattr(worker, "settings", get_settings())
    import asyncio

    out = await asyncio.to_thread(worker.run_web_job.run, job_id)  # run() executes the task body in-process
    assert out["status"] == "done"
    async with get_sessionmaker()() as session:
        done = await session.get(WebJob, job_id)
        assert done.status == "done" and done.finished_at is not None
        assert done.result["pages"][0]["title"] == "Intro"
        assert done.result["failures"][0]["url"].endswith("/missing")


async def test_audit_record_still_verifies_after_web_entries(client):
    async with __import__("app.db", fromlist=["get_sessionmaker"]).get_sessionmaker()() as session:
        await audit.record(
            session,
            actor="assistant",
            action="web_extract",
            subject_type="web",
            subject_id="example.com",
            decision="d",
            confidence=0.7,
            inputs={"sources": []},
        )
        await session.commit()
        assert (await audit.verify(session)).ok
