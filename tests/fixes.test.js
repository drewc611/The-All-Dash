import test from 'node:test'
import assert from 'node:assert/strict'

import { rangeFor, parseLooseDate, zonedToDate, dayKey } from '../src/core/time.js'
import { daily } from '../src/core/query.js'
import { makeEntity, mergeEntity } from '../src/data/schema.js'
import { evaluate, compileCustom } from '../src/engine/metrics.js'
import { buildTriage } from '../src/engine/triage.js'
import { parseIcsDate } from '../src/ingest/parsers/ics.js'
import { strip, extractFromText } from '../src/ingest/extract.js'
import { validateAction } from '../src/ai/protocol.js'
import { addDays, iso } from '../src/core/time.js'

const at = (offset) => iso(addDays(new Date(), offset))
const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))

test('the "All time" range is bounded and daily() buckets only the days that hold data', () => {
  const range = rangeFor('all')
  assert.ok(range.from.getFullYear() >= 2000)
  assert.ok((range.to - range.from) / 86400000 < 40000)
  const rows = [makeEntity({ type: 'task', title: 'a', status: 'done', at: at(-3) }), makeEntity({ type: 'task', title: 'b', status: 'done', at: at(-1) })]
  const series = daily(rows, { from: range.from, to: range.to })
  assert.ok(series.length > 0 && series.length < 30, `got ${series.length} buckets`)
  assert.equal(series.reduce((n, p) => n + p.value, 0), 2)
  assert.deepEqual(daily([], { from: range.from, to: range.to }), [])
})

test('impossible dates are nothing, not a rolled-over guess', () => {
  assert.equal(parseLooseDate('2026-13-45'), null)
  assert.equal(parseLooseDate('3/45/26'), null)
  assert.equal(parseLooseDate('Feb 30'), null)
  assert.ok(parseLooseDate('2026-02-28'))
})

test('a zoned wall-clock time becomes the right instant, across DST', () => {
  // 10:00 in London is 09:00Z in summer and 10:00Z in winter.
  assert.equal(zonedToDate([2026, 6, 1, 10, 0, 0], 'Europe/London').toISOString(), '2026-07-01T09:00:00.000Z')
  assert.equal(zonedToDate([2026, 0, 15, 10, 0, 0], 'Europe/London').toISOString(), '2026-01-15T10:00:00.000Z')
  assert.equal(zonedToDate([2026, 6, 1, 10, 0, 0], 'Not/AZone'), null)
  const parsed = parseIcsDate('20260701T100000', { TZID: 'Europe/London' })
  assert.equal(parsed.iso, '2026-07-01T09:00:00.000Z')
  assert.equal(parseIcsDate('20260701', { VALUE: 'DATE' }).allDay, true)
})

test('all-day calendar entries carry no meeting hours and never clash', () => {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  const holiday = makeEntity({ type: 'event', title: 'Public holiday', at: iso(start), end: iso(addDays(start, 1)), meta: { allDay: true } })
  const standupAt = new Date(start); standupAt.setHours(0, 30, 0, 0)
  const standup = makeEntity({ type: 'event', title: 'Standup', at: iso(standupAt), end: iso(new Date(standupAt.getTime() + 1800000)) })
  const entities = map([holiday, standup])
  assert.equal(evaluate('meeting-load', entities, rangeFor('7d')).value, 0.5)
  assert.equal(buildTriage(entities).filter((s) => s.kind === 'clash').length, 0)
})

test('custom metric reducers min and max report the right headline', () => {
  const rows = [1, 5, 9].map((v, i) => makeEntity({ type: 'metric', title: 'L', series: 'L', value: v, at: at(-2 + i) }))
  const entities = map(rows)
  const min = compileCustom({ id: 'mn', name: 'Min', entityType: 'metric', seriesName: 'L', reduce: 'min' })
  const max = compileCustom({ id: 'mx', name: 'Max', entityType: 'metric', seriesName: 'L', reduce: 'max' })
  assert.equal(evaluate(min, entities, rangeFor('7d')).value, 1)
  assert.equal(evaluate(max, entities, rangeFor('7d')).value, 9)
  const negative = map([-4, -2].map((v, i) => makeEntity({ type: 'metric', title: 'N', series: 'N', value: v, at: at(-1 + i) })))
  assert.equal(evaluate(compileCustom({ id: 'ng', name: 'Neg', entityType: 'metric', seriesName: 'N', reduce: 'max' }), negative, rangeFor('7d')).value, -2)
})

test('quick capture syntax is parsed by strip()', () => {
  const parsed = strip('Draft the Q3 brief @Sam by Friday #launch')
  assert.equal(parsed.title, 'Draft the Q3 brief')
  assert.deepEqual(parsed.people, ['Sam'])
  assert.deepEqual(parsed.tags, ['launch'])
  assert.ok(parsed.due)
})

test('re-importing unchanged content keeps updatedAt; a real change moves it', () => {
  const old = { ...makeEntity({ type: 'task', title: 'Ship it', status: 'done' }), updatedAt: '2026-01-01T00:00:00.000Z' }
  const same = mergeEntity(old, makeEntity({ type: 'task', title: 'Ship it', status: 'done' }))
  assert.equal(same.updatedAt, '2026-01-01T00:00:00.000Z')
  const changed = mergeEntity(old, makeEntity({ type: 'task', title: 'Ship it', status: 'open' }))
  assert.notEqual(changed.updatedAt, '2026-01-01T00:00:00.000Z')
})

test('a note without owners produces unowned work, and relative dates use the note date', () => {
  const { entities } = extractFromText('Attendees: Sam Ojo, Priya Raman\nDate: 2026-03-02\n\n- [ ] Fix the outage by Friday\n', { docId: 'd', name: 'n.md', kind: 'markdown' })
  const task = entities.find((e) => e.type === 'task')
  assert.deepEqual(task.people, [])
  assert.equal(dayKey(task.due), '2026-03-06')
})

test('ids that name Object.prototype members are replaced', () => {
  const e = makeEntity({ id: '__proto__', type: 'task', title: 'x' })
  assert.notEqual(e.id, '__proto__')
  assert.equal(makeEntity({ id: 'task_ok', type: 'task', title: 'x' }).id, 'task_ok')
})

test('assistant bare day keys become local 17:00 and a partial week compares like for like', () => {
  const action = validateAction({ op: 'create', entity: { type: 'task', title: 'T', due: '2026-10-01' } }, {})
  assert.equal(action.entity.due, parseLooseDate('2026-10-01'))
  const week = rangeFor('week')
  const done = makeEntity({ type: 'task', title: 'd', status: 'done', at: at(0) })
  const result = evaluate('tasks-completed', map([{ ...done, updatedAt: at(0) }]), week)
  assert.equal(result.value, 1)
})
