"""One idea of "today", in the configured zone.

ALLDASH_TIMEZONE decides when a day rolls over for the checklist, the brief,
overdue invoices and the burn-rate window. Everything that asks what day it
is asks here, so the API, the worker and beat agree.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .config import get_settings


def zone() -> ZoneInfo:
    try:
        return ZoneInfo(get_settings().timezone)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def now_local() -> datetime:
    return datetime.now(zone())


def today_local() -> date:
    return now_local().date()


def day_bounds(day: date) -> tuple[datetime, datetime]:
    """[start, end) of a calendar day in the configured zone, as aware datetimes."""
    start = datetime(day.year, day.month, day.day, tzinfo=zone())
    return start.astimezone(UTC), (start + timedelta(days=1)).astimezone(UTC)
