"""Seed a workspace worth looking at. Idempotent: reruns update in place.

    python -m scripts.seed            # uses ALLDASH_DATABASE_URL
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import get_settings
from app.db import Base, make_engine
from app.models import Expense, Invoice, Project, Task
from app.services.daily import build_brief

today = date.today()
d = lambda n: today + timedelta(days=n)  # noqa: E731

PROJECTS = [
    {"name": "Atlas migration", "context": "work", "stage": "in_progress", "budget_cents": 4_800_000, "target_date": d(40),
     "description": "Move tenants to the new cluster behind a per-tenant flag."},
    {"name": "Website relaunch", "context": "work", "stage": "review", "budget_cents": 1_500_000, "target_date": d(12)},
    {"name": "Q4 pricing", "context": "work", "stage": "planning", "budget_cents": 0, "target_date": d(60)},
    {"name": "Home office", "context": "personal", "stage": "in_progress", "budget_cents": 350_000, "target_date": d(20)},
    {"name": "Marathon", "context": "personal", "stage": "idea", "budget_cents": 60_000, "target_date": d(120)},
]

TASKS = [
    ("Atlas migration", "Rewrite the rollback script for the write path", "P1", "open", 0),
    ("Atlas migration", "Benchmark p99 on the new cluster", "P2", "doing", 3),
    ("Atlas migration", "Get sign-off from Legal on the residency note", "P1", "open", 0),
    ("Atlas migration", "Publish the cutover runbook", "P2", "done", -2),
    ("Website relaunch", "Approve the final homepage copy", "P1", "open", -1),
    ("Website relaunch", "Fix the mobile nav overlap", "P2", "open", 1),
    ("Q4 pricing", "Pull churn by plan for the last two quarters", "P3", "open", 5),
    ("Home office", "Order the standing desk", "P2", "open", 0),
    ("Home office", "Book the electrician", "P1", "open", 0),
    ("Marathon", "Sign up for the 10k in October", "P3", "open", 9),
    (None, "Renew passport", "P2", "open", 14),
    (None, "Call the dentist", "P3", "done", -1),
]

INVOICES = [
    ("Atlas migration", "INV-2026-031", "Northwind", 1_250_000, "sent", -35, -5, None),
    ("Atlas migration", "INV-2026-034", "Northwind", 1_250_000, "sent", -7, 23, None),
    ("Website relaunch", "INV-2026-029", "Contoso", 620_000, "paid", -28, 2, -1),
    ("Q4 pricing", "INV-2026-035", "Fabrikam", 180_000, "draft", 0, 30, None),
]

EXPENSES = [
    ("Atlas migration", "AWS", "cloud", 214_500, -1, True),
    ("Atlas migration", "AWS", "cloud", 208_900, -31, True),
    ("Atlas migration", "Datadog", "cloud", 42_000, -3, True),
    ("Website relaunch", "Figma", "software", 4_500, -10, True),
    ("Website relaunch", "Stock photos", "content", 12_900, -6, False),
    ("Home office", "IKEA", "furniture", 89_900, -4, False),
    (None, "Coffee", "food", 450, -1, False),
    (None, "Coffee", "food", 520, -2, False),
    (None, "Train", "travel", 3_200, -40, False),
]


async def main() -> None:
    engine = make_engine(get_settings().database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        by_name: dict[str, Project] = {}
        for spec in PROJECTS:
            row = (await session.execute(select(Project).where(Project.name == spec["name"]))).scalar_one_or_none()
            if row is None:
                row = Project(**spec)
                session.add(row)
            else:
                for k, v in spec.items():
                    setattr(row, k, v)
            by_name[spec["name"]] = row
        await session.flush()

        for project, title, priority, status, offset in TASKS:
            row = (await session.execute(select(Task).where(Task.title == title))).scalar_one_or_none()
            values = {
                "title": title,
                "priority": priority,
                "status": status,
                "due_date": d(offset),
                "context": by_name[project].context if project else "personal",
                "project_id": by_name[project].id if project else None,
            }
            if row is None:
                row = Task(**values)
                session.add(row)
            else:
                for k, v in values.items():
                    setattr(row, k, v)

        for project, number, client, amount, status, issued, due, paid in INVOICES:
            row = (await session.execute(select(Invoice).where(Invoice.number == number))).scalar_one_or_none()
            values = {
                "number": number,
                "client": client,
                "amount_cents": amount,
                "status": status,
                "issued_on": d(issued),
                "due_on": d(due),
                "paid_on": d(paid) if paid is not None else None,
                "project_id": by_name[project].id,
            }
            if row is None:
                session.add(Invoice(**values))
            else:
                for k, v in values.items():
                    setattr(row, k, v)

        for project, vendor, category, amount, offset, recurring in EXPENSES:
            row = (
                await session.execute(
                    select(Expense).where(Expense.vendor == vendor, Expense.spent_on == d(offset), Expense.amount_cents == amount)
                )
            ).scalar_one_or_none()
            if row is None:
                session.add(
                    Expense(
                        vendor=vendor,
                        category=category,
                        amount_cents=amount,
                        spent_on=d(offset),
                        recurring=recurring,
                        project_id=by_name[project].id if project else None,
                    )
                )
        await session.flush()
        brief = await build_brief(session, today, triggered_by="seed")
        await session.commit()
        print(brief.summary)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
