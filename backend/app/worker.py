"""Celery worker: the asynchronous half of the daily update engine.

Three periodic jobs. The morning brief is built shortly after the hour the
Kubernetes CronJob pings the API, so either path alone produces a brief and
both together produce the same one (a rebuild for a date replaces it). Every
job's decision lands in the audit ledger.

Each task opens its own engine and disposes it, because Celery forks and an
asyncpg pool must not cross a fork.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any, TypeVar

from celery import Celery
from celery.schedules import crontab
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from . import audit
from .clock import today_local
from .config import get_settings
from .db import make_engine
from .models import WebJob, utcnow
from .services import daily as daily_service
from .services import finance
from .web.factory import build_web_service

log = logging.getLogger("alldash.worker")
settings = get_settings()

celery_app = Celery("alldash", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone=settings.timezone,
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    result_expires=7 * 24 * 3600,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "build-daily-brief": {
            "task": "alldash.build_daily_brief",
            "schedule": crontab(hour=settings.daily_brief_hour, minute=5),
        },
        "mark-overdue-invoices": {"task": "alldash.mark_overdue_invoices", "schedule": crontab(minute=15)},
        "compute-burn-rate": {"task": "alldash.compute_burn_rate", "schedule": crontab(minute=30, hour="*/6")},
    },
)

T = TypeVar("T")


def run_async(fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    """Run one unit of work in a fresh engine and a single committed session."""

    async def _go() -> T:
        # A task holds one connection at a time; a big pool per fork would
        # multiply against Postgres's max_connections for nothing.
        engine = make_engine(settings.database_url, pool_size=1, max_overflow=2)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                try:
                    result = await fn(session)
                    await session.commit()
                    return result
                except Exception:
                    await session.rollback()
                    raise
        finally:
            await engine.dispose()

    return asyncio.run(_go())


@celery_app.task(name="alldash.build_daily_brief", bind=True, max_retries=3, default_retry_delay=60)
def build_daily_brief(self: Any, on: str | None = None) -> dict[str, Any]:
    brief_date = date.fromisoformat(on) if on else today_local()
    try:
        out = run_async(
            lambda s: daily_service.build_brief(
                s, brief_date, triggered_by="worker", window_days=settings.burn_rate_window_days
            )
        )
    except Exception as exc:  # noqa: BLE001 - retried with backoff, then surfaced
        log.exception("daily brief failed")
        raise self.retry(exc=exc) from exc
    log.info("daily brief built", extra={"brief_date": brief_date.isoformat(), "id": out.id})
    return {"id": out.id, "brief_date": out.brief_date.isoformat(), "summary": out.summary}


@celery_app.task(name="alldash.mark_overdue_invoices")
def mark_overdue_invoices() -> int:
    rows = run_async(lambda s: daily_service.mark_overdue(s, today_local(), actor="worker"))
    return len(rows)


@celery_app.task(name="alldash.compute_burn_rate")
def compute_burn_rate() -> dict[str, Any]:
    async def _work(session: AsyncSession) -> dict[str, Any]:
        rate = await finance.burn_rate(session, today_local(), settings.burn_rate_window_days)
        trend = (
            "flat"
            if rate.change_pct is None or abs(rate.change_pct) < 5
            else ("rising" if rate.change_pct > 0 else "falling")
        )
        await audit.record(
            session,
            actor="worker",
            action="burn_rate_computed",
            subject_type="finance",
            subject_id="burn-rate",
            decision=f"Rolling {rate.window_days}-day burn is {rate.daily_cents} cents/day ({trend})",
            rationale=(
                f"Expenses in window {rate.expenses_cents} cents against {rate.previous_window_cents} "
                f"cents in the window before"
            ),
            confidence=1.0 if rate.previous_window_cents else 0.7,
            inputs=rate.model_dump(),
        )
        return rate.model_dump()

    return run_async(_work)


@celery_app.task(name="alldash.web_job", bind=True, max_retries=5, acks_late=False)
def run_web_job(self: Any, job_id: str) -> dict[str, Any]:
    """A crawl or batch scrape too large for one request.

    acks_late is off for this task on purpose: a worker killed mid-crawl (an
    OOM on a huge site) must not have the same message redelivered forever.
    The row records the outcome instead, and a job found already "running"
    on pickup is marked failed as a lost worker.
    """

    async def _claim(session: AsyncSession) -> tuple[str, str, dict[str, Any]] | None:
        job = await session.get(WebJob, job_id)
        if job is None:
            return None
        if job.status == "running":
            job.status = "failed"
            job.error = "The worker running this job was lost before it finished"
            job.finished_at = utcnow()
            await session.flush()
            return ("failed", job.kind, {})
        if job.status != "queued":
            return (job.status, job.kind, {})
        job.status = "running"
        await session.flush()
        return ("running", job.kind, dict(job.request))

    claimed = run_async(_claim)
    if claimed is None:
        # The API commits before it enqueues, but a replica lagging behind can
        # still answer first; try again shortly rather than losing the job.
        raise self.retry(countdown=2)
    status, kind, request = claimed
    if status != "running":
        return {"id": job_id, "status": status}

    result: dict[str, Any] | None = None
    error = ""
    web = build_web_service(settings)
    try:
        if kind == "crawl":
            result = _run_async_web(
                web.crawl(
                    request["url"],
                    limit=int(request.get("limit", 20)),
                    max_depth=int(request.get("max_depth", 2)),
                    include=list(request.get("include") or []),
                    exclude=list(request.get("exclude") or []),
                    formats=tuple(request.get("formats") or ["markdown"]),
                )
            )
        else:
            result = _run_async_web(
                web.batch(
                    list(request["urls"]),
                    formats=tuple(request.get("formats") or ["markdown"]),
                    render=bool(request.get("render")),
                )
            )
    except Exception as exc:  # noqa: BLE001 - the job records its own failure
        error = str(exc)[:4000]
    finally:
        _run_async_web(web.aclose())

    async def _store(session: AsyncSession) -> dict[str, Any]:
        job = await session.get(WebJob, job_id)
        if job is None:
            return {"id": job_id, "status": "missing"}
        try:
            if error:
                job.status = "failed"
                job.error = error
            else:
                job.result = compact_result(result or {})
                job.status = "done"
            job.finished_at = utcnow()
            await session.flush()
        except Exception as exc:  # noqa: BLE001 - a result that cannot be stored is still a finished job
            await session.rollback()
            job = await session.get(WebJob, job_id)
            if job is not None:
                job.status = "failed"
                job.error = f"Could not store the result: {str(exc)[:2000]}"
                job.finished_at = utcnow()
                await session.flush()
        return {"id": job_id, "status": job.status if job else "missing"}

    out = run_async(_store)
    log.info("web job finished", extra=out)
    return out


STORED_MARKDOWN_MAX = 200_000


def compact_result(result: dict[str, Any]) -> dict[str, Any]:
    """What a job keeps: Markdown (capped per page), never the raw HTML, so one
    row stays a few megabytes at most rather than pages times the size cap."""
    pages = []
    for page in result.get("pages") or []:
        slim = {k: v for k, v in page.items() if k != "html"}
        text = slim.get("markdown")
        if isinstance(text, str) and len(text) > STORED_MARKDOWN_MAX:
            cut = len(text) - STORED_MARKDOWN_MAX
            slim["markdown"] = text[:STORED_MARKDOWN_MAX] + f"\n\n[truncated {cut} characters]"
        pages.append(slim)
    return {**result, "pages": pages}


def _run_async_web(coro: Awaitable[T]) -> T:
    """Run one web-tier coroutine on its own loop (Celery tasks are synchronous)."""
    return asyncio.run(coro)  # type: ignore[arg-type]
