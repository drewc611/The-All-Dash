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
from starlette.types import ASGIApp, Receive, Scope, Send

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
        web = getattr(app.state, "web", None)
        if web is not None:
            await web.aclose()
        await dispose_engine()


_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})


class BodyLimit:
    """Reject request bodies larger than the configured cap before a handler reads them.

    Pure ASGI, so it sits in front of everything. A body must declare its
    length: a chunked upload without Content-Length gets 411, one that is too
    long gets 413. Uvicorn reads no more than the declared length, so the cap
    is honoured whatever the client sends after the headers.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope.get("method") in _BODY_METHODS:
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
            length = headers.get("content-length")
            if length is None and "chunked" in headers.get("transfer-encoding", "").lower():
                await self._reject(send, 411, "Content-Length is required")
                return
            if length is not None and (not length.isdigit() or int(length) > self.max_bytes):
                await self._reject(send, 413, f"Request body exceeds {self.max_bytes} bytes")
                return
        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(send: Send, status: int, detail: str) -> None:
        body = f'{{"detail":"{detail}"}}'.encode()
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                    (b"cache-control", b"no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


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
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    app.add_middleware(BodyLimit, max_bytes=settings.max_body_bytes)
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
    app.include_router(routers.web.router)
    return app


app = create_app()
