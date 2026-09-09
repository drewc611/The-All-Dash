"""Request limits, key comparison and what production hides."""

from __future__ import annotations

import os

from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app
from app.security import _matches
from tests.conftest import KEY


async def test_oversized_bodies_are_refused_before_parsing(client):
    big = {"name": "x", "description": "y" * 2_000_000}
    r = await client.post("/projects", json=big, headers=KEY)
    assert r.status_code == 413
    assert "exceeds" in r.json()["detail"]


async def test_chunked_bodies_must_declare_a_length(client):
    async def chunks():
        yield b'{"name": "Atlas"}'

    r = await client.post("/projects", content=chunks(), headers={**KEY, "content-type": "application/json"})
    assert r.status_code == 411


async def test_audit_inputs_are_bounded(client):
    body = {
        "action": "noted",
        "subject_type": "task",
        "decision": "d",
        "confidence": 0.5,
        "inputs": {"blob": "z" * 70_000},
    }
    r = await client.post("/ai-audit-logs", json=body, headers=KEY)
    assert r.status_code == 422
    body["inputs"] = {"blob": "z" * 1000}
    assert (await client.post("/ai-audit-logs", json=body, headers=KEY)).status_code == 201


def test_key_match_is_exact_and_length_independent():
    accepted = frozenset({"alpha", "a-much-longer-second-key"})
    assert _matches("alpha", accepted)
    assert _matches("a-much-longer-second-key", accepted)
    assert not _matches("alph", accepted)
    assert not _matches("alpha ", accepted)
    assert not _matches("", accepted)


async def test_docs_are_hidden_in_production_unless_exposed(client):
    saved = dict(os.environ)
    try:
        os.environ["ALLDASH_ENVIRONMENT"] = "production"
        os.environ.pop("ALLDASH_EXPOSE_DOCS", None)
        get_settings.cache_clear()
        async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as prod:
            assert (await prod.get("/docs")).status_code == 404
            assert (await prod.get("/openapi.json")).status_code == 404
        os.environ["ALLDASH_EXPOSE_DOCS"] = "true"
        get_settings.cache_clear()
        async with AsyncClient(transport=ASGITransport(app=create_app()), base_url="http://test") as prod:
            assert (await prod.get("/openapi.json")).status_code == 200
    finally:
        os.environ.clear()
        os.environ.update(saved)
        get_settings.cache_clear()
    assert (await client.get("/openapi.json")).status_code == 200
