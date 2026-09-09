from collections.abc import AsyncIterator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    """Declarative base shared by every table."""


_engine: AsyncEngine | None = None
_sessions: async_sessionmaker[AsyncSession] | None = None


def make_engine(url: str, *, pool_size: int | None = None, max_overflow: int | None = None) -> AsyncEngine:
    settings = get_settings()
    kwargs: dict[str, object] = {"pool_pre_ping": True}
    if url.startswith("sqlite"):
        # SQLite is for tests and laptops; it has no pool to size.
        kwargs = {}
    else:
        kwargs.update(
            {
                "pool_size": settings.db_pool_size if pool_size is None else pool_size,
                "max_overflow": settings.db_max_overflow if max_overflow is None else max_overflow,
            }
        )
    engine = create_async_engine(url, **kwargs)
    if url.startswith("sqlite"):
        # Postgres enforces foreign keys; SQLite only does when asked, and the
        # test suite must fail where production would.
        @event.listens_for(engine.sync_engine, "connect")
        def _fk_on(dbapi_connection: object, _record: object) -> None:
            cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


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
    """FastAPI dependency: one session per request, committed on success.

    Bound with scope="function" so the commit happens before the response is
    sent; a request-scoped yield dependency in FastAPI 0.118+ would commit
    after the client already has its 2xx.
    """
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
