from __future__ import annotations

from sqlalchemy import select, update

from app import audit, db
from app.models import AuditLog
from tests.conftest import KEY


async def test_chain_links_and_verifies(client):
    for i in range(3):
        r = await client.post(
            "/ai-audit-logs",
            json={
                "actor": "assistant",
                "action": "proposal",
                "subject_type": "task",
                "subject_id": f"t{i}",
                "decision": f"decision {i}",
                "confidence": 0.5 + i / 10,
            },
            headers=KEY,
        )
        assert r.status_code == 201, r.text
    page = (await client.get("/ai-audit-logs", headers=KEY)).json()
    assert page["total"] == 3
    newest, middle, oldest = page["items"]
    assert oldest["prev_hash"] == audit.GENESIS_HASH
    assert middle["prev_hash"] == oldest["hash"]
    assert newest["prev_hash"] == middle["hash"]
    assert [e["seq"] for e in page["items"]] == [3, 2, 1]
    assert len(newest["hash"]) == 64

    v = (await client.get("/ai-audit-logs/verify", headers=KEY)).json()
    assert v == {"ok": True, "checked": 3, "first_bad_seq": None, "head_hash": newest["hash"]}


async def test_tampering_is_detected(client):
    for i in range(3):
        await client.post(
            "/ai-audit-logs",
            json={"action": "x", "subject_type": "t", "decision": f"d{i}", "confidence": 1},
            headers=KEY,
        )
    # Reach around the API (SQLite has no trigger) and edit the middle row.
    async with db.get_sessionmaker()() as session:
        await session.execute(update(AuditLog).where(AuditLog.seq == 2).values(decision="edited"))
        await session.commit()
    v = (await client.get("/ai-audit-logs/verify", headers=KEY)).json()
    assert v["ok"] is False
    assert v["first_bad_seq"] == 2
    assert v["checked"] == 3


async def test_hash_is_deterministic_and_canonical():
    payload_a = {"b": 1, "a": [1, 2], "nested": {"y": "ü", "x": None}}
    payload_b = {"nested": {"x": None, "y": "ü"}, "a": [1, 2], "b": 1}
    assert audit.compute_hash(audit.GENESIS_HASH, payload_a) == audit.compute_hash(audit.GENESIS_HASH, payload_b)
    assert audit.compute_hash("1" * 64, payload_a) != audit.compute_hash(audit.GENESIS_HASH, payload_a)


async def test_ledger_has_no_write_endpoints_beyond_append(client):
    r = await client.post(
        "/ai-audit-logs", json={"action": "x", "subject_type": "t", "decision": "d", "confidence": 1}, headers=KEY
    )
    log_id = r.json()["id"]
    assert (await client.patch(f"/ai-audit-logs/{log_id}", json={"decision": "y"}, headers=KEY)).status_code == 405
    assert (await client.delete(f"/ai-audit-logs/{log_id}", headers=KEY)).status_code == 405
    assert (await client.get(f"/ai-audit-logs/{log_id}", headers=KEY)).json()["decision"] == "d"


async def test_confidence_bounds_and_actor_enum(client):
    bad = await client.post(
        "/ai-audit-logs", json={"action": "x", "subject_type": "t", "decision": "d", "confidence": 1.5}, headers=KEY
    )
    assert bad.status_code == 422
    bad = await client.post(
        "/ai-audit-logs",
        json={"actor": "ghost", "action": "x", "subject_type": "t", "decision": "d", "confidence": 0.5},
        headers=KEY,
    )
    assert bad.status_code == 422


async def test_record_helper_orders_seq(client):
    async with db.get_sessionmaker()() as session:
        first = await audit.record(session, actor="system", action="a", subject_type="t", decision="1", confidence=1)
        second = await audit.record(session, actor="system", action="a", subject_type="t", decision="2", confidence=1)
        await session.commit()
    assert (first.seq, second.seq) == (1, 2)
    async with db.get_sessionmaker()() as session:
        rows = (await session.execute(select(AuditLog).order_by(AuditLog.seq))).scalars().all()
        assert rows[1].prev_hash == rows[0].hash
