from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import Settings, get_settings
from ..db import get_session
from ..schemas import BurnRate, FinanceSummary
from ..security import Authed
from ..services import finance

router = APIRouter(prefix="/finance", tags=["finance"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("/summary", response_model=FinanceSummary, summary="The margin ribbon")
async def get_summary(
    session: Session,
    _: Authed,
    settings: Annotated[Settings, Depends(get_settings)],
    as_of: date | None = None,
    window_days: Annotated[int | None, Query(ge=7, le=365)] = None,
) -> FinanceSummary:
    return await finance.summary(session, as_of or date.today(), window_days or settings.burn_rate_window_days)


@router.get("/burn-rate", response_model=BurnRate)
async def get_burn_rate(
    session: Session,
    _: Authed,
    settings: Annotated[Settings, Depends(get_settings)],
    as_of: date | None = None,
    window_days: Annotated[int | None, Query(ge=7, le=365)] = None,
) -> BurnRate:
    return await finance.burn_rate(session, as_of or date.today(), window_days or settings.burn_rate_window_days)
