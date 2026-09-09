"""Request and response shapes. Strict: unknown fields are rejected."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

Context = Literal["work", "personal"]
ProjectStage = Literal["idea", "planning", "in_progress", "review", "done"]
ProjectStatus = Literal["active", "paused", "done"]
TaskPriority = Literal["P1", "P2", "P3"]
TaskStatus = Literal["open", "doing", "done"]
InvoiceStatus = Literal["draft", "sent", "paid", "overdue", "void"]
AuditActor = Literal["system", "worker", "user", "assistant"]

MAX_INPUTS_BYTES = 64 * 1024


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

    @field_validator("inputs")
    @classmethod
    def _inputs_fit(cls, value: dict[str, Any]) -> dict[str, Any]:
        # The ledger row is hashed and kept forever; a bounded payload keeps
        # verify() fast and stops one client from filling the table.
        if len(json.dumps(value, separators=(",", ":"), default=str)) > MAX_INPUTS_BYTES:
            raise ValueError(f"inputs must serialise to at most {MAX_INPUTS_BYTES} bytes")
        return value


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


# ----------------------------------------------------------------- web tier

WebFormat = Literal["markdown", "html", "text", "links", "screenshot"]
WebJobKind = Literal["crawl", "batch"]
WebJobStatus = Literal["queued", "running", "done", "failed"]

MAX_URL = 2048


class WebScrapeIn(StrictModel):
    url: str = Field(min_length=1, max_length=MAX_URL)
    formats: list[WebFormat] = Field(default_factory=lambda: ["markdown"], max_length=5)
    render: bool = Field(default=False, description="Render JavaScript first (needs Firecrawl)")
    wait_ms: int = Field(default=0, ge=0, le=10_000)


class WebPage(BaseModel):
    url: str
    final_url: str
    status: int
    title: str
    description: str = ""
    language: str = ""
    markdown: str
    html: str | None = None
    text: str | None = None
    links: list[str] | None = None
    screenshot: str | None = None
    metadata: dict[str, str] = Field(default_factory=dict)
    engine: str
    fetched_ms: int = 0
    depth: int | None = None


class WebFailure(BaseModel):
    url: str
    error: str


class WebMapIn(StrictModel):
    url: str = Field(min_length=1, max_length=MAX_URL)
    limit: int = Field(default=200, ge=1, le=5000)
    search: str | None = Field(default=None, max_length=200)
    sitemap: bool = True


class WebMapOut(BaseModel):
    url: str
    urls: list[str]
    total: int
    source: str


class WebCrawlIn(StrictModel):
    url: str = Field(min_length=1, max_length=MAX_URL)
    limit: int = Field(default=20, ge=1, le=2000)
    max_depth: int = Field(default=2, ge=0, le=5)
    include: list[str] = Field(default_factory=list, max_length=20, description="Path globs to keep, e.g. /docs/*")
    exclude: list[str] = Field(default_factory=list, max_length=20)
    formats: list[WebFormat] = Field(default_factory=lambda: ["markdown"], max_length=4)


class WebCrawlOut(BaseModel):
    url: str
    pages: list[WebPage]
    failures: list[WebFailure]
    visited: int
    truncated: bool


class WebBatchIn(StrictModel):
    urls: list[str] = Field(min_length=1, max_length=1000)
    formats: list[WebFormat] = Field(default_factory=lambda: ["markdown"], max_length=4)
    render: bool = False


class WebBatchOut(BaseModel):
    pages: list[WebPage]
    failures: list[WebFailure]


class WebSearchIn(StrictModel):
    query: str = Field(min_length=1, max_length=400)
    limit: int = Field(default=5, ge=1, le=20)
    scrape: bool = Field(default=True, description="Also fetch each result's content")


class WebSearchResult(BaseModel):
    url: str
    title: str = ""
    description: str = ""
    markdown: str = ""


class WebSearchOut(BaseModel):
    query: str
    results: list[WebSearchResult]
    engine: str


class WebExtractIn(StrictModel):
    urls: list[str] = Field(min_length=1, max_length=10)
    prompt: str = Field(min_length=1, max_length=4000)
    schema_: dict[str, Any] | None = Field(default=None, alias="schema", description="JSON Schema the answer must fit")
    render: bool = False

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, populate_by_name=True)


class WebExtractOut(BaseModel):
    data: Any
    sources: list[str]
    failures: list[WebFailure]
    model: str
    audit_id: str


class WebAgentIn(StrictModel):
    goal: str = Field(min_length=1, max_length=4000, description="What you need, in a sentence or two")
    start_url: str | None = Field(
        default=None, max_length=MAX_URL, description="A site to work from; without one the agent searches the web"
    )
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    max_pages: int = Field(default=5, ge=1, le=10)
    render: bool = False

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, populate_by_name=True)


class WebAgentOut(BaseModel):
    data: Any
    sources: list[str]
    failures: list[WebFailure]
    steps: list[str]
    model: str
    audit_id: str


class WebJobAccepted(BaseModel):
    id: str
    kind: WebJobKind
    status: WebJobStatus


class WebJobOut(OrmModel):
    id: str
    kind: WebJobKind
    status: WebJobStatus
    request: dict[str, Any]
    result: dict[str, Any] | None
    error: str
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class WebCapabilities(BaseModel):
    native: list[str]
    firecrawl: bool
    search: bool
    render: bool
    screenshot: bool
    model: str | None
    extract: bool
    agent: bool
    limits: dict[str, int]
