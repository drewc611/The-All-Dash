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
from .config import get_settings
from .db import make_engine
from .services import daily as daily_service
from .services import finance

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
        engine = make_engine(settings.database_url)
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
    brief_date = date.fromisoformat(on) if on else date.today()
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
    rows = run_async(lambda s: daily_service.mark_overdue(s, date.today(), actor="worker"))
    return len(rows)


@celery_app.task(name="alldash.compute_burn_rate")
def compute_burn_rate() -> dict[str, Any]:
    async def _work(session: AsyncSession) -> dict[str, Any]:
        rate = await finance.burn_rate(session, date.today(), settings.burn_rate_window_days)
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
