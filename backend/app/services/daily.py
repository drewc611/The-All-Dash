"""The daily update engine.

One call builds the morning brief for a date: P1 items due that day, invoices
past due (and marks them overdue, which is a decision and is audited),
yesterday's activity, and the money picture. The brief is stored per date and
rebuilding a date replaces it, so the 4 AM CronJob and a manual rerun agree.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..models import AuditLog, DailyBrief, Expense, Invoice, Task
from ..schemas import DailyBriefOut, DailyBriefPayload, InvoiceOut, TaskOut
from . import finance


def _day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return start, start + timedelta(days=1)


async def mark_overdue(session: AsyncSession, as_of: date, actor: str = "system") -> list[Invoice]:
    """Sent invoices past their due date become overdue. Each one is a logged decision."""
    rows = (
        (await session.execute(select(Invoice).where(Invoice.status == "sent", Invoice.due_on < as_of)))
        .scalars()
        .all()
    )
    for inv in rows:
        days_late = (as_of - inv.due_on).days
        inv.status = "overdue"
        await audit.record(
            session,
            actor=actor,
            action="invoice_marked_overdue",
            subject_type="invoice",
            subject_id=inv.id,
            decision=f"Invoice {inv.number} for {inv.client} marked overdue",
            rationale=(
                f"Status was 'sent' and due_on {inv.due_on.isoformat()} is {days_late} day(s) "
                f"before {as_of.isoformat()}"
            ),
            confidence=1.0,
            inputs={"due_on": inv.due_on.isoformat(), "as_of": as_of.isoformat(), "amount_cents": inv.amount_cents},
        )
    await session.flush()
    return list(rows)


async def build_brief(
    session: AsyncSession, brief_date: date, *, triggered_by: str = "api", window_days: int = 30
) -> DailyBriefOut:
    yesterday = brief_date - timedelta(days=1)
    y_start, y_end = _day_bounds(yesterday)

    marked = await mark_overdue(session, brief_date, actor="worker" if triggered_by == "worker" else "system")

    p1 = (
        (
            await session.execute(
                select(Task)
                .where(Task.priority == "P1", Task.status != "done", Task.due_date == brief_date)
                .order_by(Task.context.asc(), Task.created_at.asc())
            )
        )
        .scalars()
        .all()
    )
    past_due = (
        (
            await session.execute(
                select(Invoice)
                .where(Invoice.status.in_(("sent", "overdue")), Invoice.due_on < brief_date)
                .order_by(Invoice.due_on.asc())
            )
        )
        .scalars()
        .all()
    )

    completed = int(
        (
            await session.execute(
                select(func.count(Task.id)).where(Task.completed_at >= y_start, Task.completed_at < y_end)
            )
        ).scalar_one()
    )
    created = int(
        (
            await session.execute(
                select(func.count(Task.id)).where(Task.created_at >= y_start, Task.created_at < y_end)
            )
        ).scalar_one()
    )
    paid = int(
        (await session.execute(select(func.count(Invoice.id)).where(Invoice.paid_on == yesterday))).scalar_one()
    )
    spent = int(
        (
            await session.execute(
                select(func.coalesce(func.sum(Expense.amount_cents), 0)).where(Expense.spent_on == yesterday)
            )
        ).scalar_one()
    )
    decisions = int(
        (
            await session.execute(
                select(func.count(AuditLog.id)).where(AuditLog.created_at >= y_start, AuditLog.created_at < y_end)
            )
        ).scalar_one()
    )

    money = await finance.summary(session, brief_date, window_days)

    payload = DailyBriefPayload(
        p1_due_today=[TaskOut.model_validate(t) for t in p1],
        past_due_invoices=[InvoiceOut.model_validate(i) for i in past_due],
        yesterday={
            "tasks_completed": completed,
            "tasks_created": created,
            "invoices_paid": paid,
            "spent_cents": spent,
            "decisions_logged": decisions,
        },
        finance=money,
        overdue_marked=[i.id for i in marked],
    )
    summary_text = _summarise(brief_date, payload)

    # Confidence reflects how complete the inputs were: a brief built on an
    # empty workspace is still correct, but it is not saying much.
    signals = len(p1) + len(past_due) + completed + created + paid + (1 if spent else 0)
    confidence = round(min(1.0, 0.5 + 0.1 * signals), 2)

    existing = (
        await session.execute(select(DailyBrief).where(DailyBrief.brief_date == brief_date))
    ).scalar_one_or_none()
    data: dict[str, Any] = payload.model_dump(mode="json")
    if existing:
        existing.generated_at = datetime.now(UTC)
        existing.triggered_by = triggered_by
        existing.summary = summary_text
        existing.payload = data
        brief = existing
    else:
        brief = DailyBrief(brief_date=brief_date, triggered_by=triggered_by, summary=summary_text, payload=data)
        session.add(brief)
    await session.flush()

    await audit.record(
        session,
        actor="worker" if triggered_by == "worker" else "system",
        action="daily_brief_built",
        subject_type="daily_brief",
        subject_id=brief.id,
        decision=f"Morning brief for {brief_date.isoformat()} built with {len(p1)} P1 item(s) and "
        f"{len(past_due)} past-due invoice(s)",
        rationale=summary_text,
        confidence=confidence,
        inputs={
            "brief_date": brief_date.isoformat(),
            "triggered_by": triggered_by,
            "p1_due_today": len(p1),
            "past_due_invoices": len(past_due),
            "yesterday": payload.yesterday,
            "burn_daily_cents": money.burn.daily_cents,
        },
    )
    return DailyBriefOut(
        id=brief.id,
        brief_date=brief.brief_date,
        generated_at=brief.generated_at,
        triggered_by=brief.triggered_by,
        summary=brief.summary,
        payload=payload,
    )


def _money(cents: int, currency: str) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}{currency} {abs(cents) / 100:,.2f}"


def _summarise(day: date, p: DailyBriefPayload) -> str:
    lines = [f"Morning brief for {day.strftime('%A %d %B %Y')}."]
    if p.p1_due_today:
        names = "; ".join(f"{t.title} ({t.context})" for t in p.p1_due_today[:5])
        more = f" and {len(p.p1_due_today) - 5} more" if len(p.p1_due_today) > 5 else ""
        lines.append(f"{len(p.p1_due_today)} P1 item(s) due today: {names}{more}.")
    else:
        lines.append("No P1 items due today.")
    if p.past_due_invoices:
        total = sum(i.amount_cents for i in p.past_due_invoices)
        lines.append(
            f"{len(p.past_due_invoices)} invoice(s) past due totalling {_money(total, p.finance.currency)}; "
            f"oldest is {p.past_due_invoices[0].number} for {p.past_due_invoices[0].client}."
        )
    else:
        lines.append("No invoices past due.")
    y = p.yesterday
    lines.append(
        f"Yesterday: {y['tasks_completed']} task(s) completed, {y['tasks_created']} created, "
        f"{y['invoices_paid']} invoice(s) paid, {_money(y['spent_cents'], p.finance.currency)} spent."
    )
    f = p.finance
    margin = f"{f.margin_pct:.1f}%" if f.margin_pct is not None else "n/a"
    change = f", {f.burn.change_pct:+.1f}% on the window before" if f.burn.change_pct is not None else ""
    lines.append(
        f"Last {f.burn.window_days} days: collected {_money(f.collected_cents, f.currency)}, "
        f"spent {_money(f.expenses_cents, f.currency)}, margin {margin}. "
        f"Burn {_money(f.burn.daily_cents, f.currency)}/day{change}."
    )
    return " ".join(lines)


async def latest(session: AsyncSession) -> DailyBrief | None:
    return (
        await session.execute(select(DailyBrief).order_by(DailyBrief.brief_date.desc()).limit(1))
    ).scalar_one_or_none()


def to_out(brief: DailyBrief) -> DailyBriefOut:
    return DailyBriefOut(
        id=brief.id,
        brief_date=brief.brief_date,
        generated_at=brief.generated_at,
        triggered_by=brief.triggered_by,
        summary=brief.summary,
        payload=DailyBriefPayload.model_validate(brief.payload),
    )
