"""Changes the worker proposes and a person decides.

These are mostly about the two things the autonomous-agent products are worst
at, and which their own error copy admits: a proposal that the world overtook
must not apply, and applying must be followed by looking, because "the update
was issued" and "the row says what we wanted" are different facts.

The third thing being pinned is the absence of a bulk approve. A review queue
with an approve-everything button is a queue nobody reads.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError

from app import db
from app.clock import today_local
from app.models import Task, TaskProposal
from app.services import proposals as service
from tests.conftest import KEY


async def _task(client: AsyncClient, **over) -> dict:
    body = {"title": "Renew the staging certificate", "context": "work"} | over
    r = await client.post("/tasks", json=body, headers=KEY)
    assert r.status_code == 201, r.text
    return r.json()


def _day(offset: int) -> str:
    return (today_local() + timedelta(days=offset)).isoformat()


async def _propose() -> list[dict]:
    """Run the worker's scan in its own session, as the worker would."""
    async with db.get_sessionmaker()() as session:
        made = await service.propose(session)
        await session.commit()
        return [{"id": m.id, "rule": m.rule, "field": m.field, "to": m.to_value} for m in made]


# ------------------------------------------------------------- what is offered


async def test_overdue_unstarted_is_proposed_with_its_arithmetic(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()
    mine = [m for m in made if m["rule"] == "overdue-unstarted"]
    assert len(mine) == 1

    rows = (await client.get("/proposals", headers=KEY)).json()["items"]
    row = next(r for r in rows if r["task_id"] == task["id"])
    assert row["field"] == "priority"
    assert (row["from_value"], row["to_value"]) == ("P3", "P2")
    assert "11 days ago" in row["reason"]
    # Nothing was applied by proposing it. That is the whole posture.
    assert row["state"] == "proposed"
    assert (await client.get(f"/tasks/{task['id']}", headers=KEY)).json()["priority"] == "P3"


async def test_a_rule_does_not_fire_early_or_past_the_top(client: AsyncClient) -> None:
    await _task(client, title="Due today", due_date=_day(0), priority="P3", status="open")
    await _task(client, title="Already loudest", due_date=_day(-30), priority="P1", status="open")
    assert await _propose() == [], "due today is not late, and P1 has nowhere to go"


async def test_a_done_task_is_never_scanned(client: AsyncClient) -> None:
    await _task(client, due_date=_day(-20), priority="P3", status="done")
    assert await _propose() == []


async def test_stalled_work_goes_back_to_open(client: AsyncClient) -> None:
    task = await _task(client, title="Split the events table", status="doing")
    async with db.get_sessionmaker()() as session:
        row = await session.get(Task, task["id"])
        row.updated_at = datetime.now(UTC) - timedelta(days=14)
        await session.commit()

    made = await _propose()
    assert [m["rule"] for m in made] == ["doing-but-silent"]
    # This schema has no "blocked", so back to open is the honest move in the
    # vocabulary that exists: started and abandoned is not in progress, and
    # calling it in progress hides it from every count of what needs picking up.
    assert made[0]["to"] == "open"


async def test_the_same_question_is_not_asked_twice(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-4), priority="P3", status="open")
    first = await _propose()
    assert len(first) == 1

    await client.post(f"/proposals/{first[0]['id']}/decline", headers=KEY)
    # Declined yesterday. Re-asking every morning is how a queue teaches you to
    # clear it without reading it.
    assert await _propose() == []
    assert (await client.get(f"/tasks/{task['id']}", headers=KEY)).json()["priority"] == "P3"


# ------------------------------------------------------ the world moved on


async def test_a_proposal_the_task_overtook_refuses_to_apply(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()

    # Somebody gets there first, and disagrees.
    await client.patch(f"/tasks/{task['id']}", json={"priority": "P1"}, headers=KEY)

    listed = (await client.get("/proposals", headers=KEY)).json()["items"][0]
    assert "changed after this was proposed" in listed["blocked_because"]
    assert "P1" in listed["blocked_because"], "the reason says what it reads now"

    r = await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)
    assert r.status_code == 200
    assert r.json()["state"] == "stale"
    assert r.json()["outcome_ok"] is False
    # The point: the newer decision survives.
    assert (await client.get(f"/tasks/{task['id']}", headers=KEY)).json()["priority"] == "P1"


async def test_a_task_that_already_agrees_says_so(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    await _propose()
    await client.patch(f"/tasks/{task['id']}", json={"priority": "P2"}, headers=KEY)
    listed = (await client.get("/proposals", headers=KEY)).json()["items"][0]
    # Both "it moved" and "somebody already did this" are true here. Only the
    # second tells you there is nothing left to do.
    assert listed["blocked_because"] == "the task already says that"


async def test_a_deleted_task_does_not_crash_the_queue(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()
    await client.delete(f"/tasks/{task['id']}", headers=KEY)
    # The row goes with the task (ON DELETE CASCADE), so the queue is simply
    # shorter rather than full of proposals about nothing.
    assert (await client.get("/proposals", headers=KEY)).json()["items"] == []
    assert (await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)).status_code == 404


# -------------------------------------------------------- applying, and looking


async def test_applying_writes_the_task_and_reads_it_back(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()

    out = (await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)).json()
    assert out["state"] == "applied"
    assert out["outcome_ok"] is True
    # Not what was sent: what the row says afterwards.
    assert out["observed"] == "P2"
    assert out["decided_by"] == "user"
    assert (await client.get(f"/tasks/{task['id']}", headers=KEY)).json()["priority"] == "P2"


async def test_a_decided_proposal_cannot_be_decided_again(client: AsyncClient) -> None:
    await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()
    assert (await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)).status_code == 200
    again = await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)
    assert again.status_code == 409
    assert "already applied" in again.json()["detail"]


async def test_there_is_no_bulk_approve(client: AsyncClient) -> None:
    """The absence is the feature, so it is pinned like one."""
    spec = (await client.get("/openapi.json")).json()["paths"]
    proposal_paths = {p for p in spec if p.startswith("/proposals")}
    assert proposal_paths == {"/proposals", "/proposals/{proposal_id}/apply", "/proposals/{proposal_id}/decline"}
    # And the only writes are per-proposal.
    assert set(spec["/proposals"]) == {"get"}


async def test_every_decision_lands_in_the_audit_ledger(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()
    await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)

    entries = (await client.get("/ai-audit-logs", headers=KEY)).json()["items"]
    actions = [e["action"] for e in entries]
    assert "changes_proposed" in actions, "the scan that filed it is on the record"
    applied = next(e for e in entries if e["action"] == "proposal_applied")
    assert applied["subject_id"] == task["id"]
    assert applied["confidence"] == 1.0, "confirmed by reading the row back"
    assert applied["inputs"]["from"] == "P3" and applied["inputs"]["to"] == "P2"


async def test_a_refusal_is_recorded_with_lower_confidence(client: AsyncClient) -> None:
    task = await _task(client, due_date=_day(-11), priority="P3", status="open")
    made = await _propose()
    await client.patch(f"/tasks/{task['id']}", json={"priority": "P1"}, headers=KEY)
    await client.post(f"/proposals/{made[0]['id']}/apply", headers=KEY)

    entries = (await client.get("/ai-audit-logs", headers=KEY)).json()["items"]
    row = next(e for e in entries if e["action"] == "proposal_not_applied")
    # Recorded precisely because it did not do what it set out to.
    assert row["confidence"] < 1.0
    assert "changed after this was proposed" in row["rationale"]


# ------------------------------------------------------------------- the worker


async def test_the_worker_can_propose_and_cannot_apply(client: AsyncClient) -> None:
    await _task(client, due_date=_day(-11), priority="P3", status="open")
    from app import worker

    assert "propose-task-changes" in worker.celery_app.conf.beat_schedule
    names = {t for t in worker.celery_app.tasks if t.startswith("alldash.")}
    assert "alldash.propose_task_changes" in names
    # There is no scheduled or callable task that applies one. Applying lives
    # behind an authenticated request and nowhere else.
    assert not any("apply" in n for n in names), f"the worker can reach {names}"


async def test_proposals_need_a_key(client: AsyncClient) -> None:
    for call in (
        client.get("/proposals"),
        client.post("/proposals/whatever/apply"),
        client.post("/proposals/whatever/decline"),
    ):
        assert (await call).status_code in (401, 403)


async def test_the_database_refuses_a_field_no_rule_should_produce(client: AsyncClient) -> None:
    """The check constraint is the backstop; the rules are the policy.

    A new rule that guessed a column name would otherwise file rows the API
    happily lists and can never apply, because setattr would put an attribute
    on the ORM object that no column backs. Better to fail at the insert.
    """
    task = await _task(client)
    async with db.get_sessionmaker()() as session:
        session.add(
            TaskProposal(
                task_id=task["id"], rule="invented", field="due_date",
                from_value="a", to_value="b", reason="x",
            )
        )
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_two_scans_do_not_double_the_queue(client: AsyncClient) -> None:
    # A beat that fires twice, or a worker retried after a lost ack. The
    # partial unique index is what stops the same question appearing twice.
    await _task(client, due_date=_day(-11), priority="P3", status="open")
    assert len(await _propose()) == 1
    assert await _propose() == []
    assert len((await client.get("/proposals", headers=KEY)).json()["items"]) == 1


async def test_the_index_is_what_stops_a_duplicate_not_just_the_scan(client: AsyncClient) -> None:
    """Prove the claim rather than the outcome.

    propose() also skips anything already decided, so the previous test would
    pass with no index at all. This goes around it: two live rows for the same
    task and field must be refused by the database, because the scan is the
    thing that can be retried and the index is the thing that cannot lose.
    """
    task = await _task(client)
    async with db.get_sessionmaker()() as session:
        for _ in range(2):
            session.add(
                TaskProposal(
                    task_id=task["id"], rule="r", field="priority",
                    from_value="P3", to_value="P2", reason="x", state="proposed",
                )
            )
        with pytest.raises(IntegrityError):
            await session.commit()


async def test_a_decided_row_does_not_block_a_later_proposal(client: AsyncClient) -> None:
    # The index is partial on purpose: history for a task and field stays, and
    # only one *live* row is allowed. Without that, declining once would bar
    # the question forever even after the situation changed.
    task = await _task(client)
    async with db.get_sessionmaker()() as session:
        session.add(
            TaskProposal(
                task_id=task["id"], rule="r", field="priority", from_value="P3",
                to_value="P2", reason="x", state="declined",
            )
        )
        await session.commit()
        session.add(
            TaskProposal(
                task_id=task["id"], rule="r", field="priority", from_value="P3",
                to_value="P2", reason="x", state="proposed",
            )
        )
        await session.commit()  # must not raise
