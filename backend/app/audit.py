"""The AI audit ledger.

Every decision the system makes (marking an invoice overdue, building a
brief, computing a burn rate, a proposal an external agent logged) is appended
here with a SHA-256 that covers the row and the previous row's hash. The
result is a chain: alter or remove any row and verification stops matching
from that point on.

Appends are serialised with a Postgres transaction-scoped advisory lock so two
workers cannot both claim the same `seq` and `prev_hash`. On SQLite (tests and
laptops) there is no such lock: two truly concurrent appends can collide and one
fails on the unique `seq`, which is acceptable for a single-user dev database.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import AuditLog, new_id, utcnow

GENESIS_HASH = "0" * 64
_LOCK_KEY = 0x414C4C44  # "ALLD"


def canonical(payload: dict[str, Any]) -> str:
    """Deterministic JSON: sorted keys, no whitespace, UTF-8 preserved."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def compute_hash(prev_hash: str, payload: dict[str, Any]) -> str:
    digest = hashlib.sha256()
    digest.update(prev_hash.encode("utf-8"))
    digest.update(b"\n")
    digest.update(canonical(payload).encode("utf-8"))
    return digest.hexdigest()


async def _lock(session: AsyncSession) -> None:
    bind = session.get_bind()
    if bind.dialect.name == "postgresql":
        await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _LOCK_KEY})


async def record(
    session: AsyncSession,
    *,
    actor: str,
    action: str,
    subject_type: str,
    subject_id: str = "",
    decision: str,
    rationale: str = "",
    confidence: float,
    inputs: dict[str, Any] | None = None,
) -> AuditLog:
    """Append one entry. The caller owns the transaction."""
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    await _lock(session)
    last = (await session.execute(select(AuditLog).order_by(AuditLog.seq.desc()).limit(1))).scalar_one_or_none()
    entry = AuditLog(
        id=new_id(),
        seq=(last.seq + 1) if last else 1,
        created_at=utcnow(),
        actor=actor,
        action=action,
        subject_type=subject_type,
        subject_id=subject_id,
        decision=decision,
        rationale=rationale,
        confidence=float(confidence),
        inputs=inputs or {},
        prev_hash=last.hash if last else GENESIS_HASH,
    )
    entry.hash = compute_hash(entry.prev_hash, entry.payload())
    session.add(entry)
    await session.flush()
    return entry


@dataclass(frozen=True)
class Verification:
    ok: bool
    checked: int
    first_bad_seq: int | None
    head_hash: str | None


async def verify(session: AsyncSession) -> Verification:
    """Walk the whole chain and recompute every hash."""
    prev = GENESIS_HASH
    expected_seq = 1
    checked = 0
    head: str | None = None
    # Streamed in pages so a long ledger never has to fit in memory at once.
    result = await session.stream(select(AuditLog).order_by(AuditLog.seq.asc()).execution_options(yield_per=500))
    async for row in result.scalars():
        checked += 1
        head = row.hash
        if row.seq != expected_seq or row.prev_hash != prev or compute_hash(prev, row.payload()) != row.hash:
            total = int((await session.execute(select(func.count()).select_from(AuditLog))).scalar_one())
            return Verification(ok=False, checked=total, first_bad_seq=row.seq, head_hash=head)
        prev = row.hash
        expected_seq += 1
    return Verification(ok=True, checked=checked, first_bad_seq=None, head_hash=head)
