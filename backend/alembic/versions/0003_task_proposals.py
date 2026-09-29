"""task proposals: changes the worker suggests and a person decides

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "task_proposals",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule", sa.String(48), nullable=False),
        sa.Column("field", sa.String(16), nullable=False),
        # What the task said when this was proposed. Applying compares against
        # it and refuses if the task has moved since, so a stale opinion cannot
        # overwrite whatever replaced it.
        sa.Column("from_value", sa.String(32), nullable=False),
        sa.Column("to_value", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(240), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="proposed"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decided_by", sa.String(64), nullable=False, server_default=""),
        # Filled by reading the task back after the write, not by assuming the
        # write took.
        sa.Column("outcome_ok", sa.Boolean(), nullable=True),
        sa.Column("observed", sa.String(120), nullable=False, server_default=""),
        sa.CheckConstraint(
            "state IN ('proposed', 'applied', 'failed', 'stale', 'declined')",
            name="ck_task_proposals_state",
        ),
        sa.CheckConstraint("field IN ('status', 'priority')", name="ck_task_proposals_field"),
    )
    op.create_index("ix_task_proposals_state_created", "task_proposals", ["state", "created_at"])
    # Partial: one *live* proposal per task and field, while decided rows for
    # the same pair stay as history. A beat that fires twice, or a worker
    # retried after a lost ack, would otherwise double the queue.
    op.create_index(
        "uq_task_proposals_open",
        "task_proposals",
        ["task_id", "field"],
        unique=True,
        postgresql_where=sa.text("state = 'proposed'"),
        sqlite_where=sa.text("state = 'proposed'"),
    )


def downgrade() -> None:
    op.drop_index("uq_task_proposals_open", table_name="task_proposals")
    op.drop_index("ix_task_proposals_state_created", table_name="task_proposals")
    op.drop_table("task_proposals")
