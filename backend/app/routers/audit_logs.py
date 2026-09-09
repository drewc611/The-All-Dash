"""The ledger's read side, plus one append endpoint for external agents.

There is no PATCH and no DELETE here on purpose. On Postgres a trigger rejects
them at the table too.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..db import get_session
from ..models import AuditLog
from ..schemas import AuditActor, AuditLogIn, AuditLogOut, AuditVerification, Page
from ..security import Authed
from ._common import Limit, Offset, get_or_404, paginate

router = APIRouter(prefix="/ai-audit-logs", tags=["ai-audit-logs"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=Page[AuditLogOut], summary="Newest first")
async def list_logs(
    session: Session,
    _: Authed,
    actor: AuditActor | None = None,
    action: str | None = None,
    subject_type: str | None = None,
    subject_id: str | None = None,
    since: datetime | None = None,
    min_confidence: float | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[AuditLogOut]:
    stmt = select(AuditLog).order_by(AuditLog.seq.desc())
    if actor:
        stmt = stmt.where(AuditLog.actor == actor)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if subject_type:
        stmt = stmt.where(AuditLog.subject_type == subject_type)
    if subject_id:
        stmt = stmt.where(AuditLog.subject_id == subject_id)
    if since:
        stmt = stmt.where(AuditLog.created_at >= since)
    if min_confidence is not None:
        stmt = stmt.where(AuditLog.confidence >= min_confidence)
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[AuditLogOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/verify", response_model=AuditVerification, summary="Recompute every hash in the chain")
async def verify_chain(session: Session, _: Authed) -> AuditVerification:
    result = await audit.verify(session)
    return AuditVerification(
        ok=result.ok, checked=result.checked, first_bad_seq=result.first_bad_seq, head_hash=result.head_hash
    )


@router.post("", response_model=AuditLogOut, status_code=status.HTTP_201_CREATED, summary="Append a decision")
async def append_log(body: AuditLogIn, session: Session, _: Authed) -> AuditLogOut:
    entry = await audit.record(session, **body.model_dump())
    return AuditLogOut.model_validate(entry)


@router.get("/{log_id}", response_model=AuditLogOut)
async def get_log(log_id: str, session: Session, _: Authed) -> AuditLogOut:
    return AuditLogOut.model_validate(await get_or_404(session, AuditLog, log_id, "Audit entry"))
