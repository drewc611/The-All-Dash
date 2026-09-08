"""Request and response shapes. Strict: unknown fields are rejected."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

Context = Literal["work", "personal"]
ProjectStage = Literal["idea", "planning", "in_progress", "review", "done"]
ProjectStatus = Literal["active", "paused", "done"]
TaskPriority = Literal["P1", "P2", "P3"]
TaskStatus = Literal["open", "doing", "done"]
InvoiceStatus = Literal["draft", "sent", "paid", "overdue", "void"]
AuditActor = Literal["system", "worker", "user", "assistant"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OrmModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ projects


class ProjectIn(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=8000)
    context: Context = "work"
    stage: ProjectStage = "planning"
    status: ProjectStatus = "active"
    budget_cents: int = Field(default=0, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    target_date: date | None = None


class ProjectPatch(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=8000)
    context: Context | None = None
    stage: ProjectStage | None = None
    status: ProjectStatus | None = None
    budget_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    target_date: date | None = None


class ProjectOut(OrmModel):
    id: str
    name: str
    description: str
    context: Context
    stage: ProjectStage
    status: ProjectStatus
    budget_cents: int
    currency: str
    target_date: date | None
    created_at: datetime
    updated_at: datetime


class ProjectPipeline(BaseModel):
    """A project plus the counts the left column needs."""

    project: ProjectOut
    open_tasks: int
    done_tasks: int
    p1_open: int
    spent_cents: int
    invoiced_cents: int


# --------------------------------------------------------------------- tasks


class TaskIn(StrictModel):
    title: str = Field(min_length=1, max_length=400)
    notes: str = Field(default="", max_length=8000)
    context: Context = "work"
    priority: TaskPriority = "P2"
    status: TaskStatus = "open"
    due_date: date | None = None
    project_id: str | None = None


class TaskPatch(StrictModel):
    title: str | None = Field(default=None, min_length=1, max_length=400)
    notes: str | None = Field(default=None, max_length=8000)
    context: Context | None = None
    priority: TaskPriority | None = None
    status: TaskStatus | None = None
    due_date: date | None = None
    project_id: str | None = None


class TaskOut(OrmModel):
    id: str
    project_id: str | None
    title: str
    notes: str
    context: Context
    priority: TaskPriority
    status: TaskStatus
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------ invoices


class InvoiceIn(StrictModel):
    number: str = Field(min_length=1, max_length=64)
    client: str = Field(min_length=1, max_length=200)
    amount_cents: int = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    status: InvoiceStatus = "draft"
    issued_on: date
    due_on: date
    paid_on: date | None = None
    project_id: str | None = None


class InvoicePatch(StrictModel):
    client: str | None = Field(default=None, min_length=1, max_length=200)
    amount_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    status: InvoiceStatus | None = None
    issued_on: date | None = None
    due_on: date | None = None
    paid_on: date | None = None
    project_id: str | None = None


class InvoiceOut(OrmModel):
    id: str
    project_id: str | None
    number: str
    client: str
    amount_cents: int
    currency: str
    status: InvoiceStatus
    issued_on: date
    due_on: date
    paid_on: date | None
    created_at: datetime
    updated_at: datetime


# ------------------------------------------------------------------ expenses


class ExpenseIn(StrictModel):
    vendor: str = Field(min_length=1, max_length=200)
    category: str = Field(default="general", max_length=64)
    amount_cents: int = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    spent_on: date
    recurring: bool = False
    notes: str = Field(default="", max_length=8000)
    project_id: str | None = None


class ExpensePatch(StrictModel):
    vendor: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=64)
    amount_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    spent_on: date | None = None
    recurring: bool | None = None
    notes: str | None = Field(default=None, max_length=8000)
    project_id: str | None = None


class ExpenseOut(OrmModel):
    id: str
    project_id: str | None
    vendor: str
    category: str
    amount_cents: int
    currency: str
    spent_on: date
    recurring: bool
    notes: str
    created_at: datetime
    updated_at: datetime


# ----------------------------------------------------------------- audit log


class AuditLogIn(StrictModel):
    actor: AuditActor = "assistant"
    action: str = Field(min_length=1, max_length=64)
    subject_type: str = Field(min_length=1, max_length=32)
    subject_id: str = Field(default="", max_length=64)
    decision: str = Field(min_length=1, max_length=4000)
    rationale: str = Field(default="", max_length=8000)
    confidence: float = Field(ge=0, le=1)
    inputs: dict[str, Any] = Field(default_factory=dict)


class AuditLogOut(OrmModel):
    id: str
    seq: int
    created_at: datetime
    actor: AuditActor
    action: str
    subject_type: str
    subject_id: str
    decision: str
    rationale: str
    confidence: float
    inputs: dict[str, Any]
    prev_hash: str
    hash: str


class AuditVerification(BaseModel):
    ok: bool
    checked: int
    first_bad_seq: int | None
    head_hash: str | None


# ------------------------------------------------------------- daily brief


class BurnRate(BaseModel):
    window_days: int
    expenses_cents: int
    daily_cents: int
    monthly_cents: int
    previous_window_cents: int
    change_pct: float | None


class FinanceSummary(BaseModel):
    as_of: date
    currency: str
    invoiced_cents: int
    collected_cents: int
    outstanding_cents: int
    overdue_cents: int
    overdue_count: int
    expenses_cents: int
    margin_cents: int
    margin_pct: float | None
    burn: BurnRate


class DailyBriefPayload(BaseModel):
    p1_due_today: list[TaskOut]
    past_due_invoices: list[InvoiceOut]
    yesterday: dict[str, int]
    finance: FinanceSummary
    overdue_marked: list[str]


class DailyBriefOut(BaseModel):
    id: str
    brief_date: date
    generated_at: datetime
    triggered_by: str
    summary: str
    payload: DailyBriefPayload


class DailyRunAccepted(BaseModel):
    status: Literal["queued", "built"]
    brief_date: date
    task_id: str | None = None
    brief: DailyBriefOut | None = None


# ----------------------------------------------------------------- generic


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    environment: str
    database: bool
    redis: bool
