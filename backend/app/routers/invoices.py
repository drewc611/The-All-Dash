from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..clock import today_local
from ..db import get_session
from ..models import Invoice
from ..schemas import InvoiceIn, InvoiceOut, InvoicePatch, InvoiceStatus, Page
from ..security import Authed
from ..services.daily import mark_overdue
from ._common import Limit, Offset, apply_patch, check_project, get_or_404, paginate

router = APIRouter(prefix="/invoices", tags=["invoices"])
Session = Annotated[AsyncSession, Depends(get_session, scope="function")]


@router.get("", response_model=Page[InvoiceOut])
async def list_invoices(
    session: Session,
    _: Authed,
    status_: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    project_id: str | None = None,
    past_due: bool = False,
    limit: Limit = 100,
    offset: Offset = 0,
) -> Page[InvoiceOut]:
    stmt = select(Invoice).order_by(Invoice.due_on.asc(), Invoice.created_at.asc())
    if status_:
        stmt = stmt.where(Invoice.status == status_)
    if project_id:
        stmt = stmt.where(Invoice.project_id == project_id)
    if past_due:
        stmt = stmt.where(Invoice.status.in_(("sent", "overdue")), Invoice.due_on < today_local())
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[InvoiceOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.post("", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
async def create_invoice(body: InvoiceIn, session: Session, _: Authed) -> InvoiceOut:
    if body.due_on < body.issued_on:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="due_on is before issued_on")
    await check_project(session, body.project_id)
    row = Invoice(**body.model_dump())
    session.add(row)
    try:
        await session.flush()
    except IntegrityError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invoice {body.number} exists") from exc
    return InvoiceOut.model_validate(row)


@router.post("/mark-overdue", response_model=list[InvoiceOut], summary="Run the overdue decision now")
async def run_mark_overdue(session: Session, _: Authed, as_of: date | None = None) -> list[InvoiceOut]:
    rows = await mark_overdue(session, as_of or today_local(), actor="user")
    return [InvoiceOut.model_validate(r) for r in rows]


@router.get("/{invoice_id}", response_model=InvoiceOut)
async def get_invoice(invoice_id: str, session: Session, _: Authed) -> InvoiceOut:
    return InvoiceOut.model_validate(await get_or_404(session, Invoice, invoice_id, "Invoice"))


@router.patch("/{invoice_id}", response_model=InvoiceOut)
async def update_invoice(invoice_id: str, body: InvoicePatch, session: Session, _: Authed) -> InvoiceOut:
    row = await get_or_404(session, Invoice, invoice_id, "Invoice")
    patch = body.model_dump(exclude_unset=True)
    if "project_id" in patch:
        await check_project(session, patch["project_id"])
    if patch.get("status") == "paid" and not (patch.get("paid_on") or row.paid_on):
        patch["paid_on"] = today_local()
    apply_patch(row, patch)
    await session.flush()
    return InvoiceOut.model_validate(row)


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_invoice(invoice_id: str, session: Session, _: Authed) -> Response:
    row = await get_or_404(session, Invoice, invoice_id, "Invoice")
    await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
