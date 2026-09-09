"""The daily update engine's HTTP face.

POST /daily/run is what the 4 AM CronJob calls. With `sync=true` the brief is
built inside the request and returned, which is what a cron ping wants: a
non-2xx means it did not happen. Without it the work is handed to the Celery
worker and a task id comes back.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings, get_settings
from ..db import get_session
from ..models import DailyBrief
from ..schemas import DailyBriefOut, DailyRunAccepted
from ..security import Authed
from ..services import daily as daily_service

router = APIRouter(prefix="/daily", tags=["daily"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.post("/run", response_model=DailyRunAccepted, status_code=status.HTTP_202_ACCEPTED)
async def run_daily(
    session: Session,
    _: Authed,
    settings: Annotated[Settings, Depends(get_settings)],
    on: date | None = None,
    sync: bool = False,
) -> DailyRunAccepted:
    brief_date = on or date.today()
    if sync:
        brief = await daily_service.build_brief(
            session, brief_date, triggered_by="api", window_days=settings.burn_rate_window_days
        )
        return DailyRunAccepted(status="built", brief_date=brief_date, brief=brief)
    from ..worker import build_daily_brief  # imported here so the API never needs a broker at import time

    result = build_daily_brief.delay(brief_date.isoformat())
    return DailyRunAccepted(status="queued", brief_date=brief_date, task_id=result.id)


@router.get("/latest", response_model=DailyBriefOut)
async def latest(session: Session, _: Authed) -> DailyBriefOut:
    brief = await daily_service.latest(session)
    if brief is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No brief has been built yet")
    return daily_service.to_out(brief)


@router.get("/{brief_date}", response_model=DailyBriefOut)
async def by_date(brief_date: date, session: Session, _: Authed) -> DailyBriefOut:
    brief = (await session.execute(select(DailyBrief).where(DailyBrief.brief_date == brief_date))).scalar_one_or_none()
    if brief is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No brief for {brief_date.isoformat()}")
    return daily_service.to_out(brief)
