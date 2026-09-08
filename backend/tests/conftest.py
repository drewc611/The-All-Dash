"""Test harness: SQLite in a temp file, auth on, one app per test."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

os.environ["ALLDASH_ENVIRONMENT"] = "test"
os.environ["ALLDASH_API_KEYS"] = "test-key,second-key"
os.environ["ALLDASH_REDIS_URL"] = "redis://127.0.0.1:1/0"

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402

KEY = {"X-API-Key": "test-key"}


@pytest.fixture
async def client(tmp_path) -> AsyncIterator[AsyncClient]:
    get_settings.cache_clear()
    url = f"sqlite+aiosqlite:///{tmp_path / 'test.db'}"
    os.environ["ALLDASH_DATABASE_URL"] = url
    get_settings.cache_clear()
    db.reset_for_tests(url)
    async with db.get_engine().begin() as conn:
        await conn.run_sync(db.Base.metadata.create_all)
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    await db.dispose_engine()
