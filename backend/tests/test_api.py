from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import KEY

today = date.today()
iso = lambda d: d.isoformat()  # noqa: E731


async def test_auth_is_required_and_health_is_open(client):
    assert (await client.get("/healthz")).status_code == 200
    assert (await client.get("/projects")).status_code == 401
    assert (await client.get("/projects", headers={"X-API-Key": "nope"})).status_code == 401
    assert (await client.get("/projects", headers={"X-API-Key": "second-key"})).status_code == 200


async def test_project_crud_and_pipeline(client):
    r = await client.post("/projects", json={"name": "Atlas", "context": "work", "budget_cents": 500000}, headers=KEY)
    assert r.status_code == 201, r.text
    project = r.json()
    assert project["stage"] == "planning"

    r = await client.post(
        "/tasks", json={"title": "Ship", "priority": "P1", "project_id": project["id"], "due_date": iso(today)}, headers=KEY
    )
    assert r.status_code == 201
    await client.post("/tasks", json={"title": "Done one", "status": "done", "project_id": project["id"]}, headers=KEY)
    await client.post(
        "/expenses", json={"vendor": "AWS", "amount_cents": 12000, "spent_on": iso(today), "project_id": project["id"]}, headers=KEY
    )
    await client.post(
        "/invoices",
        json={"number": "INV-1", "client": "Acme", "amount_cents": 250000, "status": "sent", "issued_on": iso(today), "due_on": iso(today + timedelta(days=30)), "project_id": project["id"]},
        headers=KEY,
    )

    pipe = (await client.get("/projects/pipeline", headers=KEY)).json()
    assert len(pipe) == 1
    assert pipe[0]["open_tasks"] == 1
    assert pipe[0]["done_tasks"] == 1
    assert pipe[0]["p1_open"] == 1
    assert pipe[0]["spent_cents"] == 12000
    assert pipe[0]["invoiced_cents"] == 250000

    r = await client.patch(f"/projects/{project['id']}", json={"stage": "in_progress"}, headers=KEY)
    assert r.json()["stage"] == "in_progress"
    assert (await client.patch(f"/projects/{project['id']}", json={"stage": "flying"}, headers=KEY)).status_code == 422
    assert (await client.patch(f"/projects/{project['id']}", json={"bogus": 1}, headers=KEY)).status_code == 422

    assert (await client.delete(f"/projects/{project['id']}", headers=KEY)).status_code == 204
    assert (await client.get(f"/projects/{project['id']}", headers=KEY)).status_code == 404
    # Invoice survives with project_id nulled, tasks go with the project.
    assert (await client.get("/tasks", headers=KEY)).json()["total"] == 0
    assert (await client.get("/invoices", headers=KEY)).json()["items"][0]["project_id"] is None


async def test_tasks_context_filter_today_and_toggle(client):
    await client.post("/tasks", json={"title": "Work thing", "context": "work", "priority": "P2", "due_date": iso(today)}, headers=KEY)
    await client.post("/tasks", json={"title": "Personal thing", "context": "personal", "priority": "P1", "due_date": iso(today)}, headers=KEY)
    await client.post("/tasks", json={"title": "Old thing", "context": "personal", "priority": "P3", "due_date": iso(today - timedelta(days=2))}, headers=KEY)
    await client.post("/tasks", json={"title": "Future", "context": "personal", "due_date": iso(today + timedelta(days=3))}, headers=KEY)

    work = (await client.get("/tasks", params={"context": "work"}, headers=KEY)).json()
    assert [t["title"] for t in work["items"]] == ["Work thing"]

    checklist = (await client.get("/tasks/today", params={"context": "personal"}, headers=KEY)).json()
    assert [t["title"] for t in checklist] == ["Personal thing", "Old thing"]

    task_id = checklist[0]["id"]
    done = (await client.post(f"/tasks/{task_id}/toggle", headers=KEY)).json()
    assert done["status"] == "done" and done["completed_at"]
    # Still on today's list once done, so the tick survives a reload.
    still = (await client.get("/tasks/today", params={"context": "personal"}, headers=KEY)).json()
    assert [t["title"] for t in still] == ["Personal thing", "Old thing"]
    assert still[0]["status"] == "done"
    reopened = (await client.post(f"/tasks/{task_id}/toggle", headers=KEY)).json()
    assert reopened["status"] == "open" and reopened["completed_at"] is None

    r = await client.post("/tasks", json={"title": "Bad project", "project_id": "missing"}, headers=KEY)
    assert r.status_code == 422


async def test_invoice_rules(client):
    r = await client.post(
        "/invoices", json={"number": "A", "client": "C", "amount_cents": 100, "issued_on": iso(today), "due_on": iso(today - timedelta(days=1))}, headers=KEY
    )
    assert r.status_code == 422
    r = await client.post(
        "/invoices", json={"number": "A", "client": "C", "amount_cents": 100, "status": "sent", "issued_on": iso(today - timedelta(days=40)), "due_on": iso(today - timedelta(days=10))}, headers=KEY
    )
    assert r.status_code == 201
    dup = await client.post(
        "/invoices", json={"number": "A", "client": "C", "amount_cents": 100, "issued_on": iso(today), "due_on": iso(today)}, headers=KEY
    )
    assert dup.status_code == 409

    past_due = (await client.get("/invoices", params={"past_due": "true"}, headers=KEY)).json()
    assert past_due["total"] == 1

    marked = (await client.post("/invoices/mark-overdue", headers=KEY)).json()
    assert marked[0]["status"] == "overdue"
    logs = (await client.get("/ai-audit-logs", params={"action": "invoice_marked_overdue"}, headers=KEY)).json()
    assert logs["total"] == 1
    assert logs["items"][0]["actor"] == "user"

    paid = (await client.patch(f"/invoices/{marked[0]['id']}", json={"status": "paid"}, headers=KEY)).json()
    assert paid["paid_on"] == iso(today)


async def test_finance_summary_and_burn_rate(client):
    for offset, amount in ((1, 1000), (5, 2000), (45, 9000)):
        await client.post("/expenses", json={"vendor": "V", "amount_cents": amount, "spent_on": iso(today - timedelta(days=offset))}, headers=KEY)
    await client.post(
        "/invoices", json={"number": "P", "client": "C", "amount_cents": 10000, "status": "paid", "issued_on": iso(today - timedelta(days=3)), "due_on": iso(today), "paid_on": iso(today - timedelta(days=1))}, headers=KEY
    )
    s = (await client.get("/finance/summary", headers=KEY)).json()
    assert s["collected_cents"] == 10000
    assert s["expenses_cents"] == 3000
    assert s["margin_cents"] == 7000
    assert s["margin_pct"] == 70.0
    assert s["burn"]["expenses_cents"] == 3000
    assert s["burn"]["previous_window_cents"] == 9000
    assert s["burn"]["daily_cents"] == 100
    assert s["burn"]["change_pct"] == -66.7
