from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Expense
from ..schemas import ExpenseIn, ExpenseOut, ExpensePatch, Page
from ..security import Authed
from ._common import Limit, Offset, apply_patch, check_project, get_or_404, paginate

router = APIRouter(prefix="/expenses", tags=["expenses"])
Session = Annotated[AsyncSession, Depends(get_session, scope="function")]


@router.get("", response_model=Page[ExpenseOut])
async def list_expenses(
    session: Session,
    _: Authed,
    project_id: str | None = None,
    category: str | None = None,
    since: date | None = None,
    until: date | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> Page[ExpenseOut]:
    stmt = select(Expense).order_by(Expense.spent_on.desc(), Expense.created_at.desc())
    if project_id:
        stmt = stmt.where(Expense.project_id == project_id)
    if category:
        stmt = stmt.where(Expense.category == category)
    if since:
        stmt = stmt.where(Expense.spent_on >= since)
    if until:
        stmt = stmt.where(Expense.spent_on <= until)
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[ExpenseOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.post("", response_model=ExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_expense(body: ExpenseIn, session: Session, _: Authed) -> ExpenseOut:
    await check_project(session, body.project_id)
    row = Expense(**body.model_dump())
    session.add(row)
    await session.flush()
    return ExpenseOut.model_validate(row)


@router.get("/{expense_id}", response_model=ExpenseOut)
async def get_expense(expense_id: str, session: Session, _: Authed) -> ExpenseOut:
    return ExpenseOut.model_validate(await get_or_404(session, Expense, expense_id, "Expense"))


@router.patch("/{expense_id}", response_model=ExpenseOut)
async def update_expense(expense_id: str, body: ExpensePatch, session: Session, _: Authed) -> ExpenseOut:
    row = await get_or_404(session, Expense, expense_id, "Expense")
    patch = body.model_dump(exclude_unset=True)
    if "project_id" in patch:
        await check_project(session, patch["project_id"])
    apply_patch(row, patch)
    await session.flush()
    return ExpenseOut.model_validate(row)


@router.delete("/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expense(expense_id: str, session: Session, _: Authed) -> Response:
    row = await get_or_404(session, Expense, expense_id, "Expense")
    await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
