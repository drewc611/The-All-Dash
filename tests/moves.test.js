import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MOVE_KIND_IDS, applyMove, blockedBecause, declineMove, describeMove,
  isLegalValue, makeMove, readField, revertMove, sameValue,
} from '../src/rounds/moves.js'
import { addEntity, getState, removeEntity, updateEntity } from '../src/core/store.js'
import { normaliseMove } from '../src/rounds/moves-schema.js'
import { normaliseRoundsState } from '../src/rounds/schema.js'
import { proposeMoves } from '../src/rounds/propose.js'
import { addMoves, movesState, pendingMoves, recordDecision } from '../src/rounds/store.js'
import { addDays, dayKey } from '../src/core/time.js'

/*
 * Moves are the half the autonomous-employee products skip.
 *
 * They connect your accounts and act without asking, and then ship sentences
 * like "has not confirmed the result - check it before making another
 * request": fired into the world, lost track of. These tests are mostly about
 * the two things that admission implies are hard. A proposal that the world
 * overtook must not apply. And applying must be followed by looking, because
 * "we called the writer" and "the record says what we wanted" are different
 * facts.
 */

const task = (over = {}) => addEntity({
  type: 'task', title: 'Rewrite the rollback script', status: 'open', priority: 0, ...over,
})

const move = (entity, over = {}) => makeMove({
  kind: 'status', entityId: entity.id, from: 'open', to: 'done',
  sources: ['note_1'], why: 'The steering note says it shipped.', ...over,
})

// ------------------------------------------------------- what is refused

test('a move with no evidence is not built at all', () => {
  const t = task()
  try {
    assert.equal(makeMove({ kind: 'status', entityId: t.id, from: 'open', to: 'done', sources: [] }), null)
    assert.equal(makeMove({ kind: 'status', entityId: t.id, from: 'open', to: 'done' }), null)
    // An untraceable *finding* is kept and marked, because a passage you
    // cannot place is still worth reading. An untraceable edit is not the
    // same object and does not get the same treatment.
    assert.ok(move(t), 'a move with a source is fine')
  } finally { removeEntity(t.id) }
})

test('a move to an illegal value is not built', () => {
  const t = task()
  try {
    // 'working' is board-label vocabulary, not the entity's. updateEntity
    // writes a patch straight through without coercing it, so this would be
    // stored verbatim and read back verbatim - and the check after applying
    // would confirm the garbage it just wrote.
    assert.equal(move(t, { to: 'working' }), null)
    assert.equal(move(t, { kind: 'priority', from: 0, to: 7 }), null)
    assert.equal(move(t, { kind: 'vibes', to: 'good' }), null)
    assert.equal(move(t, { kind: 'due', from: null, to: '2026-10-01' }), null)
  } finally { removeEntity(t.id) }
})

test('a move that changes nothing is not built', () => {
  const t = task()
  try {
    assert.equal(move(t, { from: 'open', to: 'open' }), null)
    assert.equal(move(t, { kind: 'priority', from: 0, to: 0 }), null)
    // Across representations too: a queue full of no-ops is a queue nobody
    // reads, and 0 and '0' are the same priority.
    assert.equal(move(t, { kind: 'priority', from: '0', to: 0 }), null)
  } finally { removeEntity(t.id) }
})

test('every kind declares legal values, and rejects outside them', () => {
  // Only the two enumerations. A `due` kind was written and taken out again
  // after driving the app, because entity.due holds a full timestamp in real
  // records and the kind only accepted bare day keys - it would have refused
  // the app's own format. moves-schema.js says so where the kind used to be.
  assert.deepEqual(MOVE_KIND_IDS, ['status', 'priority'])
  assert.ok(isLegalValue('status', 'blocked'))
  assert.ok(!isLegalValue('status', 'Blocked'))
  assert.ok(!isLegalValue('due', '2026-09-20'), 'the due kind is gone, not half-present')
})

// ------------------------------------------------- the world moved on

test('a proposal the record overtook refuses to apply', () => {
  const t = task()
  try {
    const m = move(t)                       // proposed while it read 'open'
    updateEntity(t.id, { status: 'blocked' }) // somebody else got there first

    const why = blockedBecause(m)
    assert.match(why, /changed after this was proposed/)
    assert.match(why, /Blocked/, 'the reason says what it reads now, not just that it differs')

    const done = applyMove(m)
    assert.equal(done.state, 'stale')
    assert.equal(done.outcome.ok, false)
    // The point: the record keeps what the newer decision said.
    assert.equal(getState().entities[t.id].status, 'blocked')
  } finally { removeEntity(t.id) }
})

test('a proposal whose record is gone refuses to apply', () => {
  const t = task()
  const m = move(t)
  removeEntity(t.id)
  assert.match(blockedBecause(m), /gone/)
  assert.equal(applyMove(m).state, 'stale')
})

test('a proposal the world already agrees with is not applied again', () => {
  const t = task()
  try {
    const m = move(t)
    updateEntity(t.id, { status: 'done' })
    assert.match(blockedBecause(m), /already says that/)
  } finally { removeEntity(t.id) }
})

// ------------------------------------------------------- applying, and looking

test('applying writes the record and then reads it back', () => {
  const t = task()
  try {
    const done = applyMove(move(t))
    assert.equal(done.state, 'applied')
    assert.equal(done.outcome.ok, true)
    assert.equal(done.outcome.observed, 'done', 'the outcome records what is there, not what was sent')
    assert.ok(done.outcome.at, 'an outcome with no time cannot be put in order')
    assert.equal(getState().entities[t.id].status, 'done')
  } finally { removeEntity(t.id) }
})

test('a write that does not land is a failure carrying what it found', () => {
  const t = task()
  try {
    const m = move(t)
    // updateEntity ignores an id it does not hold, and returns nothing either
    // way. Without the read afterwards this move would report success on a
    // record that no longer exists - which is exactly the failure the
    // check-it-yourself warning in those products is papering over.
    const blocked = blockedBecause(m)
    assert.equal(blocked, null, 'it is applicable right up until the moment it is not')
    removeEntity(t.id)
    const done = applyMove(m)
    assert.notEqual(done.state, 'applied')
    assert.equal(done.outcome.ok, false)
  } finally { removeEntity(t.id) }
})

test('a move cannot be applied twice', () => {
  const t = task()
  try {
    const once = applyMove(move(t))
    const twice = applyMove(once)
    assert.equal(twice.state, 'stale')
    assert.match(twice.outcome.reason, /already applied/)
  } finally { removeEntity(t.id) }
})

// ------------------------------------------------------------- undoing

test('undo puts back exactly what was there', () => {
  const t = task({ priority: 0 })
  try {
    const applied = applyMove(move(t, { kind: 'priority', from: 0, to: 2 }))
    assert.equal(getState().entities[t.id].priority, 2)
    const back = revertMove(applied)
    assert.equal(back.state, 'reverted')
    assert.equal(getState().entities[t.id].priority, 0)
  } finally { removeEntity(t.id) }
})

test('undo refuses once something else has changed the field', () => {
  const t = task()
  try {
    const applied = applyMove(move(t))            // open -> done
    updateEntity(t.id, { status: 'blocked' })      // a person disagreed
    const back = revertMove(applied)
    assert.equal(back.state, 'applied', 'it stays applied rather than claiming to be undone')
    // Reverting here would not be an undo. It would be a fresh edit wearing an
    // undo's name, quietly discarding what the person decided.
    assert.equal(getState().entities[t.id].status, 'blocked')
  } finally { removeEntity(t.id) }
})

// ---------------------------------------------------------- the ledger

test('declining is recorded rather than forgotten', () => {
  const t = task()
  try {
    const no = declineMove(move(t))
    assert.equal(no.state, 'declined')
    assert.ok(no.decidedAt)
    assert.equal(getState().entities[t.id].status, 'open')
    assert.equal(declineMove(no).state, 'declined', 'declining twice is not a state change')
  } finally { removeEntity(t.id) }
})

test('a move describes itself in terms of the record, not of ids', () => {
  const t = task()
  try {
    const line = describeMove(move(t))
    assert.match(line, /Rewrite the rollback script/)
    assert.match(line, /Open . Done/, 'it names both ends, in words')
    assert.ok(!/ent_|task_/.test(line), 'an id names nothing you could recognise')
  } finally { removeEntity(t.id) }
})

test('reading and comparing survive how a value happens to be stored', () => {
  const t = task({ priority: 1 })
  try {
    assert.equal(readField(getState().entities[t.id], 'priority'), 1)
    assert.ok(sameValue('priority', '2', 2), 'a hand edit stores a string')
    assert.ok(sameValue('status', null, null))
    assert.ok(!sameValue('status', 'open', 'done'))
  } finally { removeEntity(t.id) }
})

// ------------------------------------------------- where proposals come from

test('a rule fires on the record it read, and says why in plain terms', () => {
  const now = new Date()
  const late = addEntity({ type: 'task', title: 'Ship the migration note', status: 'open', priority: 0, due: dayKey(addDays(now, -11)) })
  try {
    const [m] = proposeMoves({ now, existing: [] }).filter((x) => x.entityId === late.id)
    assert.ok(m, 'an eleven-day-late unstarted task proposed nothing')
    assert.equal(m.kind, 'priority')
    assert.equal(m.from, 0)
    assert.equal(m.to, 1)
    assert.deepEqual(m.sources, [late.id], 'the evidence is the record the arithmetic was done on')
    assert.match(m.why, /11 days ago/)
    assert.equal(m.rule, 'overdue-unstarted')
  } finally { removeEntity(late.id) }
})

test('a rule does not fire early, and does not run off the end of the scale', () => {
  const now = new Date()
  const today = addEntity({ type: 'task', title: 'Due today', status: 'open', priority: 0, due: dayKey(now) })
  const maxed = addEntity({ type: 'task', title: 'Already urgent', status: 'open', priority: 2, due: dayKey(addDays(now, -30)) })
  try {
    const ids = proposeMoves({ now, existing: [] }).map((m) => m.entityId)
    assert.ok(!ids.includes(today.id), 'due today is not late')
    assert.ok(!ids.includes(maxed.id), 'there is nothing above urgent to raise it to')
  } finally { removeEntity(today.id); removeEntity(maxed.id) }
})

test('a proposal already decided is not raised again', () => {
  const now = new Date()
  const late = addEntity({ type: 'task', title: 'Chase the staging restore', status: 'open', priority: 0, due: dayKey(addDays(now, -4)) })
  try {
    const [first] = proposeMoves({ now, existing: [] }).filter((m) => m.entityId === late.id)
    assert.ok(first)
    // Declined yesterday. Asking again every morning is how a queue teaches
    // you to clear it without reading it.
    const again = proposeMoves({ now, existing: [declineMove(first)] }).filter((m) => m.entityId === late.id)
    assert.equal(again.length, 0)
  } finally { removeEntity(late.id) }
})

test('the ledger keeps declines and survives a reload', () => {
  const t = task()
  try {
    const m = move(t)
    assert.equal(addMoves([m]).length, 1)
    assert.equal(addMoves([m]).length, 0, 'filing the same proposal twice files it once')

    recordDecision(declineMove(m))
    assert.equal(pendingMoves().length, 0, 'a declined move is no longer pending')

    // What a reload does: back through the loader, not through makeMove, which
    // would return every decision to 'proposed' and resurrect the whole queue.
    const reloaded = normaliseRoundsState({ rounds: [], briefs: [], moves: movesState() })
    assert.equal(reloaded.moves.find((x) => x.id === m.id)?.state, 'declined')
    assert.equal(normaliseMove(null), null, 'a null row does not stop the ledger rendering')
  } finally { removeEntity(t.id) }
})
