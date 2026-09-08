from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    """Declarative base shared by every table."""


_engine: AsyncEngine | None = None
_sessions: async_sessionmaker[AsyncSession] | None = None


def make_engine(url: str) -> AsyncEngine:
    kwargs: dict[str, object] = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # SQLite is for tests only; it has no pool to size.
        kwargs = {}
    else:
        kwargs.update({"pool_size": 10, "max_overflow": 20})
    return create_async_engine(url, **kwargs)


def get_engine() -> AsyncEngine:
    global _engine, _sessions
    if _engine is None:
        _engine = make_engine(get_settings().database_url)
        _sessions = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    if _sessions is None:
        get_engine()
    assert _sessions is not None
    return _sessions


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, committed on success."""
    async with get_sessionmaker()() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def dispose_engine() -> None:
    global _engine, _sessions
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _sessions = None


def reset_for_tests(url: str) -> None:
    """Point the module at a different database (used by the test suite)."""
    global _engine, _sessions
    _engine = make_engine(url)
    _sessions = async_sessionmaker(_engine, expire_on_commit=False)
