from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from redis.asyncio import Redis
from sqlalchemy import text

from .. import __version__
from ..config import Settings, get_settings
from ..db import get_sessionmaker
from ..schemas import Health

router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=Health, summary="Liveness: the process is up")
async def healthz(settings: Annotated[Settings, Depends(get_settings)]) -> Health:
    return Health(status="ok", version=__version__, environment=settings.environment, database=True, redis=True)


@router.get("/readyz", response_model=Health, summary="Readiness: the database and Redis answer")
async def readyz(settings: Annotated[Settings, Depends(get_settings)], response: Response) -> Health:
    database = False
    redis_ok = False
    try:
        async with get_sessionmaker()() as session:
            await session.execute(text("SELECT 1"))
        database = True
    except Exception:
        database = False
    try:
        client: Redis = Redis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        try:
            redis_ok = bool(await client.ping())
        finally:
            await client.aclose()
    except Exception:
        redis_ok = False
    ok = database and (redis_ok or settings.environment == "test")
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return Health(
        status="ok" if ok else "degraded",
        version=__version__,
        environment=settings.environment,
        database=database,
        redis=redis_ok,
    )
