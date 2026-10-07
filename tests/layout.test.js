import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  WIDGETS, CATEGORIES, FIELDS, FIELD_INDEX, VIEW_GROUPS, ARCHITECTURE, UNKNOWN_WIDGET, fingerprint, widgetIndex, viewGroup,
} from '../src/layout/catalogue.js'
import { situationOf, topViews, countBucket, describeField } from '../src/layout/situation.js'
import { sampleExample, toExample, idealBoard, worth } from '../src/layout/teacher.js'
import { rng, predict, paramCount } from '../src/layout/nn.js'
import { score } from '../src/layout/evaluate.js'
import { emptyLayout, normaliseLayout, MAX_EXAMPLES } from '../src/layout/schema.js'
import { fromFile, propose, candidatesFrom } from '../src/layout/model.js'
import { finetune, inputOf } from '../src/layout/personal.js'
import { applyBoard, undoBoard, rememberBoard } from '../src/layout/store.js'
import { getState, clearWorkspace, setBoard, importWorkspace, exportWorkspace } from '../src/core/store.js'
import { makeEntity } from '../src/data/schema.js'
import { REGISTRY } from '../src/core/flags.js'
import { emptyBrainState } from '../src/brain/learn.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const weights = JSON.parse(readFileSync(join(root, 'src/layout/weights.json'), 'utf8'))

// ---------------------------------------------------------------- catalogue

/** Every defineWidget call in the source, read as text: JSX cannot be imported here. */
function declaredWidgets() {
  const files = [
    ...readdirSync(join(root, 'src/ui/widgets')).filter((f) => f.endsWith('.jsx')).map((f) => join(root, 'src/ui/widgets', f)),
    join(root, 'src/integrations/telamate-widgets.jsx'),
  ]
  const found = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    const constants = Object.fromEntries([...text.matchAll(/const (\w+) = '([^']+)'/g)].map((m) => [m[1], m[2]]))
    for (const call of text.matchAll(/defineWidget\(\{([\s\S]*?)render/g)) {
      const body = call[1]
      const id = /id:\s*'([^']+)'/.exec(body)?.[1]
      const size = /size:\s*'([^']+)'/.exec(body)?.[1]
      const cat = /category:\s*(?:'([^']+)'|(\w+))/.exec(body)
      const category = cat?.[1] ?? constants[cat?.[2]]
      if (id) found.push({ id, size, category })
    }
  }
  return found
}

test('the catalogue lists exactly the widgets the app defines, with their category and size', () => {
  // The model has a row per widget id. A widget added without a row would be
  // treated as a stranger forever; one renamed would orphan its row. Either is
  // silent in the UI, so the source is the thing checked.
  const declared = declaredWidgets().filter((w) => w.id !== 'my-widget')
  const byId = new Map(declared.map((w) => [w.id, w]))
  assert.equal(declared.length, byId.size, 'a widget id is declared twice')
  assert.deepEqual(
    [...byId.keys()].sort(),
    WIDGETS.map((w) => w.id).sort(),
    'src/layout/catalogue.js and the defineWidget calls disagree: update WIDGETS and retrain with scripts/train-layout.mjs',
  )
  for (const w of WIDGETS) {
    assert.equal(byId.get(w.id).category, w.category, `${w.id} category`)
    assert.equal(byId.get(w.id).size, w.size, `${w.id} size`)
  }
})

test('every category a widget uses has a row in the model', () => {
  for (const w of WIDGETS) assert.ok(CATEGORIES.includes(w.category), w.category)
})

test('the default Today board contains only widgets the model knows', () => {
  clearWorkspace()
  for (const item of getState().boards.today) assert.notEqual(widgetIndex(item.widgetId), UNKNOWN_WIDGET, item.widgetId)
})

test('a widget nobody has met shares the unknown row; a known one has its own', () => {
  assert.equal(widgetIndex('some-plugin'), UNKNOWN_WIDGET)
  assert.equal(widgetIndex('agenda'), 0)
  assert.equal(new Set(WIDGETS.map((w) => widgetIndex(w.id))).size, WIDGETS.length)
})

test('every field fits in the value slots the network reserves for it', () => {
  for (const f of FIELDS) assert.ok(f.values.length <= 8, f.id)
  assert.equal(ARCHITECTURE.ctxVocab, FIELDS.length * 8)
})

// ----------------------------------------------------------------- weights

test('the shipped weights were trained for this catalogue and this architecture', () => {
  assert.equal(weights.fingerprint, fingerprint(), 'retrain: node scripts/train-layout.mjs')
  assert.deepEqual(weights.architecture, ARCHITECTURE)
  assert.equal(typeof weights.weights, 'string')
  assert.ok(Buffer.from(weights.weights, 'base64').length === paramCount(ARCHITECTURE) * 4)
})

test('weights trained for another catalogue are refused loudly', () => {
  assert.throws(() => fromFile({ ...weights, fingerprint: '00000000' }), /different widget catalogue/)
  assert.throws(() => fromFile(null), /unrecognised/)
  assert.throws(() => fromFile({ ...weights, format: 2 }), /unrecognised/)
})

// ------------------------------------------------------------------ teacher

test('the simulator is deterministic for a seed', () => {
  const a = sampleExample(rng(5))
  const b = sampleExample(rng(5))
  assert.deepEqual(a, b)
})

test('a teacher never shows Telamate widgets to somebody without Telamate', () => {
  const random = rng(11)
  let seen = 0
  for (let i = 0; i < 400; i++) {
    const s = sampleExample(random)
    if (s.values[FIELD_INDEX.telamate] === 1) continue
    s.widgets.forEach((w, k) => {
      if (w.category === 'Telamate') {
        seen += 1
        assert.equal(s.labels[k], 0)
      }
    })
  }
  assert.ok(seen > 50)
})

test('a teacher hides the widgets whose thing does not exist', () => {
  const random = rng(3)
  let checked = 0
  for (let i = 0; i < 400; i++) {
    const s = sampleExample(random, { noise: 0.1 })
    const at = (id) => s.widgets.findIndex((w) => w.id === id)
    if (s.values[FIELD_INDEX.boards] === 0) {
      for (const id of ['board-summary', 'board-activity', 'my-work']) {
        if (at(id) >= 0) { assert.equal(s.labels[at(id)], 0, id); checked += 1 }
      }
    }
    if (s.values[FIELD_INDEX.risks] === 0 && at('risks') >= 0) { assert.equal(s.labels[at('risks')], 0); checked += 1 }
  }
  assert.ok(checked > 100)
})

test('the board stays inside its budget, and the labels are valid classes', () => {
  const random = rng(8)
  for (let i = 0; i < 300; i++) {
    const s = sampleExample(random)
    assert.equal(s.labels.length, s.widgets.length)
    assert.ok(s.labels.every((c) => Number.isInteger(c) && c >= 0 && c <= 4))
    assert.ok(s.labels.filter((c) => c > 0).length <= 8)
  }
})

test('the teacher reacts to the situation: meetings bring the agenda, a Monday brings the week', () => {
  const base = FIELDS.map(() => 0)
  const agenda = WIDGETS.find((w) => w.id === 'agenda')
  const week = WIDGETS.find((w) => w.id === 'week-ahead')
  const withEvents = base.map((v, i) => (i === FIELD_INDEX.events ? 3 : v))
  assert.ok(worth(agenda, withEvents, 'planner') > worth(agenda, base, 'planner') + 0.5)
  const sunday = base.map((v, i) => (i === FIELD_INDEX.day ? 6 : v))
  const wednesday = base.map((v, i) => (i === FIELD_INDEX.day ? 2 : v))
  assert.ok(worth(week, sunday, 'planner') > worth(week, wednesday, 'planner') + 0.2)
})

test('the metric scores what it says', () => {
  const s = score([[0, 1, 2], [0, 0, 0]], [[0, 1, 3], [0, 0, 0]])
  assert.equal(s.examples, 2)
  assert.equal(s.exact, 0.5)
  assert.ok(Math.abs(s.accuracy - 5 / 6) < 1e-12)
  // Both kept two widgets, one size agrees.
  assert.equal(s.sizeAgreement, 0.5)
  assert.equal(s.visibilityF1, 1)
})

// ---------------------------------------------------------------- situation

const at = (y, m, d, h = 9, min = 0) => new Date(y, m - 1, d, h, min)

function stateWith(entities, extra = {}) {
  const map = {}
  for (const e of entities) { const made = makeEntity(e); map[made.id] = made }
  return { entities: map, triage: {}, brain: emptyBrainState(), focus: { sessions: [] }, work: { boards: [] }, settings: { telamate: { url: '' } }, ...extra }
}

test('counts become the buckets the model reads', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 40].map(countBucket), [0, 1, 1, 2, 2, 3, 3])
})

test('a Monday morning with work on is read as exactly that', () => {
  const now = at(2026, 3, 9, 9) // a Monday
  const state = stateWith([
    { type: 'task', title: 'late a', due: '2026-03-02', status: 'open' },
    { type: 'task', title: 'late b', due: '2026-03-04', status: 'open' },
    { type: 'task', title: 'late c', due: '2026-03-06', status: 'open' },
    { type: 'task', title: 'today', due: '2026-03-09', status: 'open' },
    { type: 'task', title: 'done and late', due: '2026-03-01', status: 'done' },
    { type: 'event', title: 'standup', at: at(2026, 3, 9, 10).toISOString(), status: 'open' },
    { type: 'event', title: 'cancelled', at: at(2026, 3, 9, 11).toISOString(), status: 'cancelled' },
    { type: 'event', title: 'yesterday', at: at(2026, 3, 8, 10).toISOString(), status: 'open' },
    { type: 'risk', title: 'vendor slips', status: 'open' },
  ])
  const v = situationOf(state, now)
  assert.equal(v[FIELD_INDEX.hour], 2, 'morning')
  assert.equal(v[FIELD_INDEX.day], 0, 'Monday')
  assert.equal(v[FIELD_INDEX.overdue], 2, 'three late, none of them the done one')
  assert.equal(v[FIELD_INDEX.dueToday], 1)
  assert.equal(v[FIELD_INDEX.events], 1, 'one meeting: not the cancelled one, not yesterday')
  assert.equal(v[FIELD_INDEX.risks], 1)
  assert.equal(v[FIELD_INDEX.telamate], 0)
})

test('a task due today is not counted as late, in any timezone', () => {
  // The day key is a local calendar day; read as UTC it would be yesterday
  // evening in the Americas and make every due-today task look overdue.
  const now = at(2026, 3, 9, 0, 30)
  const v = situationOf(stateWith([{ type: 'task', title: 'x', due: '2026-03-09', status: 'open' }]), now)
  assert.equal(v[FIELD_INDEX.overdue], 0)
  assert.equal(v[FIELD_INDEX.dueToday], 1)
})

test('the hour bands cover the day without gaps', () => {
  const bands = Array.from({ length: 24 }, (_, h) => situationOf(stateWith([]), at(2026, 3, 9, h))[FIELD_INDEX.hour])
  assert.deepEqual(bands.slice(0, 5), [0, 0, 0, 0, 0])
  assert.deepEqual(bands.slice(5, 8), [1, 1, 1])
  assert.deepEqual(bands.slice(8, 12), [2, 2, 2, 2])
  assert.deepEqual(bands.slice(12, 14), [3, 3])
  assert.deepEqual(bands.slice(14, 18), [4, 4, 4, 4])
  assert.deepEqual(bands.slice(18, 22), [5, 5, 5, 5])
  assert.deepEqual(bands.slice(22), [0, 0])
})

test('focus time counts only what ended today', () => {
  const now = at(2026, 3, 9, 15)
  const sessions = [
    { endedAt: at(2026, 3, 9, 10).toISOString(), minutes: 25 },
    { endedAt: at(2026, 3, 9, 12).toISOString(), minutes: 50 },
    { endedAt: at(2026, 3, 8, 12).toISOString(), minutes: 300 },
  ]
  const v = situationOf(stateWith([], { focus: { sessions } }), now)
  assert.equal(v[FIELD_INDEX.focus], 2, '75 minutes is 25 to 90')
})

test('habits come from the usage counters, with Today left out', () => {
  assert.deepEqual(topViews({}), [0, 0])
  assert.deepEqual(topViews(null), [0, 0])
  const g = (name) => VIEW_GROUPS.indexOf(name)
  assert.deepEqual(topViews({ today: 900, work: 5, analytics: 9 }), [g('analytics'), g('boards')])
  // Views that share a group add up: Stash and Library are both reading.
  assert.deepEqual(topViews({ library: 3, stash: 4, triage: 6 }), [g('library'), g('triage')])
  // A tie goes to the earlier group, not to whichever key came first.
  assert.deepEqual(topViews({ analytics: 4, work: 4 }), [g('boards'), g('analytics')])
  assert.deepEqual(topViews({ work: -3, nonsense: 100, focus: NaN }), [0, 0])
  assert.equal(viewGroup('settings'), null)
})

test('every field has words for every value it can take', () => {
  const base = FIELDS.map(() => 0)
  for (const [i, f] of FIELDS.entries()) {
    for (let v = 0; v < f.values.length; v++) {
      const phrase = describeField(base.map((x, k) => (k === i ? v : x)), f.id)
      assert.ok(typeof phrase === 'string' && phrase.length > 3, `${f.id}=${v}`)
      assert.ok(!phrase.includes('undefined'), phrase)
    }
  }
})

// ------------------------------------------------------------------- schema

test('a saved layout slice survives a round trip and rejects junk', () => {
  assert.deepEqual(normaliseLayout(undefined), emptyLayout())
  assert.deepEqual(normaliseLayout('nope'), emptyLayout())
  const good = {
    values: FIELDS.map(() => 0),
    widgets: [{ id: 'agenda', category: 'Day', size: 'md' }, { id: null, category: 'Mine', size: 'lg' }],
    labels: [2, 0],
    at: '2026-03-09T09:00:00.000Z',
  }
  const slice = normaliseLayout({
    examples: [
      good,
      { ...good, values: [1, 2] },
      { ...good, labels: [9, 0] },
      { ...good, labels: [1] },
      { ...good, values: FIELDS.map(() => 99) },
      { ...good, widgets: [] },
      'junk',
    ],
    undo: { view: 'today', at: '2026-03-09T09:00:00.000Z', items: [{ id: 'a', widgetId: 'agenda', size: 'huge' }, { nope: 1 }] },
    personal: { trainedAt: '2026-03-09T09:00:00.000Z', examples: 7.9, steps: -4 },
  })
  assert.equal(slice.examples.length, 1)
  assert.deepEqual(slice.examples[0].widgets[1], { id: null, category: 'Mine', size: 'lg' })
  assert.deepEqual(slice.undo.items, [{ id: 'a', widgetId: 'agenda' }], 'an unknown size is dropped, a malformed item is dropped')
  assert.deepEqual(slice.personal, { trainedAt: '2026-03-09T09:00:00.000Z', examples: 7, steps: 0 })
  assert.equal(normaliseLayout({ undo: { view: 'analytics', at: 'x', items: [] } }).undo, null)
})

test('the saved examples are capped', () => {
  const ex = { values: FIELDS.map(() => 0), widgets: [{ id: 'agenda', category: 'Day', size: 'md' }], labels: [1] }
  const slice = normaliseLayout({ examples: Array.from({ length: MAX_EXAMPLES + 30 }, () => ex) })
  assert.equal(slice.examples.length, MAX_EXAMPLES)
})

// -------------------------------------------------------------------- store

test('applying a suggestion keeps the old board, and undo puts it back exactly', () => {
  clearWorkspace()
  const before = structuredClone(getState().boards.today)
  const next = before.slice(0, 3).map((i) => ({ ...i, size: 'lg' }))
  applyBoard('today', next)
  assert.deepEqual(getState().boards.today, next)
  assert.deepEqual(getState().layout.undo.items, before)
  assert.equal(undoBoard(), true)
  assert.deepEqual(getState().boards.today, before)
  assert.equal(getState().layout.undo, null)
  assert.equal(undoBoard(), false, 'a second undo has nothing to put back')
})

test('a board is remembered with the day it was made on, and the model\'s own output is not', () => {
  clearWorkspace()
  const candidates = candidatesFrom([
    { id: 'agenda', name: 'Agenda', category: 'Day', size: 'md' },
    { id: 'pulse', name: 'Pulse', category: 'Analytics', size: 'sm' },
    { id: 'brain', name: 'Brain', category: 'Day', size: 'sm' },
  ])
  const values = FIELDS.map(() => 1)
  const mine = [{ id: 'w1', widgetId: 'agenda', size: 'lg' }, { id: 'w2', widgetId: 'brain' }]
  assert.equal(rememberBoard({ values, candidates, items: mine, now: at(2026, 3, 9, 9) }), true)
  const [saved] = getState().layout.examples
  assert.deepEqual(saved.labels, [3, 0, 1], 'agenda large, pulse absent, brain at its default small')
  assert.deepEqual(saved.widgets.map((w) => w.id), ['agenda', 'pulse', 'brain'])

  // Same hour, same situation: one opinion, not two.
  rememberBoard({ values, candidates, items: [{ id: 'w1', widgetId: 'agenda', size: 'xl' }], now: at(2026, 3, 9, 9, 40) })
  assert.equal(getState().layout.examples.length, 1)
  assert.deepEqual(getState().layout.examples[0].labels, [4, 0, 0])

  // A board the model just produced says nothing about the person.
  const produced = [{ id: 'w9', widgetId: 'pulse', size: 'md' }]
  applyBoard('today', produced)
  assert.equal(rememberBoard({ values, candidates, items: produced, now: at(2026, 3, 10, 9) }), false)
  assert.equal(getState().layout.examples.length, 1)
})

test('exporting and restoring keeps the examples but not an undo that belongs to another board', () => {
  clearWorkspace()
  const candidates = candidatesFrom([{ id: 'agenda', name: 'Agenda', category: 'Day', size: 'md' }])
  rememberBoard({ values: FIELDS.map(() => 0), candidates, items: [{ id: 'a', widgetId: 'agenda' }], now: at(2026, 3, 9, 9) })
  applyBoard('today', [{ id: 'z', widgetId: 'pulse', size: 'sm' }])
  const file = exportWorkspace()
  clearWorkspace()
  importWorkspace(file)
  assert.equal(getState().layout.examples.length, 1)
  assert.equal(getState().layout.undo, null)
})

test('the layout flag is registered, alpha, and says what it does', () => {
  assert.equal(REGISTRY.layout.maturity, 'alpha')
  assert.match(REGISTRY.layout.summary, /never rearranges/)
})

// ------------------------------------------------------------------ model

const shipped = fromFile(weights)

test('the shipped model beats a board that never changes, and reads the situation', () => {
  // Measured on situations from a stream the training never used.
  const random = rng(31337)
  const samples = Array.from({ length: 400 }, () => sampleExample(random))
  const examples = samples.map(toExample)
  const classes = (ex) => predict(shipped.model, ex).map((row) => row.indexOf(Math.max(...row)))
  const got = score(examples.map(classes), examples.map((e) => e.labels))

  clearWorkspace()
  const fixed = new Map(getState().boards.today.map((i) => [i.widgetId, i.size]))
  const sizes = ['sm', 'md', 'lg', 'xl']
  const static_ = score(
    samples.map((s) => s.widgets.map((w) => (w.id && fixed.has(w.id) ? sizes.indexOf(fixed.get(w.id)) + 1 : 0))),
    samples.map((s) => s.labels),
  )
  assert.ok(got.accuracy > static_.accuracy + 0.08, `model ${got.accuracy} vs fixed board ${static_.accuracy}`)
  assert.ok(got.visibilityF1 > static_.visibilityF1 + 0.15, `F1 ${got.visibilityF1} vs ${static_.visibilityF1}`)

  // The same model with each situation swapped for somebody else's is worse:
  // the answer depends on the day, not only on the widget.
  const swapped = examples.map((ex, i) => ({ ...ex, ctx: examples[(i + 1) % examples.length].ctx }))
  const control = score(swapped.map(classes), examples.map((e) => e.labels))
  assert.ok(got.accuracy > control.accuracy + 0.03, `with the situation ${got.accuracy}, with a stranger's ${control.accuracy}`)
})

/** Probability that the widget at the end of a realistic candidate list is shown. */
function chanceShown(values, extra) {
  const widgets = [...registered(), extra].map((w) => ({ ...w, wid: w.wid ?? widgetIndex(w.id) }))
  const p = predict(shipped.model, toExample({ values, widgets, labels: widgets.map(() => 0) }))
  return 1 - p.at(-1)[0]
}

test('it places a widget it has never seen by its category and the day', () => {
  const quiet = FIELDS.map(() => 0)
  quiet[FIELD_INDEX.hour] = 2
  quiet[FIELD_INDEX.size] = 2
  const plugin = (category) => ({ id: 'plugin-x', name: 'Plugin', category, size: 'md', wid: UNKNOWN_WIDGET })

  // A plugin in the Day category lands on a working morning; one in Analytics,
  // which this kind of person rarely wants up front, mostly does not.
  // (Each widget competes for a handful of places, so "likely" here is a few
  // chances in ten, against almost none.)
  const day = chanceShown(quiet, plugin('Day'))
  const analytics = chanceShown(quiet, plugin('Analytics'))
  assert.ok(day > 0.05 && day > analytics * 4, `${day} vs ${analytics}`)

  // A Telamate plugin belongs where Telamate is connected and nowhere else.
  const connected = quiet.map((v, i) => (i === FIELD_INDEX.telamate ? 1 : v))
  const on = chanceShown(connected, plugin('Telamate'))
  const off = chanceShown(quiet, plugin('Telamate'))
  assert.ok(on > 0.05 && on > off * 5, `${on} vs ${off}`)
})

function fakeCurrent() {
  return [
    { id: 'i1', widgetId: 'agenda', size: 'md' },
    { id: 'i2', widgetId: 'focus-tasks', size: 'md' },
    { id: 'i3', widgetId: 'brain', size: 'sm', config: { title: 'My notes' } },
    { id: 'i4', widgetId: 'some-plugin', size: 'lg' },
    { id: 'i5', widgetId: 'agenda', size: 'sm' },
  ]
}

const registered = () => WIDGETS.map((w) => ({ id: w.id, name: w.id, category: w.category, size: w.size }))

test('a proposal never removes a widget the person configured, and leaves strangers alone', () => {
  const quiet = FIELDS.map(() => 0) // no meetings, so no agenda
  const candidates = candidatesFrom(registered())
  let n = 0
  const p = propose({ model: shipped.model, values: quiet, candidates, current: fakeCurrent(), newId: () => `n${++n}` })
  const ids = p.items.map((i) => i.id)
  assert.ok(ids.includes('i3'), 'configured widget kept')
  assert.equal(p.items.find((i) => i.id === 'i3').config.title, 'My notes')
  assert.ok(ids.includes('i4'), 'a widget the model was not asked about is kept')
  assert.equal(p.items.find((i) => i.id === 'i4').size, 'lg', 'and untouched')
  // New widgets get fresh ids and every id is unique.
  assert.equal(new Set(ids).size, ids.length)
  // With nothing booked, the agenda goes - every plain copy of it, and the
  // change says how many it takes.
  assert.ok(!ids.includes('i1') && !ids.includes('i5'))
  const gone = p.changes.find((c) => c.widgetId === 'agenda')
  assert.equal(gone.kind, 'remove')
  assert.equal(gone.copies, 2)
})

test('when a widget stays, so do the extra copies somebody added', () => {
  const busy = FIELDS.map(() => 0)
  busy[FIELD_INDEX.events] = 3
  busy[FIELD_INDEX.day] = 1
  busy[FIELD_INDEX.hour] = 2
  const p = propose({ model: shipped.model, values: busy, candidates: candidatesFrom(registered()), current: fakeCurrent(), newId: () => 'x' })
  const ids = p.items.map((i) => i.id)
  assert.ok(ids.includes('i1') && ids.includes('i5'), 'both agenda copies stay')
  assert.equal(p.items.find((i) => i.id === 'i5').size, 'sm', 'the extra copy is not resized')
})

test('with no margin for error the model changes nothing', () => {
  const candidates = candidatesFrom(registered())
  const values = FIELDS.map((f, i) => (i % 3))
  const p = propose({ model: shipped.model, values, candidates, current: fakeCurrent(), margin: 1, newId: () => 'x' })
  assert.deepEqual(p.changes, [])
})

test('a proposal is stable: apply it and ask again and it has nothing to add', () => {
  const candidates = candidatesFrom(registered())
  const random = rng(12)
  for (let i = 0; i < 12; i++) {
    const { values } = sampleExample(random)
    let n = 0
    const first = propose({ model: shipped.model, values, candidates, current: fakeCurrent(), newId: () => `a${++n}` })
    const second = propose({ model: shipped.model, values, candidates, current: first.items, newId: () => `b${++n}` })
    assert.deepEqual(second.changes, [], `situation ${i}`)
    assert.equal(second.reordered, false)
    assert.deepEqual(second.items.map((x) => x.id), first.items.map((x) => x.id))
  }
})

test('every change names a widget, a direction, a confidence, and the inputs behind it', () => {
  const candidates = candidatesFrom(registered())
  const values = FIELDS.map(() => 0)
  values[FIELD_INDEX.events] = 3
  values[FIELD_INDEX.overdue] = 3
  const p = propose({ model: shipped.model, values, candidates, current: [], newId: (() => { let n = 0; return () => `n${++n}` })() })
  assert.ok(p.changes.length > 0)
  for (const c of p.changes) {
    assert.ok(['add', 'remove', 'resize'].includes(c.kind))
    assert.ok(c.confidence > 0 && c.confidence <= 1)
    assert.ok(Array.isArray(c.because))
    assert.ok(c.kind !== 'remove', 'there was nothing on the board to remove')
    assert.ok(['sm', 'md', 'lg', 'xl'].includes(c.to))
  }
  // With six meetings today, the agenda is among the additions, and it says why.
  const agenda = p.changes.find((c) => c.widgetId === 'agenda')
  assert.ok(agenda, 'agenda proposed')
  assert.ok(agenda.because.some((s) => /meetings/.test(s)), agenda.because.join(' | '))
})

test('with meetings on the calendar the agenda is far likelier to show than without', () => {
  const random = rng(77)
  const rows = registered().map((w) => ({ ...w, wid: widgetIndex(w.id) }))
  const at = rows.findIndex((w) => w.id === 'agenda')
  let withMeetings = 0
  let without = 0
  const N = 80
  for (let i = 0; i < N; i++) {
    const { values } = sampleExample(random)
    for (const events of [0, 3]) {
      const v = values.map((x, k) => (k === FIELD_INDEX.events ? events : x))
      v[FIELD_INDEX.day] = 1 // weekends are legitimately quieter; compare like with like
      const p = predict(shipped.model, toExample({ values: v, widgets: rows, labels: rows.map(() => 0) }))[at]
      if (events === 0) without += 1 - p[0]
      else withMeetings += 1 - p[0]
    }
  }
  assert.ok(withMeetings / N > without / N + 0.5, `${withMeetings / N} vs ${without / N}`)
})

// ---------------------------------------------------------- on-device tuning

test('fine-tuning learns what a person keeps, on boards it had not seen, without touching the shipped copy', async () => {
  // A person who never wants the focus list or the agenda on Today and always
  // keeps the pulse, whatever the day. The shipped model thinks otherwise.
  const random = rng(2024)
  const examples = Array.from({ length: 30 }, () => {
    const s = sampleExample(random, { plugins: false })
    const labels = s.widgets.map((w, i) => (w.id === 'focus-tasks' || w.id === 'agenda' ? 0 : w.id === 'pulse' ? 2 : s.labels[i]))
    return { values: s.values, widgets: s.widgets.map((w) => ({ id: w.id, category: w.category, size: w.size })), labels }
  })
  const copy = JSON.stringify(Array.from(shipped.model.params['head.w']))
  const progress = []
  const result = await finetune({ base: shipped.model, examples, steps: 60, rate: 1e-3, onProgress: (d, t) => progress.push([d, t]) })

  assert.equal(JSON.stringify(Array.from(shipped.model.params['head.w'])), copy, 'the base model was modified')
  assert.notEqual(result.model, shipped.model)
  assert.equal(result.yours.held, true, 'thirty boards is enough to hold some back')
  assert.ok(result.yours.after > result.yours.before + 0.02, `${result.yours.before} -> ${result.yours.after}`)
  assert.ok(result.general.before - result.general.after < 0.08, 'it did not forget how to read an ordinary day')
  assert.equal(result.accepted, true)
  assert.equal(result.reason, null)
  assert.equal(progress.at(-1)[0], 60)
})

test('a fine-tune that wrecks the general model is refused, and says why', async () => {
  const random = rng(5)
  // Nonsense preferences, a huge step size and no replay would be needed to
  // forget; the replay is part of the design, so use the rate to break it.
  const examples = Array.from({ length: 12 }, () => {
    const s = sampleExample(random, { plugins: false })
    return { values: s.values, widgets: s.widgets.map((w) => ({ id: w.id, category: w.category, size: w.size })), labels: s.labels.map((_, i) => (i % 5)) }
  })
  const result = await finetune({ base: shipped.model, examples, steps: 30, rate: 0.08 })
  assert.equal(result.accepted, false)
  assert.match(result.reason, /kept/)
})

test('training can be cancelled part way', async () => {
  const random = rng(6)
  const s = sampleExample(random, { plugins: false })
  const examples = Array.from({ length: 6 }, () => ({ values: s.values, widgets: s.widgets.map((w) => ({ id: w.id, category: w.category, size: w.size })), labels: s.labels }))
  const controller = new AbortController()
  await assert.rejects(
    finetune({ base: shipped.model, examples, steps: 400, signal: controller.signal, onProgress: (d) => { if (d >= 8) controller.abort() } }),
    (err) => err.name === 'AbortError',
  )
})

test('saved examples decode into network input with the widget rows they were made with', () => {
  const input = inputOf({
    values: FIELDS.map(() => 0),
    widgets: [{ id: 'agenda', category: 'Day', size: 'md' }, { id: 'mystery', category: 'Fun', size: 'lg' }],
    labels: [1, 0],
  })
  assert.equal(input.widgets[0].wid, widgetIndex('agenda'))
  assert.equal(input.widgets[1].wid, UNKNOWN_WIDGET)
  assert.equal(input.widgets[1].cat, CATEGORIES.length, 'a plugin\'s own category lands on the "other" row')
  assert.deepEqual(input.labels, [1, 0])
})

test('the teacher\'s noise-free board is a real ceiling on the simulated task', () => {
  const random = rng(404)
  const samples = Array.from({ length: 300 }, () => sampleExample(random))
  const ideal = score(samples.map((s) => idealBoard(s.widgets, s.values, s.persona)), samples.map((s) => s.labels))
  assert.ok(ideal.accuracy > 0.85 && ideal.accuracy < 1, String(ideal.accuracy))
})
