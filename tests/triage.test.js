import test from 'node:test'
import assert from 'node:assert/strict'

import { buildTriage, summarise, isMuted } from '../src/engine/triage.js'
import { makeEntity } from '../src/data/schema.js'
import { addDays, iso, rangeFor } from '../src/core/time.js'

const at = (offset) => iso(addDays(new Date(), offset))
const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))
const ids = (signals) => signals.map((s) => s.kind)

test('overdue tasks rank critical when urgent or a week late, serious otherwise', () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Nine days late', status: 'open', due: at(-9) }),
    makeEntity({ type: 'task', title: 'Urgent and late', status: 'open', due: at(-1), priority: 2 }),
    makeEntity({ type: 'task', title: 'A day late', status: 'open', due: at(-1) }),
    makeEntity({ type: 'task', title: 'Done and late', status: 'done', due: at(-3) }),
  ]
  const signals = buildTriage(map(rows))
  const overdue = signals.filter((s) => s.kind === 'overdue')
  assert.equal(overdue.length, 3)
  assert.deepEqual(overdue.map((s) => s.severity), ['critical', 'critical', 'serious'])
  assert.ok(overdue[0].actions.some((a) => a.id === 'push'))
  assert.match(overdue.find((s) => s.title === 'Nine days late').why, /9 days late/)
})

test('due within 48 hours is a warning, blocked work is serious and ages to critical', () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Soon', status: 'open', due: at(1) }),
    makeEntity({ type: 'task', title: 'Later', status: 'open', due: at(5) }),
    makeEntity({ type: 'task', title: 'Stuck', status: 'blocked', updatedAt: at(-2) }),
    makeEntity({ type: 'task', title: 'Stuck for ages', status: 'blocked', updatedAt: at(-10) }),
  ]
  const signals = buildTriage(map(rows))
  const soon = signals.find((s) => s.kind === 'due-soon')
  assert.equal(soon.title, 'Soon')
  assert.equal(soon.severity, 'warning')
  assert.equal(signals.filter((s) => s.title === 'Later').length, 0)
  const stuck = signals.filter((s) => s.kind === 'blocked')
  assert.deepEqual(stuck.map((s) => s.severity).sort(), ['critical', 'serious'])
  assert.ok(stuck[0].actions.some((a) => a.id === 'unblock'))
})

test('a milestone that passed while tagged work is open is critical and lists that work', () => {
  const rows = [
    makeEntity({ type: 'milestone', title: 'Launch', due: at(-2), tags: ['launch'] }),
    makeEntity({ type: 'task', title: 'Write the notes', status: 'open', tags: ['launch'] }),
    makeEntity({ type: 'task', title: 'Unrelated', status: 'open', tags: ['infra'] }),
    makeEntity({ type: 'milestone', title: 'Far away', due: at(40) }),
  ]
  const signals = buildTriage(map(rows))
  const m = signals.find((s) => s.kind === 'milestone')
  assert.equal(m.title, 'Launch')
  assert.equal(m.severity, 'critical')
  assert.equal(m.entities.length, 1)
  assert.equal(signals.filter((s) => s.title === 'Far away').length, 0)
})

test('overlapping meetings in the next two days are flagged once, with a stable id', () => {
  const start = new Date()
  start.setHours(start.getHours() + 3, 0, 0, 0)
  const plus = (h) => new Date(start.getTime() + h * 3600000).toISOString()
  const rows = [
    makeEntity({ type: 'event', title: 'Design review', at: plus(0), end: plus(1) }),
    makeEntity({ type: 'event', title: 'Vendor call', at: plus(0.5), end: plus(1.5) }),
    makeEntity({ type: 'event', title: 'Lunch', at: plus(2), end: plus(3) }),
  ]
  const first = buildTriage(map(rows))
  const clashes = first.filter((s) => s.kind === 'clash')
  assert.equal(clashes.length, 1)
  assert.match(clashes[0].title, /overlaps/)
  assert.equal(clashes[0].id, buildTriage(map(rows)).find((s) => s.kind === 'clash').id)
})

test('stalled work, stale risks, unowned urgent tasks and aging questions each raise one signal', () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Forgotten', status: 'doing', updatedAt: at(-20) }),
    makeEntity({ type: 'risk', title: 'Old risk', status: 'open', updatedAt: at(-25) }),
    makeEntity({ type: 'task', title: 'Nobody', status: 'open', priority: 2 }),
    makeEntity({ type: 'note', title: 'Who decides', tags: ['question'], createdAt: at(-30) }),
    makeEntity({ type: 'note', title: 'Fresh question', tags: ['question'] }),
  ]
  const signals = buildTriage(map(rows))
  assert.deepEqual(ids(signals).sort(), ['question', 'risk', 'stalled', 'unowned'])
  assert.equal(signals.find((s) => s.kind === 'risk').severity, 'serious')
  assert.equal(signals.find((s) => s.kind === 'question').severity, 'info')
})

test('signals sort by severity then by date, and summarise counts them', () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Soon', status: 'open', due: at(1) }),
    makeEntity({ type: 'task', title: 'Late', status: 'open', due: at(-10) }),
    makeEntity({ type: 'task', title: 'Later still', status: 'open', due: at(-12) }),
  ]
  const signals = buildTriage(map(rows))
  assert.deepEqual(signals.map((s) => s.title), ['Later still', 'Late', 'Soon'])
  const counts = summarise(signals)
  assert.equal(counts.critical, 2)
  assert.equal(counts.warning, 1)
  assert.equal(counts.total, 3)
})

test('a muted signal stays hidden until its date, then returns on its own', () => {
  const rows = [makeEntity({ type: 'task', title: 'Late', status: 'open', due: at(-10) })]
  const all = buildTriage(map(rows))
  const id = all[0].id
  assert.equal(buildTriage(map(rows), { mutes: { [id]: { until: at(7) } } }).length, 0)
  assert.equal(buildTriage(map(rows), { mutes: { [id]: { until: at(-1) } } }).length, 1)
  assert.equal(isMuted({ until: at(1) }), true)
  assert.equal(isMuted(undefined), false)
})

test('a custom metric with an unreachable target is flagged when a range is given', () => {
  const rows = Array.from({ length: 10 }, (_, i) => makeEntity({ type: 'metric', title: 'Signups', series: 'Signups', value: 10, at: at(-i) }))
  const custom = [{ id: 'custom:signups', name: 'Signups', entityType: 'metric', seriesName: 'Signups', reduce: 'last', target: 1000 }]
  const signals = buildTriage(map(rows), { range: rangeFor('30d'), customMetrics: custom })
  const off = signals.find((s) => s.kind === 'target')
  assert.ok(off)
  assert.match(off.why, /1,000/)
})
