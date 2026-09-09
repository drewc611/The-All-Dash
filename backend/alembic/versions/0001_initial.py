"""initial schema and the audit ledger immutability trigger

Revision ID: 0001
Revises:
Create Date: 2026-09-08
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("context", sa.String(16), nullable=False, server_default="work"),
        sa.Column("stage", sa.String(16), nullable=False, server_default="planning"),
        sa.Column("status", sa.String(16), nullable=False, server_default="active"),
        sa.Column("budget_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("target_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("context IN ('work', 'personal')", name="ck_projects_context"),
        sa.CheckConstraint(
            "stage IN ('idea', 'planning', 'in_progress', 'review', 'done')", name="ck_projects_stage"
        ),
        sa.CheckConstraint("status IN ('active', 'paused', 'done')", name="ck_projects_status"),
        sa.CheckConstraint("budget_cents >= 0", name="ck_projects_budget"),
    )
    op.create_table(
        "tasks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(400), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("context", sa.String(16), nullable=False, server_default="work"),
        sa.Column("priority", sa.String(2), nullable=False, server_default="P2"),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("context IN ('work', 'personal')", name="ck_tasks_context"),
        sa.CheckConstraint("priority IN ('P1', 'P2', 'P3')", name="ck_tasks_priority"),
        sa.CheckConstraint("status IN ('open', 'doing', 'done')", name="ck_tasks_status"),
    )
    op.create_index("ix_tasks_due_date", "tasks", ["due_date"])
    op.create_index("ix_tasks_context_status", "tasks", ["context", "status"])

    op.create_table(
        "invoices",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("number", sa.String(64), nullable=False, unique=True),
        sa.Column("client", sa.String(200), nullable=False),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
        sa.Column("issued_on", sa.Date(), nullable=False),
        sa.Column("due_on", sa.Date(), nullable=False),
        sa.Column("paid_on", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("status IN ('draft', 'sent', 'paid', 'overdue', 'void')", name="ck_invoices_status"),
        sa.CheckConstraint("amount_cents >= 0", name="ck_invoices_amount"),
    )
    op.create_index("ix_invoices_status_due", "invoices", ["status", "due_on"])

    op.create_table(
        "expenses",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="SET NULL"), nullable=True),
        sa.Column("vendor", sa.String(200), nullable=False),
        sa.Column("category", sa.String(64), nullable=False, server_default="general"),
        sa.Column("amount_cents", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="USD"),
        sa.Column("spent_on", sa.Date(), nullable=False),
        sa.Column("recurring", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount_cents >= 0", name="ck_expenses_amount"),
    )
    op.create_index("ix_expenses_spent_on", "expenses", ["spent_on"])

    op.create_table(
        "ai_audit_logs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("seq", sa.Integer(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(16), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("subject_type", sa.String(32), nullable=False),
        sa.Column("subject_id", sa.String(64), nullable=False, server_default=""),
        sa.Column("decision", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("inputs", sa.JSON(), nullable=False),
        sa.Column("prev_hash", sa.String(64), nullable=False),
        sa.Column("hash", sa.String(64), nullable=False, unique=True),
        sa.CheckConstraint("actor IN ('system', 'worker', 'user', 'assistant')", name="ck_audit_actor"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_audit_confidence"),
    )
    op.create_index("ix_audit_created", "ai_audit_logs", ["created_at"])
    op.create_index("ix_audit_subject", "ai_audit_logs", ["subject_type", "subject_id"])

    op.create_table(
        "daily_briefs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("brief_date", sa.Date(), nullable=False, unique=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("triggered_by", sa.String(32), nullable=False, server_default="api"),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
    )

    # The ledger is append-only at the database, not just at the API. Any
    # UPDATE or DELETE, from any client, is refused.
    if op.get_bind().dialect.name == "postgresql":
        op.execute(
            """
            CREATE OR REPLACE FUNCTION ai_audit_logs_immutable() RETURNS trigger AS $$
            BEGIN
              RAISE EXCEPTION 'ai_audit_logs is append-only: % is not allowed', TG_OP
                USING ERRCODE = 'integrity_constraint_violation';
            END;
            $$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            """
            CREATE TRIGGER trg_ai_audit_logs_immutable
            BEFORE UPDATE OR DELETE ON ai_audit_logs
            FOR EACH ROW EXECUTE FUNCTION ai_audit_logs_immutable();
            """
        )


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS trg_ai_audit_logs_immutable ON ai_audit_logs")
        op.execute("DROP FUNCTION IF EXISTS ai_audit_logs_immutable()")
    op.drop_table("daily_briefs")
    op.drop_index("ix_audit_subject", table_name="ai_audit_logs")
    op.drop_index("ix_audit_created", table_name="ai_audit_logs")
    op.drop_table("ai_audit_logs")
    op.drop_index("ix_expenses_spent_on", table_name="expenses")
    op.drop_table("expenses")
    op.drop_index("ix_invoices_status_due", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_tasks_context_status", table_name="tasks")
    op.drop_index("ix_tasks_due_date", table_name="tasks")
    op.drop_table("tasks")
    op.drop_table("projects")
