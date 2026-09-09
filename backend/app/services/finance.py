"""Money maths for the ribbon and the brief. Integer cents throughout."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Expense, Invoice
from ..schemas import BurnRate, FinanceSummary


async def _sum_expenses(session: AsyncSession, start: date, end: date) -> int:
    """Expenses with start <= spent_on < end."""
    stmt = select(func.coalesce(func.sum(Expense.amount_cents), 0)).where(
        Expense.spent_on >= start, Expense.spent_on < end
    )
    return int((await session.execute(stmt)).scalar_one())


async def burn_rate(session: AsyncSession, as_of: date, window_days: int = 30) -> BurnRate:
    """Average daily spend over the trailing window, against the window before it."""
    start = as_of - timedelta(days=window_days)
    current = await _sum_expenses(session, start, as_of + timedelta(days=1))
    previous = await _sum_expenses(session, start - timedelta(days=window_days), start)
    daily = round(current / window_days)
    change = None if previous == 0 else round((current - previous) / previous * 100, 1)
    return BurnRate(
        window_days=window_days,
        expenses_cents=current,
        daily_cents=daily,
        monthly_cents=daily * 30,
        previous_window_cents=previous,
        change_pct=change,
    )


async def summary(session: AsyncSession, as_of: date, window_days: int = 30, currency: str = "USD") -> FinanceSummary:
    """The ribbon: what was invoiced, what came in, what is out, what it cost."""
    start = as_of - timedelta(days=window_days)
    billable = Invoice.status.in_(("sent", "paid", "overdue"))

    invoiced = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(Invoice.amount_cents), 0)).where(
                    billable, Invoice.issued_on >= start, Invoice.issued_on <= as_of
                )
            )
        ).scalar_one()
    )
    collected = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(Invoice.amount_cents), 0)).where(
                    Invoice.status == "paid", Invoice.paid_on >= start, Invoice.paid_on <= as_of
                )
            )
        ).scalar_one()
    )
    outstanding = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(Invoice.amount_cents), 0)).where(
                    Invoice.status.in_(("sent", "overdue"))
                )
            )
        ).scalar_one()
    )
    overdue_row = (
        await session.execute(
            select(func.coalesce(func.sum(Invoice.amount_cents), 0), func.count(Invoice.id)).where(
                Invoice.status.in_(("sent", "overdue")), Invoice.due_on < as_of
            )
        )
    ).one()
    expenses = await _sum_expenses(session, start, as_of + timedelta(days=1))
    margin = collected - expenses
    margin_pct = None if collected == 0 else round(margin / collected * 100, 1)
    return FinanceSummary(
        as_of=as_of,
        currency=currency,
        invoiced_cents=invoiced,
        collected_cents=collected,
        outstanding_cents=outstanding,
        overdue_cents=int(overdue_row[0]),
        overdue_count=int(overdue_row[1]),
        expenses_cents=expenses,
        margin_cents=margin,
        margin_pct=margin_pct,
        burn=await burn_rate(session, as_of, window_days),
    )
