"""web jobs: crawls and batch scrapes run by the worker

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "web_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="queued"),
        sa.Column("request", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('crawl', 'batch')", name="ck_web_jobs_kind"),
        sa.CheckConstraint("status IN ('queued', 'running', 'done', 'failed')", name="ck_web_jobs_status"),
    )
    op.create_index("ix_web_jobs_status_created", "web_jobs", ["status", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_web_jobs_status_created", table_name="web_jobs")
    op.drop_table("web_jobs")
