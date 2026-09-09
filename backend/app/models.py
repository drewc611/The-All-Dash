"""ORM models.

Money is stored in integer cents, never floats. Enumerations are strings with
check constraints so the schema reads the same on Postgres and on the SQLite
used by the test suite. Identifiers are UUID4 strings generated in the
application so a row can be referenced before it is flushed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

CONTEXTS = ("work", "personal")
PROJECT_STAGES = ("idea", "planning", "in_progress", "review", "done")
PROJECT_STATUSES = ("active", "paused", "done")
TASK_PRIORITIES = ("P1", "P2", "P3")
TASK_STATUSES = ("open", "doing", "done")
INVOICE_STATUSES = ("draft", "sent", "paid", "overdue", "void")
AUDIT_ACTORS = ("system", "worker", "user", "assistant")
WEB_JOB_KINDS = ("crawl", "batch")
WEB_JOB_STATUSES = ("queued", "running", "done", "failed")


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(UTC)


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


class Project(TimestampMixin, Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(_in("context", CONTEXTS), name="ck_projects_context"),
        CheckConstraint(_in("stage", PROJECT_STAGES), name="ck_projects_stage"),
        CheckConstraint(_in("status", PROJECT_STATUSES), name="ck_projects_status"),
        CheckConstraint("budget_cents >= 0", name="ck_projects_budget"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    context: Mapped[str] = mapped_column(String(16), default="work", nullable=False)
    stage: Mapped[str] = mapped_column(String(16), default="planning", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="active", nullable=False)
    budget_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    tasks: Mapped[list[Task]] = relationship(back_populates="project", cascade="all, delete-orphan")
    invoices: Mapped[list[Invoice]] = relationship(back_populates="project")
    expenses: Mapped[list[Expense]] = relationship(back_populates="project")


class Task(TimestampMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint(_in("context", CONTEXTS), name="ck_tasks_context"),
        CheckConstraint(_in("priority", TASK_PRIORITIES), name="ck_tasks_priority"),
        CheckConstraint(_in("status", TASK_STATUSES), name="ck_tasks_status"),
        Index("ix_tasks_due_date", "due_date"),
        Index("ix_tasks_context_status", "context", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(400), nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    context: Mapped[str] = mapped_column(String(16), default="work", nullable=False)
    priority: Mapped[str] = mapped_column(String(2), default="P2", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="open", nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    project: Mapped[Project | None] = relationship(back_populates="tasks")


class Invoice(TimestampMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint(_in("status", INVOICE_STATUSES), name="ck_invoices_status"),
        CheckConstraint("amount_cents >= 0", name="ck_invoices_amount"),
        Index("ix_invoices_status_due", "status", "due_on"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    number: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    client: Mapped[str] = mapped_column(String(200), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="draft", nullable=False)
    issued_on: Mapped[date] = mapped_column(Date, nullable=False)
    due_on: Mapped[date] = mapped_column(Date, nullable=False)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)

    project: Mapped[Project | None] = relationship(back_populates="invoices")


class Expense(TimestampMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount_cents >= 0", name="ck_expenses_amount"),
        Index("ix_expenses_spent_on", "spent_on"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True
    )
    vendor: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(64), default="general", nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    spent_on: Mapped[date] = mapped_column(Date, nullable=False)
    recurring: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)

    project: Mapped[Project | None] = relationship(back_populates="expenses")


class AuditLog(Base):
    """One decision, appended once, never changed.

    `seq` orders the chain; `prev_hash` is the previous row's `hash`; `hash`
    covers this row's content plus `prev_hash`. Change any row and every hash
    after it stops matching, which is what /ai-audit-logs/verify checks. On
    Postgres a trigger (see the initial migration) also rejects UPDATE and
    DELETE outright.
    """

    __tablename__ = "ai_audit_logs"
    __table_args__ = (
        CheckConstraint(_in("actor", AUDIT_ACTORS), name="ck_audit_actor"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_audit_confidence"),
        Index("ix_audit_created", "created_at"),
        Index("ix_audit_subject", "subject_type", "subject_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    seq: Mapped[int] = mapped_column(Integer, unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    actor: Mapped[str] = mapped_column(String(16), nullable=False)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    subject_type: Mapped[str] = mapped_column(String(32), nullable=False)
    subject_id: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    decision: Mapped[str] = mapped_column(Text, nullable=False)
    rationale: Mapped[str] = mapped_column(Text, default="", nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    inputs: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)

    def payload(self) -> dict[str, Any]:
        """The fields that the hash covers, in a stable shape.

        The timestamp is normalised to UTC with microseconds and a Z suffix so
        the hash is the same whether the row is in memory or read back from a
        database that drops the timezone (SQLite) or keeps it (Postgres).
        """
        ts = self.created_at if self.created_at.tzinfo else self.created_at.replace(tzinfo=UTC)
        return {
            "id": self.id,
            "seq": self.seq,
            "created_at": ts.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
            "actor": self.actor,
            "action": self.action,
            "subject_type": self.subject_type,
            "subject_id": self.subject_id,
            "decision": self.decision,
            "rationale": self.rationale,
            "confidence": round(float(self.confidence), 6),
            "inputs": self.inputs,
        }


class DailyBrief(Base):
    """The morning brief for one day, rebuilt by the daily update engine."""

    __tablename__ = "daily_briefs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    brief_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    triggered_by: Mapped[str] = mapped_column(String(32), default="api", nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class WebJob(Base):
    """A crawl or batch scrape too large for one request, run by the worker."""

    __tablename__ = "web_jobs"
    __table_args__ = (
        CheckConstraint(_in("kind", WEB_JOB_KINDS), name="ck_web_jobs_kind"),
        CheckConstraint(_in("status", WEB_JOB_STATUSES), name="ck_web_jobs_status"),
        Index("ix_web_jobs_status_created", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="queued")
    request: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
