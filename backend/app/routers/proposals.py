from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Task, TaskProposal
from ..schemas import Page, ProposalOut, ProposalState
from ..security import Authed
from ..services import proposals as service
from ._common import Limit, Offset, get_or_404, paginate

router = APIRouter(prefix="/proposals", tags=["proposals"])
Session = Annotated[AsyncSession, Depends(get_session, scope="function")]


def _out(row: TaskProposal, task: Task | None) -> ProposalOut:
    return ProposalOut(
        id=row.id,
        task_id=row.task_id,
        task_title=task.title if task else "",
        rule=row.rule,
        field=row.field,
        from_value=row.from_value,
        to_value=row.to_value,
        reason=row.reason,
        state=row.state,
        created_at=row.created_at,
        decided_at=row.decided_at,
        decided_by=row.decided_by,
        outcome_ok=row.outcome_ok,
        observed=row.observed,
        # Said before the button is pressed rather than discovered after it.
        blocked_because=service.blocked_because(row, task),
    )


@router.get("", response_model=Page[ProposalOut])
async def list_proposals(
    session: Session,
    _: Authed,
    state: ProposalState | None = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> Page[ProposalOut]:
    stmt = select(TaskProposal).order_by(TaskProposal.created_at.desc())
    if state:
        stmt = stmt.where(TaskProposal.state == state)
    rows, total = await paginate(session, stmt, limit, offset)
    tasks = {t.id: t for t in (await session.execute(select(Task))).scalars().all()}
    return Page(items=[_out(r, tasks.get(r.task_id)) for r in rows], total=total, limit=limit, offset=offset)


@router.post("/{proposal_id}/apply", response_model=ProposalOut)
async def apply_proposal(session: Session, auth: Authed, proposal_id: str) -> ProposalOut:
    """Apply one proposal.

    Deliberately one at a time, and deliberately no bulk endpoint. A review
    queue with an approve-everything button is a queue nobody reads, and this
    is the only path in the whole service that changes a task because a rule
    said so. The worker cannot reach it.
    """
    row = await get_or_404(session, TaskProposal, proposal_id, "proposal")
    if row.state != "proposed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"proposal {proposal_id} was already {row.state}",
        )
    await service.apply(session, row, actor="user")
    await session.commit()
    return _out(row, await session.get(Task, row.task_id))


@router.post("/{proposal_id}/decline", response_model=ProposalOut)
async def decline_proposal(session: Session, auth: Authed, proposal_id: str) -> ProposalOut:
    row = await get_or_404(session, TaskProposal, proposal_id, "proposal")
    if row.state != "proposed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"proposal {proposal_id} was already {row.state}",
        )
    await service.decline(session, row, actor="user")
    await session.commit()
    return _out(row, await session.get(Task, row.task_id))
