"""Build one WebService from settings; the app keeps it for its lifetime."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import Request

from ..config import Settings, get_settings
from .fetch import Fetcher
from .firecrawl import Firecrawl
from .llm import DEFAULT_BASE, DEFAULT_MODELS, Llm, LlmConfig
from .service import Limits, WebService


def build_web_service(
    settings: Settings,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    llm_transport: httpx.AsyncBaseTransport | None = None,
) -> WebService:
    fetcher = Fetcher(
        user_agent=settings.web_user_agent,
        timeout=settings.web_timeout_seconds,
        max_bytes=settings.web_max_bytes,
        per_host_interval=settings.web_per_host_interval,
        respect_robots=settings.web_respect_robots,
        allow_private=settings.web_allow_private,
        transport=transport,
    )
    firecrawl = (
        Firecrawl(settings.firecrawl_api_key, settings.firecrawl_url, transport=transport)
        if settings.firecrawl_api_key
        else None
    )
    llm = None
    if settings.llm_provider:
        config = LlmConfig(
            provider=settings.llm_provider,
            model=settings.llm_model or DEFAULT_MODELS[settings.llm_provider],
            api_key=settings.llm_api_key,
            base_url=(settings.llm_base_url or DEFAULT_BASE[settings.llm_provider]).rstrip("/"),
        )
        llm = Llm(config, transport=llm_transport)
    service = WebService(
        fetcher,
        firecrawl=firecrawl,
        llm=llm,
        limits=Limits(max_pages=settings.web_max_pages, sync_max_pages=settings.web_sync_max_pages),
    )
    service.budget_seconds = settings.web_request_budget_seconds
    return service


def get_web(request: Request) -> WebService:
    """FastAPI dependency: the app's service, built on first use."""
    state: Any = request.app.state
    service = getattr(state, "web", None)
    if service is None:
        service = build_web_service(get_settings())
        state.web = service
    return service
