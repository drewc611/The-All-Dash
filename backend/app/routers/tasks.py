from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Project, Task, utcnow
from ..schemas import Context, Page, TaskIn, TaskOut, TaskPatch, TaskPriority, TaskStatus
from ..security import Authed
from ._common import Limit, Offset, apply_patch, get_or_404, paginate

router = APIRouter(prefix="/tasks", tags=["tasks"])
Session = Annotated[AsyncSession, Depends(get_session)]

_priority_order = case((Task.priority == "P1", 0), (Task.priority == "P2", 1), else_=2)


async def _check_project(session: AsyncSession, project_id: str | None) -> None:
    if project_id is not None and await session.get(Project, project_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Project {project_id} not found")


@router.get("", response_model=Page[TaskOut])
async def list_tasks(
    session: Session,
    _: Authed,
    context: Context | None = None,
    status_: Annotated[TaskStatus | None, Query(alias="status")] = None,
    priority: TaskPriority | None = None,
    project_id: str | None = None,
    due_on: date | None = None,
    due_before: date | None = None,
    open_only: bool = False,
    limit: Limit = 100,
    offset: Offset = 0,
) -> Page[TaskOut]:
    stmt = select(Task).order_by(_priority_order, Task.due_date.asc().nulls_last(), Task.created_at.asc())
    if context:
        stmt = stmt.where(Task.context == context)
    if status_:
        stmt = stmt.where(Task.status == status_)
    if open_only:
        stmt = stmt.where(Task.status != "done")
    if priority:
        stmt = stmt.where(Task.priority == priority)
    if project_id:
        stmt = stmt.where(Task.project_id == project_id)
    if due_on:
        stmt = stmt.where(Task.due_date == due_on)
    if due_before:
        stmt = stmt.where(Task.due_date < due_before)
    rows, total = await paginate(session, stmt, limit, offset)
    return Page(items=[TaskOut.model_validate(r) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/today", response_model=list[TaskOut], summary="The checklist: open tasks due today or earlier, P1 first")
async def today(session: Session, _: Authed, context: Context | None = None, on: date | None = None) -> list[TaskOut]:
    day = on or date.today()
    stmt = (
        select(Task)
        .where(Task.status != "done", Task.due_date <= day)
        .order_by(_priority_order, Task.due_date.asc(), Task.created_at.asc())
    )
    if context:
        stmt = stmt.where(Task.context == context)
    rows = (await session.execute(stmt)).scalars().all()
    return [TaskOut.model_validate(r) for r in rows]


@router.post("", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(body: TaskIn, session: Session, _: Authed) -> TaskOut:
    await _check_project(session, body.project_id)
    row = Task(**body.model_dump())
    if row.status == "done":
        row.completed_at = utcnow()
    session.add(row)
    await session.flush()
    return TaskOut.model_validate(row)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: str, session: Session, _: Authed) -> TaskOut:
    return TaskOut.model_validate(await get_or_404(session, Task, task_id, "Task"))


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(task_id: str, body: TaskPatch, session: Session, _: Authed) -> TaskOut:
    row = await get_or_404(session, Task, task_id, "Task")
    patch = body.model_dump(exclude_unset=True)
    if "project_id" in patch:
        await _check_project(session, patch["project_id"])
    apply_patch(row, patch)
    if "status" in patch:
        row.completed_at = utcnow() if patch["status"] == "done" else None
    await session.flush()
    return TaskOut.model_validate(row)


@router.post("/{task_id}/toggle", response_model=TaskOut, summary="Open ⇄ done, the checklist's one click")
async def toggle_task(task_id: str, session: Session, _: Authed) -> TaskOut:
    row = await get_or_404(session, Task, task_id, "Task")
    if row.status == "done":
        row.status = "open"
        row.completed_at = None
    else:
        row.status = "done"
        row.completed_at = utcnow()
    await session.flush()
    return TaskOut.model_validate(row)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, session: Session, _: Authed) -> Response:
    row = await get_or_404(session, Task, task_id, "Task")
    await session.delete(row)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
