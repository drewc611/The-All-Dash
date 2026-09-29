"""Changes the worker proposes and a person decides.

The browser app has the same idea in src/rounds/. This is the half that runs
while the laptop is shut, which is the only thing the autonomous-agent products
genuinely do better - and the reason they get to skip the two hard parts.

Nothing in this module writes to a task except `apply`, and `apply` is only
reachable from an authenticated request. The worker proposes. There is no
setting that makes it apply, and that is the feature rather than an omission: a
review queue with an approve-everything switch is a queue nobody reads, and
then the one proposal that mattered goes through with the rest.

Every rule here is arithmetic over columns the database already holds. No model
is called and nothing is spent, so a reason can be checked rather than trusted.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..clock import today_local, zone
from ..models import Task, TaskProposal, utcnow

# A task marked as being worked on, and then not touched for this long.
STALE_DAYS = 10

# Raising a priority means moving one step up this ladder. P1 is the top, so a
# task already there has nowhere to go and is left alone rather than re-offered
# every morning.
_LOUDER = {"P3": "P2", "P2": "P1"}


@dataclass(frozen=True)
class Proposed:
    rule: str
    field: str
    from_value: str
    to_value: str
    reason: str


def _overdue_unstarted(task: Task, today: date) -> Proposed | None:
    """Past its date and nobody has picked it up.

    Raising the priority is the smallest honest response. It does not claim to
    know why the task slipped, it does not move the date, and it puts the thing
    where a person will see it.
    """
    if task.status != "open" or task.due_date is None:
        return None
    late = (today - task.due_date).days
    if late < 1:
        return None
    louder = _LOUDER.get(task.priority)
    if louder is None:
        return None
    return Proposed(
        rule="overdue-unstarted",
        field="priority",
        from_value=task.priority,
        to_value=louder,
        reason=f"Due {late} day{'' if late == 1 else 's'} ago and still not started.",
    )


def _doing_but_silent(task: Task, today: date) -> Proposed | None:
    """Marked as in progress, and untouched for a week and a half.

    The browser app proposes "blocked" here. This schema has no such status -
    a task is open, doing or done - so the honest move in this vocabulary is
    back to open: something started and then abandoned is not in progress, and
    saying it is hides it from every count of what still needs picking up.
    """
    if task.status != "doing":
        return None
    touched = task.updated_at or task.created_at
    if touched is None:
        return None
    # Converted into the configured zone before taking the date, so "how many
    # days ago" is counted where the person is. clock.py is the one place
    # that decides when a day rolls over, and the API, the worker and beat
    # all agree because they all ask it.
    quiet = (today - touched.astimezone(zone()).date()).days
    if quiet < STALE_DAYS:
        return None
    return Proposed(
        rule="doing-but-silent",
        field="status",
        from_value="doing",
        to_value="open",
        reason=f"Marked as doing, untouched for {quiet} days.",
    )


RULES = (_overdue_unstarted, _doing_but_silent)


def current_value(task: Task, field: str) -> str:
    return task.status if field == "status" else task.priority


async def propose(session: AsyncSession, today: date | None = None, *, actor: str = "worker") -> list[TaskProposal]:
    """Scan every task and file what the rules find.

    Anything already decided for the same task and field is skipped. A queue
    that re-asks a question you answered last week trains you to clear it
    without reading, and the partial index on the table stops a retried worker
    filing the same row twice.
    """
    day = today or today_local()
    tasks = (await session.execute(select(Task).where(Task.status != "done"))).scalars().all()
    decided = {
        (row.task_id, row.field)
        for row in (await session.execute(select(TaskProposal))).scalars().all()
    }

    made: list[TaskProposal] = []
    for task in tasks:
        for rule in RULES:
            found = rule(task, day)
            if found is None or (task.id, found.field) in decided:
                continue
            decided.add((task.id, found.field))
            row = TaskProposal(
                task_id=task.id,
                rule=found.rule,
                field=found.field,
                from_value=found.from_value,
                to_value=found.to_value,
                reason=found.reason,
                state="proposed",
            )
            session.add(row)
            made.append(row)

    if made:
        await audit.record(
            session,
            actor=actor,
            action="changes_proposed",
            subject_type="task_proposal",
            subject_id="",
            decision=f"Proposed {len(made)} change{'' if len(made) == 1 else 's'}; applied none",
            rationale="Rules over due dates and last-touched times. A person decides each one.",
            confidence=1.0,
            inputs={"rules": sorted({p.rule for p in made}), "count": len(made)},
        )
    return made


def blocked_because(proposal: TaskProposal, task: Task | None) -> str | None:
    """Why this cannot be applied right now, or None if it can.

    Separate from applying so the queue can show the reason without anybody
    pressing the button to find out.
    """
    if proposal.state != "proposed":
        return f"this was already {proposal.state}"
    if task is None:
        return "the task it changes is gone"
    now = current_value(task, proposal.field)
    # The target is checked before the origin, and the order is the message. A
    # task that already says what the proposal wanted has also, by definition,
    # changed since it was proposed - so testing the origin first answers "it
    # moved" when the useful answer is "somebody already did this".
    if now == proposal.to_value:
        return "the task already says that"
    if now != proposal.from_value:
        return f"the task changed after this was proposed - it now reads {now}"
    return None


async def apply(session: AsyncSession, proposal: TaskProposal, *, actor: str) -> TaskProposal:
    """Apply a proposal, then read the task back and record what it says."""
    task = await session.get(Task, proposal.task_id)
    blocked = blocked_because(proposal, task)
    if blocked is not None:
        proposal.state = "stale"
        proposal.decided_at = utcnow()
        proposal.decided_by = actor
        proposal.outcome_ok = False
        proposal.observed = blocked[:120]
        await _log(session, proposal, actor, applied=False, note=blocked)
        return proposal

    setattr(task, proposal.field, proposal.to_value)
    # Flush so the column is written and re-read through the session rather
    # than trusted from the object we just set. A check constraint rejecting
    # the value surfaces here, before anything is recorded as a success.
    await session.flush()
    await session.refresh(task)

    observed = current_value(task, proposal.field)
    ok = observed == proposal.to_value
    proposal.state = "applied" if ok else "failed"
    proposal.decided_at = utcnow()
    proposal.decided_by = actor
    proposal.outcome_ok = ok
    proposal.observed = observed
    await _log(session, proposal, actor, applied=ok, note=None if ok else f"the task reads {observed}")
    return proposal


async def decline(session: AsyncSession, proposal: TaskProposal, *, actor: str) -> TaskProposal:
    """Say no. The row stays, because no is a decision and it stops the re-ask."""
    if proposal.state != "proposed":
        return proposal
    proposal.state = "declined"
    proposal.decided_at = utcnow()
    proposal.decided_by = actor
    await _log(session, proposal, actor, applied=False, note="declined")
    return proposal


async def _log(
    session: AsyncSession, proposal: TaskProposal, actor: str, *, applied: bool, note: str | None
) -> None:
    decision = (
        f"{proposal.field} of task {proposal.task_id} set to {proposal.to_value}"
        if applied
        else f"{proposal.field} of task {proposal.task_id} left at {proposal.from_value}"
    )
    await audit.record(
        session,
        actor=actor if actor in {"system", "worker", "user", "assistant"} else "user",
        action="proposal_applied" if applied else "proposal_not_applied",
        subject_type="task",
        subject_id=proposal.task_id,
        decision=decision,
        rationale=note or proposal.reason,
        # An applied change was read back and confirmed. Anything else is being
        # recorded precisely because it did not do what it set out to.
        confidence=1.0 if applied else 0.5,
        inputs={
            "proposal_id": proposal.id,
            "rule": proposal.rule,
            "field": proposal.field,
            "from": proposal.from_value,
            "to": proposal.to_value,
            "state": proposal.state,
            "observed": proposal.observed,
        },
    )


async def pending(session: AsyncSession) -> list[TaskProposal]:
    stmt = select(TaskProposal).where(TaskProposal.state == "proposed").order_by(TaskProposal.created_at.desc())
    return list((await session.execute(stmt)).scalars().all())


def summarise(made: list[TaskProposal]) -> dict[str, Any]:
    return {
        "proposed": len(made),
        "applied": 0,
        "rules": sorted({p.rule for p in made}),
    }


__all__ = [
    "RULES",
    "STALE_DAYS",
    "apply",
    "blocked_because",
    "current_value",
    "decline",
    "pending",
    "propose",
    "summarise",
]
