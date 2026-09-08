from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Expense, Invoice, Project, Task
from ..schemas import (
    Context,
    Page,
    ProjectIn,
    ProjectOut,
    ProjectPatch,
    ProjectPipeline,
    ProjectStage,
    ProjectStatus,
)
from ..security import Authed
from ._common import Limit, Offset, apply_patch, get_or_404, paginate

router = APIRouter(prefix="/projects", tags=["projects"])
Session = Annotated[AsyncSession, Depends(get_session)]


@router.get("", response_model=Page[ProjectOut])
async def list_projects(
    session: Session,
    _: Authed,
    context: Context | None = None,
    stage: ProjectStage | None = None,
    status_: Annotated[ProjectStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> Page[ProjectOut]:
    stmt = select(Project).order_by(Project.created_at.desc())
    if context:
        stmt = stmt.where(Project.context == context)
    if stage:
        stmt = stmt.where(Project.stage == stage)
    if status_:
        stmt = stmt.where(Project.status == status_)
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[ProjectOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/pipeline", response_model=list[ProjectPipeline], summary="Every active project with its counts")
async def pipeline(session: Session, _: Authed, context: Context | None = None) -> list[ProjectPipeline]:
    stmt = select(Project).where(Project.status != "done").order_by(Project.stage.asc(), Project.created_at.asc())
    if context:
        stmt = stmt.where(Project.context == context)
    projects = (await session.execute(stmt)).scalars().all()
    if not projects:
        return []
    ids = [p.id for p in projects]

    task_counts = (
        await session.execute(
            select(
                Task.project_id,
                func.sum(case((Task.status != "done", 1), else_=0)),
                func.sum(case((Task.status == "done", 1), else_=0)),
                func.sum(case(((Task.status != "done") & (Task.priority == "P1"), 1), else_=0)),
            )
            .where(Task.project_id.in_(ids))
            .group_by(Task.project_id)
        )
    ).all()
    spent = (
        await session.execute(
            select(Expense.project_id, func.sum(Expense.amount_cents))
            .where(Expense.project_id.in_(ids))
            .group_by(Expense.project_id)
        )
    ).all()
    invoiced = (
        await session.execute(
            select(Invoice.project_id, func.sum(Invoice.amount_cents))
            .where(Invoice.project_id.in_(ids), Invoice.status.in_(("sent", "paid", "overdue")))
            .group_by(Invoice.project_id)
        )
    ).all()
    tc = {row[0]: (int(row[1] or 0), int(row[2] or 0), int(row[3] or 0)) for row in task_counts}
    sp = {row[0]: int(row[1] or 0) for row in spent}
    inv = {row[0]: int(row[1] or 0) for row in invoiced}
    return [
        ProjectPipeline(
            project=ProjectOut.model_validate(p),
            open_tasks=tc.get(p.id, (0, 0, 0))[0],
            done_tasks=tc.get(p.id, (0, 0, 0))[1],
            p1_open=tc.get(p.id, (0, 0, 0))[2],
            spent_cents=sp.get(p.id, 0),
            invoiced_cents=inv.get(p.id, 0),
        )
        for p in projects
    ]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectIn, session: Session, _: Authed) -> ProjectOut:
    row = Project(**body.model_dump())
    session.add(row)
    await session.flush()
    return ProjectOut.model_validate(row)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: str, session: Session, _: Authed) -> ProjectOut:
    return ProjectOut.model_validate(await get_or_404(session, Project, project_id, "Project"))


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: str, body: ProjectPatch, session: Session, _: Authed) -> ProjectOut:
    row = await get_or_404(session, Project, project_id, "Project")
    apply_patch(row, body.model_dump(exclude_unset=True))
    await session.flush()
    return ProjectOut.model_validate(row)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: str, session: Session, _: Authed) -> Response:
    row = await get_or_404(session, Project, project_id, "Project")
    await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
