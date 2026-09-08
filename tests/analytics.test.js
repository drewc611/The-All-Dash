import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'

import { q, daily, trend, momentum, anomalies, streak, movingAverage } from '../src/core/query.js'
import { makeEntity, mergeEntity } from '../src/data/schema.js'
import { buildReminders, announceKey } from '../src/engine/reminders.js'
import { buildInsights } from '../src/engine/insights.js'
import { evaluate, discoveredSeries, compileCustom, availableMetrics } from '../src/engine/metrics.js'
import { readZip } from '../src/ingest/zip.js'
import { importWorkspace, getState, syncDoc, updateEntity, clearWorkspace } from '../src/core/store.js'
import { ingestFile } from '../src/ingest/index.js'
import { formatWeekday } from '../src/core/time.js'
import { rangeFor, addDays, dayKey, iso } from '../src/core/time.js'
import { format, compact } from '../src/core/format.js'

const at = (offset) => iso(addDays(new Date(), offset))

const fixture = () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Overdue thing', status: 'open', due: at(-3), people: ['Sam'] }),
    makeEntity({ type: 'task', title: 'Due tomorrow', status: 'open', due: at(1), people: ['Sam'] }),
    makeEntity({ type: 'task', title: 'In progress', status: 'doing', people: ['Sam'], tags: ['infra'] }),
    makeEntity({ type: 'task', title: 'Unowned one', status: 'open', tags: ['infra'] }),
    makeEntity({ type: 'task', title: 'Unowned two', status: 'open' }),
    makeEntity({ type: 'task', title: 'Unowned three', status: 'open' }),
    makeEntity({ type: 'task', title: 'Closed', status: 'done', people: ['Priya'] }),
    makeEntity({ type: 'event', title: 'Standup', at: at(0), end: at(0), people: ['Sam', 'Priya'] }),
    makeEntity({ type: 'risk', title: 'Untested rollback', status: 'open' }),
    makeEntity({ type: 'note', title: 'Who owns this', tags: ['question'] }),
    makeEntity({ type: 'note', title: 'And this', tags: ['question'] }),
  ]
  return Object.fromEntries(rows.map((r) => [r.id, r]))
}

test('query chains filter without mutating the source', () => {
  const rows = Object.values(fixture())
  const open = q(rows).type('task').open()
  assert.equal(open.count(), 6)
  assert.equal(q(rows).type('task').status('done').count(), 1)
  assert.equal(rows.length, 11)
})

test('query search spans title, tags and people', () => {
  const rows = Object.values(fixture())
  assert.equal(q(rows).search('rollback').count(), 1)
  assert.equal(q(rows).search('infra').count(), 2)
  assert.equal(q(rows).search('sam').count(), 4)
  assert.equal(q(rows).search('sam infra').count(), 1)
})

test('groupBy fans out array fields', () => {
  const rows = Object.values(fixture())
  const byPerson = q(rows).type('task').groupBy((e) => e.people)
  assert.equal(byPerson.get('Sam').length, 3)
  assert.equal(byPerson.has('Unassigned'), false)
})

test('daily buckets are dense, so gaps read as zero rather than vanishing', () => {
  const from = addDays(new Date(), -4)
  const to = new Date()
  const rows = [makeEntity({ type: 'task', title: 'a', at: at(-4) }), makeEntity({ type: 'task', title: 'b', at: at(0) })]
  const points = daily(rows, { from, to })
  assert.equal(points.length, 5)
  assert.equal(points[0].value, 1)
  assert.equal(points[2].value, 0)
  assert.equal(points[4].value, 1)
})

test('daily supports sum and avg reducers', () => {
  const from = addDays(new Date(), -1)
  const rows = [
    makeEntity({ type: 'metric', title: 'm', at: at(0), value: 10 }),
    makeEntity({ type: 'metric', title: 'm2', at: at(0), value: 20 }),
  ]
  assert.equal(daily(rows, { from, to: new Date(), reduce: 'sum' })[1].value, 30)
  assert.equal(daily(rows, { from, to: new Date(), reduce: 'avg' })[1].value, 15)
})

test('daily last takes the latest value by timestamp, whatever the input order', () => {
  const day = new Date()
  const stamp = (h) => { const d = new Date(day); d.setHours(h, 0, 0, 0); return d.toISOString() }
  const rows = [
    makeEntity({ type: 'metric', title: 'late', series: 'S', value: 30, at: stamp(18) }),
    makeEntity({ type: 'metric', title: 'early', series: 'S', value: 10, at: stamp(8) }),
    makeEntity({ type: 'metric', title: 'noon', series: 'S', value: 20, at: stamp(12) }),
  ]
  const [point] = daily(rows, { from: day, to: day, reduce: 'last' })
  assert.equal(point.value, 30)
  assert.deepEqual(point.rows.map((r) => r.title), ['early', 'noon', 'late'])
})

test('trend, momentum, anomalies and streak read a series correctly', () => {
  const rising = [1, 2, 3, 4, 5, 6].map((v, i) => ({ key: String(i), value: v }))
  assert.ok(trend(rising).slope > 0.9)
  assert.ok(trend(rising).r2 > 0.99)
  assert.ok(momentum(rising) > 1)

  const spiky = [2, 2, 2, 2, 2, 40, 2, 2].map((v, i) => ({ key: String(i), value: v }))
  assert.equal(anomalies(spiky, 2).length, 1)

  assert.equal(streak([0, 1, 1, 1].map((v, i) => ({ key: String(i), value: v }))), 3)
  assert.equal(streak([1, 1, 0].map((v, i) => ({ key: String(i), value: v }))), 0)

  const smoothed = movingAverage(rising, 3)
  assert.equal(smoothed.at(-1).value, 5)
})

test('reminders come from due dates and event times, sorted by urgency', () => {
  const entities = fixture()
  const reminders = buildReminders(Object.values(entities), { reminders: {}, settings: { reminderLeadMinutes: 15 } })
  assert.ok(reminders.length >= 3)
  assert.equal(reminders[0].urgency, 'overdue')
  assert.ok(reminders.every((r, i, list) => i === 0 || r.delta >= list[i - 1].delta))
})

test('dismissed and snoozed reminders drop out', () => {
  const entities = Object.values(fixture())
  const overdue = entities.find((e) => e.title === 'Overdue thing')
  const base = { reminders: {}, settings: { reminderLeadMinutes: 15 } }
  assert.ok(buildReminders(entities, base).some((r) => r.id === overdue.id))

  const dismissed = { ...base, reminders: { [overdue.id]: { dismissed: true } } }
  assert.equal(buildReminders(entities, dismissed).some((r) => r.id === overdue.id), false)

  const snoozed = { ...base, reminders: { [overdue.id]: { snoozedUntil: at(2) } } }
  assert.equal(buildReminders(entities, snoozed).some((r) => r.id === overdue.id), false)
})

test('insights name their evidence and rank by severity', () => {
  const entities = fixture()
  const insights = buildInsights(entities, rangeFor('30d'))
  const overdue = insights.find((i) => i.id === 'overdue')
  assert.ok(overdue)
  assert.equal(overdue.entities.length, 1)
  assert.ok(['critical', 'serious'].includes(insights[0].severity))
  assert.ok(insights.some((i) => i.id === 'unowned'))
  assert.ok(insights.some((i) => i.id === 'questions'))
})

test('built-in metrics evaluate against the entity map', () => {
  const entities = fixture()
  const range = rangeFor('30d')
  assert.equal(evaluate('tasks-open', entities, range).value, 6)
  assert.equal(evaluate('tasks-overdue', entities, range).value, 1)
  assert.equal(evaluate('risks-open', entities, range).value, 1)
})

test('numeric series in imported data are discovered without being defined', () => {
  const rows = [
    makeEntity({ type: 'metric', title: 'Signups', series: 'Signups', value: 10, unit: '', at: at(-1) }),
    makeEntity({ type: 'metric', title: 'Signups', series: 'Signups', value: 14, unit: '', at: at(0) }),
  ]
  const entities = Object.fromEntries(rows.map((r) => [r.id, r]))
  const found = discoveredSeries(entities)
  assert.deepEqual(found.map((s) => s.name), ['Signups'])

  const metric = availableMetrics(entities, []).find((m) => m.id === 'series:Signups')
  assert.equal(evaluate(metric, entities, rangeFor('30d')).value, 14)
})

test('a custom metric compiles to the same shape as a built-in', () => {
  const entities = fixture()
  const metric = compileCustom({
    id: 'custom:infra',
    name: 'Infra work',
    entityType: 'task',
    tags: ['infra'],
    reduce: 'count',
    dateField: 'createdAt',
  })
  const result = evaluate(metric, entities, rangeFor('30d'))
  assert.equal(result.name, 'Infra work')
  assert.equal(result.value, 2)
  assert.equal(result.series.length, 30)
})

test('entities with identical content get the same id, so re-import does not duplicate', () => {
  const a = makeEntity({ type: 'task', title: 'Ship it', source: { docId: 'd1' } })
  const b = makeEntity({ type: 'task', title: 'Ship it', source: { docId: 'd1' } })
  assert.equal(a.id, b.id)
})

test('merging keeps hand edits when a document is re-imported', () => {
  const original = makeEntity({ type: 'task', title: 'Ship it', status: 'open' })
  const edited = { ...original, status: 'done', meta: { editedByUser: true } }
  const reimported = makeEntity({ type: 'task', title: 'Ship it', status: 'open' })
  assert.equal(mergeEntity(edited, reimported).status, 'done')
  assert.equal(mergeEntity(original, reimported).status, 'open')
})

test('formatting keeps units attached and compacts large numbers', () => {
  assert.equal(format(1240.5, '$'), '$1,241')
  assert.equal(format(4.25, '%'), '4.25%')
  assert.equal(format(3, 'h'), '3h')
  assert.equal(compact(12400), '12.4k')
  assert.equal(compact(3_100_000), '3.1M')
})

test('the zip reader inflates a deflate entry', async () => {
  const body = 'Date,Revenue\n2026-01-01,100\n'
  const zip = await readZip(buildZip('sheet.csv', body))
  assert.deepEqual(zip.names(), ['sheet.csv'])
  assert.equal(await zip.text('sheet.csv'), body)
  assert.equal(await zip.text('missing.csv'), null)
})

/** Minimal single-entry ZIP writer, only used to exercise the reader. */
function buildZip(name, content) {
  const nameBytes = Buffer.from(name)
  const raw = Buffer.from(content)
  const deflated = zlib.deflateRawSync(raw)
  const crc = zlib.crc32 ? zlib.crc32(raw) : 0

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)

  const localBlock = Buffer.concat([local, nameBytes, deflated])

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(nameBytes.length, 28)
  central.writeUInt32LE(0, 42)

  const centralBlock = Buffer.concat([central, nameBytes])

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)

  return Buffer.concat([localBlock, centralBlock, eocd])
}

test('a snoozed reminder gets a fresh notification key', () => {
  const before = { id: 'r1', fireAt: 1000 }
  const after = { id: 'r1', fireAt: 5000 }
  assert.notEqual(announceKey(before), announceKey(after))
  assert.equal(announceKey(before), announceKey({ ...before }))
})

test('importing a workspace normalises every entity', () => {
  clearWorkspace()
  importWorkspace({ entities: { x: { id: 'x', type: 'task', title: 'Loose', people: 'Sam', tags: null } } })
  const e = getState().entities.x
  assert.deepEqual(e.people, [])
  assert.deepEqual(e.tags, [])
  assert.equal(e.status, 'open')
})

test('re-importing a document replaces what it produced but keeps hand edits', async () => {
  clearWorkspace()
  const v1 = new File(['## Action items\n- [ ] Keep me\n- [ ] Drop me'], 'Sync.md', { type: 'text/plain' })
  const first = await ingestFile(v1)
  const keep = first.entities.find((e) => e.title === 'Keep me')
  const drop = first.entities.find((e) => e.title === 'Drop me')
  updateEntity(keep.id, { status: 'done' })

  const v2 = new File(['## Action items\n- [ ] Keep me\n- [ ] New one'], 'Sync.md', { type: 'text/plain' })
  const second = await ingestFile(v2)
  assert.equal(second.doc.id, first.doc.id, 'same name is the same document')
  assert.notEqual(second.doc.meta.version, first.doc.meta.version, 'but a different version')
  const state = getState()
  assert.equal(state.entities[drop.id], undefined, 'stale item is gone')
  assert.equal(state.entities[keep.id].status, 'done', 'hand edit survives')
  assert.ok(Object.values(state.entities).some((e) => e.title === 'New one'))
})

test('syncDoc leaves other documents alone', () => {
  clearWorkspace()
  syncDoc('doc_a', [{ type: 'task', title: 'A1', source: { docId: 'doc_a' } }])
  syncDoc('doc_b', [{ type: 'task', title: 'B1', source: { docId: 'doc_b' } }])
  syncDoc('doc_a', [{ type: 'task', title: 'A2', source: { docId: 'doc_a' } }])
  const titles = Object.values(getState().entities).map((e) => e.title).sort()
  assert.deepEqual(titles, ['A2', 'B1'])
})

test('formatWeekday gives only the weekday', () => {
  assert.equal(formatWeekday('2026-03-04'), new Date(2026, 2, 4).toLocaleDateString(undefined, { weekday: 'long' }))
  assert.equal(formatWeekday(null), '')
})
