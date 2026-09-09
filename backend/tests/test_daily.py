from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import KEY

today = date.today()
iso = lambda d: d.isoformat()  # noqa: E731


async def test_daily_engine_builds_and_audits(client):
    await client.post("/tasks", json={"title": "Board deck", "priority": "P1", "due_date": iso(today)}, headers=KEY)
    await client.post("/tasks", json={"title": "Not P1", "priority": "P2", "due_date": iso(today)}, headers=KEY)
    await client.post("/tasks", json={"title": "Tomorrow", "priority": "P1", "due_date": iso(today + timedelta(days=1))}, headers=KEY)
    await client.post(
        "/invoices",
        json={"number": "LATE", "client": "Acme", "amount_cents": 50000, "status": "sent", "issued_on": iso(today - timedelta(days=30)), "due_on": iso(today - timedelta(days=5))},
        headers=KEY,
    )
    await client.post("/expenses", json={"vendor": "Coffee", "amount_cents": 450, "spent_on": iso(today - timedelta(days=1))}, headers=KEY)

    r = await client.post("/daily/run", params={"sync": "true"}, headers=KEY)
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["status"] == "built"
    brief = body["brief"]
    assert [t["title"] for t in brief["payload"]["p1_due_today"]] == ["Board deck"]
    assert [i["number"] for i in brief["payload"]["past_due_invoices"]] == ["LATE"]
    assert brief["payload"]["past_due_invoices"][0]["status"] == "overdue"
    assert brief["payload"]["yesterday"]["spent_cents"] == 450
    assert "1 P1 item(s) due today: Board deck (work)" in brief["summary"]
    assert "1 invoice(s) past due totalling USD 500.00" in brief["summary"]

    latest = (await client.get("/daily/latest", headers=KEY)).json()
    assert latest["id"] == brief["id"]
    by_date = (await client.get(f"/daily/{iso(today)}", headers=KEY)).json()
    assert by_date["id"] == brief["id"]

    logs = (await client.get("/ai-audit-logs", headers=KEY)).json()
    actions = [e["action"] for e in logs["items"]]
    assert actions == ["daily_brief_built", "invoice_marked_overdue"]
    assert (await client.get("/ai-audit-logs/verify", headers=KEY)).json()["ok"] is True

    # Rebuilding the same date replaces the brief rather than duplicating it.
    again = (await client.post("/daily/run", params={"sync": "true"}, headers=KEY)).json()["brief"]
    assert again["id"] == brief["id"]
    assert (await client.get("/ai-audit-logs", headers=KEY)).json()["total"] == 3


async def test_daily_latest_404_when_empty(client):
    assert (await client.get("/daily/latest", headers=KEY)).status_code == 404
    assert (await client.get("/daily/2020-01-01", headers=KEY)).status_code == 404
