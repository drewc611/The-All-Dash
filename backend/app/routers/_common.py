"""Shared helpers for the CRUD routers."""

from __future__ import annotations

from typing import Annotated, TypeVar

from fastapi import HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import Base

T = TypeVar("T", bound=Base)

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


async def get_or_404(session: AsyncSession, model: type[T], id_: str, label: str) -> T:
    row = await session.get(model, id_)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} {id_} not found")
    return row


async def paginate(session: AsyncSession, stmt: Select[tuple[T]], limit: int, offset: int) -> tuple[list[T], int]:
    total = int((await session.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))).scalar_one())
    rows = (await session.execute(stmt.limit(limit).offset(offset))).scalars().all()
    return list(rows), total


def apply_patch(row: Base, patch: dict[str, object]) -> None:
    for key, value in patch.items():
        setattr(row, key, value)
