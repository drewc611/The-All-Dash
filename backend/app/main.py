"""FastAPI application factory.

Routers are thin; the services do the work and the ledger records the
decisions. Middleware adds a request id to every response and every log line,
so a pod log and a browser network tab can be matched by eye.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pythonjsonlogger.json import JsonFormatter

from . import __version__, routers
from .config import get_settings
from .db import Base, dispose_engine, get_engine

log = logging.getLogger("alldash")


def configure_logging(level: str) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    logging.getLogger("uvicorn.access").disabled = True


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    settings.validate_for_environment()
    configure_logging(settings.log_level)
    engine = get_engine()
    if settings.environment != "production":
        # Production schemas come from Alembic (see alembic/), which also
        # installs the immutability trigger. Local and test just want tables.
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    log.info("startup", extra={"environment": settings.environment, "version": __version__})
    try:
        yield
    finally:
        await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "Projects, tasks (work or personal), invoices, expenses, a hash-chained AI audit ledger, "
            "and the daily update engine that builds the morning brief."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Key", settings.request_id_header],
        expose_headers=[settings.request_id_header],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get(settings.request_id_header) or uuid.uuid4().hex
        started = time.perf_counter()
        response = await call_next(request)
        response.headers[settings.request_id_header] = request_id
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        log.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "ms": round((time.perf_counter() - started) * 1000, 1),
            },
        )
        return response

    app.include_router(routers.health.router)
    app.include_router(routers.projects.router)
    app.include_router(routers.tasks.router)
    app.include_router(routers.invoices.router)
    app.include_router(routers.expenses.router)
    app.include_router(routers.audit_logs.router)
    app.include_router(routers.daily.router)
    app.include_router(routers.finance.router)
    return app


app = create_app()
