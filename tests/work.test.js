import test from 'node:test'
import assert from 'node:assert/strict'

globalThis.localStorage ||= { getItem: () => null, setItem: () => {} }

import { compileFormula } from '../src/work/formula.js'
import { DEFAULT_STATUS_LABELS, cellValue, elapsed, isBlank, readCell, writeCell } from '../src/work/columns.js'
import { makeBoard, makeColumn, itemDraft, normaliseWork, topLevel } from '../src/work/schema.js'
import { applyFilters, applySort, groupItems, opsFor, summarise } from '../src/work/query.js'
import { dependencyShifts, describeAutomation, dueEffects, makeAutomation, planEffects, recipeCatalogue } from '../src/work/automations.js'
import { boardFromTable, boardToCsv } from '../src/work/csv.js'
import { TEMPLATES } from '../src/work/templates.js'
import { parseDelimited, toTable } from '../src/ingest/parsers/csv.js'
import { makeEntity } from '../src/data/schema.js'
import { addDays, iso } from '../src/core/time.js'
import { buildTriage } from '../src/engine/triage.js'

const at = (days) => iso(addDays(new Date(), days))

// ------------------------------------------------------------------ formula

test('a formula is interpreted, never evaluated', () => {
  const cases = [
    ['{Budget} * 2', { Budget: 21 }, 42],
    ['ROUND({Budget} / 3, 2)', { Budget: 10 }, 3.33],
    ['IF({Done} == 1, "shipped", "open")', { Done: 1 }, 'shipped'],
    ['PERCENT({Current}, {Target})', { Current: 3, Target: 4 }, 75],
    ['CONCAT({a}, "-", {b})', { a: 'x', b: 'y' }, 'x-y'],
    ['2 ^ 3 ^ 2', {}, 512],
    ['-{n} + 1', { n: 5 }, -4],
  ]
  for (const [source, scope, want] of cases) {
    const compiled = compileFormula(source)
    assert.equal(compiled.error, null, source)
    assert.equal(compiled.run(scope), want, source)
  }
  // Nothing that looks like code gets a chance to run.
  assert.ok(compileFormula('constructor.constructor("return 1")()').error || compileFormula('constructor.constructor("x")()').run({}) === '')
  assert.equal(compileFormula('1 +').error, 'The formula ends too early')
  assert.equal(compileFormula('{a} / 0').run({ a: 1 }), '')
})

// ------------------------------------------------------------------ columns

test('a status column is the entity status, both ways', () => {
  const board = makeBoard({ name: 'B' })
  const status = board.columns.find((c) => c.kind === 'status')
  const item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  assert.equal(readCell(item, status, board), 'not-started')
  const patch = writeCell(item, status, 'stuck', board)
  assert.equal(patch.status, 'blocked')
  const moved = { ...item, ...patch, meta: { ...item.meta, ...patch.meta } }
  assert.equal(cellValue(moved, status, board), 'stuck')
})

test('every column kind survives a write and a read', () => {
  const board = makeBoard({
    name: 'B',
    columns: [
      makeColumn('text', 'Text'), makeColumn('number', 'Num'), makeColumn('checkbox', 'Check'),
      makeColumn('rating', 'Stars'), makeColumn('progress', 'Progress'), makeColumn('link', 'Link'),
      makeColumn('timeline', 'When'), makeColumn('tags', 'Tags'), makeColumn('person', 'Who'),
      makeColumn('time', 'Time'), makeColumn('dependency', 'After'),
    ],
  })
  let item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  const values = {
    Text: 'hello', Num: '12.5', Check: true, Stars: 9, Progress: 250,
    Link: 'https://example.com/a', When: { from: '2026-01-01', to: '2026-01-05' },
    Tags: 'a, b, a', Who: ['Ana', 'Ana'], Time: { seconds: 90, running: false }, After: ['itm_1'],
  }
  for (const column of board.columns) {
    const patch = writeCell(item, column, values[column.name], board)
    item = { ...item, ...patch, meta: { ...item.meta, ...patch.meta, columns: { ...item.meta.columns, ...(patch.meta?.columns || {}) } } }
  }
  const read = (name) => cellValue(item, board.columns.find((c) => c.name === name), board)
  assert.equal(read('Text'), 'hello')
  assert.equal(read('Num'), 12.5)
  assert.equal(read('Check'), true)
  assert.equal(read('Stars'), 5, 'a rating is clamped to its max')
  assert.equal(read('Progress'), 100, 'progress is clamped to 100')
  assert.deepEqual(read('Link'), { url: 'https://example.com/a', label: '' })
  assert.equal(read('When').from.slice(0, 10), '2026-01-01')
  assert.deepEqual(read('Tags'), ['a', 'b'], 'tags dedupe')
  assert.deepEqual(read('Who'), ['Ana'])
  assert.equal(elapsed(read('Time')), 90)
  assert.deepEqual(read('After'), ['itm_1'])
})

test('a link column refuses anything that is not http', () => {
  const board = makeBoard({ name: 'B', columns: [makeColumn('link', 'Link')] })
  const item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  const column = board.columns[0]
  assert.equal(writeCell(item, column, 'javascript:alert(1)', board).meta.columns[column.id], null)
  assert.equal(writeCell(item, column, 'https://ok.example', board).meta.columns[column.id].url, 'https://ok.example')
})

test('a read-only column cannot be written', () => {
  const board = makeBoard({ name: 'B', columns: [makeColumn('formula', 'F', { formula: '1 + 1' }), makeColumn('itemid', 'ID')] })
  const item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  assert.equal(writeCell(item, board.columns[0], 99, board), null)
  assert.equal(readCell(item, board.columns[0], board), 2)
  assert.equal(readCell(item, board.columns[1], board), item.id)
})

// -------------------------------------------------------- filter and group

function seed() {
  const board = makeBoard({ name: 'B' })
  const status = board.columns.find((c) => c.kind === 'status')
  const due = board.columns.find((c) => c.kind === 'date')
  const rows = [
    { title: 'Alpha', status: 'open', due: at(-3), people: ['Ana'], labelId: 'not-started', group: 0 },
    { title: 'Beta', status: 'done', due: at(2), people: ['Ben'], labelId: 'done', group: 1 },
    { title: 'Gamma', status: 'doing', due: null, people: [], labelId: 'working', group: 0 },
  ].map((row) => makeEntity(itemDraft(board, board.groups[row.group].id, {
    title: row.title, status: row.status, due: row.due, people: row.people,
    meta: { columns: { [status.id]: row.labelId } },
  })))
  return { board, rows, status, due }
}

test('filters read the column the way the column reads itself', () => {
  const { board, rows, status, due } = seed()
  const run = (filters) => applyFilters(rows, { config: { filters } }, board).map((r) => r.title)
  assert.deepEqual(run([{ columnId: status.id, op: 'is', value: 'done' }]), ['Beta'])
  assert.deepEqual(run([{ columnId: status.id, op: 'is-not', value: 'done' }]), ['Alpha', 'Gamma'])
  assert.deepEqual(run([{ columnId: due.id, op: 'empty' }]), ['Gamma'])
  assert.deepEqual(run([{ columnId: due.id, op: 'within', value: 'overdue' }]), ['Alpha'])
  assert.deepEqual(run([{ columnId: 'title', op: 'contains', value: 'et' }]), ['Beta'])
  assert.deepEqual(applyFilters(rows, { config: { search: 'ana' } }, board).map((r) => r.title), ['Alpha'])
})

test('grouping by a column gives every label a lane, even an empty one', () => {
  const { board, rows, status } = seed()
  const lanes = groupItems(rows, board, status.id)
  assert.deepEqual(lanes.map((l) => `${l.name}:${l.items.length}`), ['Not started:1', 'Working on it:1', 'Stuck:0', 'Done:1'])
  assert.deepEqual(groupItems(rows, board, 'group').map((l) => l.items.length), [2, 1, 0])
  assert.equal(groupItems(rows, board, 'none')[0].items.length, 3)
})

test('sorting puts empty cells last, whichever way it runs', () => {
  const { board, rows, due } = seed()
  const asc = applySort(rows, { config: { sort: { columnId: due.id, dir: 'asc' } } }, board)
  const desc = applySort(rows, { config: { sort: { columnId: due.id, dir: 'desc' } } }, board)
  assert.equal(asc.at(-1).title, 'Gamma')
  assert.equal(desc.at(-1).title, 'Gamma')
  assert.equal(asc[0].title, 'Alpha')
  assert.equal(desc[0].title, 'Beta')
})

test('summaries add up what the column holds', () => {
  const { board, rows, status, due } = seed()
  const number = makeColumn('number', 'Points')
  board.columns.push(number)
  const withPoints = rows.map((r, i) => ({ ...r, meta: { ...r.meta, columns: { ...r.meta.columns, [number.id]: [3, 5, 1][i] } } }))
  assert.equal(summarise(withPoints, number, board, 'sum').text, '9')
  assert.equal(summarise(withPoints, number, board, 'avg').text, '3')
  assert.equal(summarise(withPoints, number, board, 'median').text, '3')
  assert.equal(summarise(rows, status, board, 'percent-done').text, '33%')
  assert.equal(summarise(rows, due, board, 'overdue').text, '1')
  assert.match(summarise(rows, status, board, 'breakdown').text, /Not started 1/)
})

test('the operators offered match the column kind', () => {
  const board = makeBoard({ name: 'B' })
  assert.ok(opsFor(board.columns.find((c) => c.kind === 'date')).includes('within'))
  assert.ok(!opsFor(board.columns.find((c) => c.kind === 'status')).includes('gt'))
})

// -------------------------------------------------------------- automations

test('a rule fires only when its trigger and its conditions both hold', () => {
  const board = makeBoard({ name: 'B' })
  board.groups.push({ id: 'gdone', name: 'Done', tone: 'good', collapsed: false })
  const status = board.columns.find((c) => c.kind === 'status')
  const priority = board.columns.find((c) => c.kind === 'priority')
  board.automations = [makeAutomation({
    trigger: { kind: 'status-becomes', columnId: status.id, value: 'done' },
    conditions: [{ columnId: priority.id, op: 'is', value: 'critical' }],
    actions: [{ kind: 'move-to-group', groupId: 'gdone' }],
  })]
  const low = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  const high = makeEntity(itemDraft(board, board.groups[0].id, { title: 'y', priority: 2, meta: { columns: { [priority.id]: 'critical' } } }))
  const event = (item) => ({ kind: 'status-becomes', item, columnId: status.id, value: 'done' })
  assert.equal(planEffects(board, event(low)).length, 0)
  assert.equal(planEffects(board, event(high)).length, 1)
  assert.equal(planEffects(board, event(high))[0].kind, 'move-group')
})

test('a disabled rule does nothing and a described rule reads like English', () => {
  const board = makeBoard({ name: 'B' })
  const recipe = recipeCatalogue(board).find((r) => r.id === 'due-tomorrow')
  const automation = { ...recipe.build(), enabled: false }
  board.automations = [automation]
  assert.equal(dueEffects(board, [], {}).length, 0)
  assert.match(describeAutomation(board, recipe.build()), /^When Due is 1 days away, notify me/)
})

test('a date rule fires once a day per item', () => {
  const board = makeBoard({ name: 'B' })
  const date = board.columns.find((c) => c.kind === 'date')
  board.automations = [makeAutomation({
    trigger: { kind: 'date-arrives', columnId: date.id, offset: 0 },
    actions: [{ kind: 'notify', text: '{item} is due' }],
  })]
  const item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Ship', due: at(0) }))
  const first = dueEffects(board, [item], {})
  assert.equal(first.length, 1)
  assert.equal(first[0].text, 'Ship is due')
  const fired = Object.fromEntries(first.map((e) => [e.fireKey, true]))
  assert.equal(dueEffects(board, [item], { fired }).length, 0)
})

test('an overdue rule ignores anything already done', () => {
  const board = makeBoard({ name: 'B' })
  const date = board.columns.find((c) => c.kind === 'date')
  board.automations = [makeAutomation({
    trigger: { kind: 'item-overdue', columnId: date.id },
    actions: [{ kind: 'notify', text: 'late' }],
  })]
  const late = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Late', due: at(-2) }))
  const shipped = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Shipped', due: at(-2), status: 'done' }))
  assert.equal(dueEffects(board, [late, shipped], {}).length, 1)
})

test('dependencies push the things that come after them', () => {
  const board = makeBoard({ name: 'B', dependencyMode: 'push', columns: [makeColumn('dependency', 'After')] })
  const depends = board.columns[0]
  const first = makeEntity(itemDraft(board, board.groups[0].id, { title: 'First', at: at(0), end: at(4) }))
  const second = makeEntity(itemDraft(board, board.groups[0].id, {
    title: 'Second', at: at(1), end: at(3), meta: { columns: { [depends.id]: [first.id] } },
  }))
  const shifts = dependencyShifts(board, [first, second], first.id)
  assert.equal(shifts.length, 1)
  assert.equal(shifts[0].itemId, second.id)
  assert.ok(shifts[0].days >= 4)
  // With the mode off, nothing moves on its own.
  assert.equal(dependencyShifts({ ...board, dependencyMode: 'none' }, [first, second], first.id).length, 0)
})

// -------------------------------------------------------------- templates

test('every template builds a board that its own views can read', () => {
  for (const template of TEMPLATES) {
    const board = makeBoard(template.build())
    assert.ok(board.columns.length >= 2, template.id)
    for (const view of board.views) {
      for (const key of ['dimension', 'measure', 'groupBy', 'timelineColumn', 'dateColumn', 'colorBy', 'personColumn', 'effortColumn']) {
        const id = view.config[key]
        if (!id || id === 'group' || id === 'none') continue
        assert.ok(board.columns.some((c) => c.id === id), `${template.id}/${view.name}: ${key} points at a missing column`)
      }
      for (const id of view.config.fields || []) {
        assert.ok(board.columns.some((c) => c.id === id), `${template.id}/${view.name}: a form field points at a missing column`)
      }
    }
    for (const automation of board.automations) {
      for (const action of automation.actions) {
        if (action.groupId) assert.ok(board.groups.some((g) => g.id === action.groupId), `${template.id}: rule points at a missing group`)
        if (action.columnId) assert.ok(board.columns.some((c) => c.id === action.columnId), `${template.id}: rule points at a missing column`)
      }
    }
  }
})

test('a formula template computes over its own columns', () => {
  const board = makeBoard(TEMPLATES.find((t) => t.id === 'crm').build())
  const value = board.columns.find((c) => c.name === 'Deal value')
  const probability = board.columns.find((c) => c.name === 'Probability %')
  const forecast = board.columns.find((c) => c.kind === 'formula')
  const item = makeEntity(itemDraft(board, board.groups[0].id, {
    title: 'Acme', meta: { columns: { [value.id]: 20000, [probability.id]: 25 } },
  }))
  assert.equal(readCell(item, forecast, board), 5000)
})

// -------------------------------------------------------------------- csv

test('a spreadsheet becomes a board with the right column kinds', () => {
  const csv = [
    'Task,Owner,Status,Due,Budget,Notes',
    'Design homepage,Ana,In progress,2026-10-01,4200,Needs a second pass',
    'Write copy,Ben,Done,2026-09-20,900,',
    'Ship beta,Ana,Blocked,2026-10-15,15000,Waiting on legal',
  ].join('\n')
  const { board, items } = boardFromTable(toTable(parseDelimited(csv)), { name: 'Launch' })
  assert.deepEqual(board.columns.map((c) => c.kind), ['person', 'status', 'date', 'number', 'longtext'])
  assert.equal(board.columns.find((c) => c.kind === 'number').unit, '$')
  assert.equal(items.length, 3)
  assert.equal(items[1].status, 'done')
  assert.equal(items[1].meta.group, board.groups[1].id, 'a finished row lands in Done')
  assert.deepEqual(items[0].people, ['Ana'])
  const csvBack = boardToCsv(board, items.map(makeEntity))
  assert.match(csvBack, /Design homepage,Imported,Ana,In progress/)
  assert.match(csvBack, /"Waiting on legal"|Waiting on legal/)
})

test('two columns with the same header stay two columns', () => {
  const csv = ['Task,Notes,Notes', 'Ship it,first,second'].join('\n')
  const { board, items } = boardFromTable(toTable(parseDelimited(csv)), { name: 'Dupes' })
  const notes = board.columns.filter((c) => c.name === 'Notes')
  assert.equal(notes.length, 2)
  assert.notEqual(notes[0].id, notes[1].id)
  assert.equal(items[0].meta.columns[notes[0].id], 'first')
  assert.equal(items[0].meta.columns[notes[1].id], 'second')
})

test('a table with no usable rows produces no board', () => {
  assert.equal(boardFromTable({ headers: [], rows: [] }), null)
  assert.equal(boardFromTable(null), null)
})

// ------------------------------------------------------------------ shapes

test('a hand-edited workspace file cannot break a board', () => {
  const work = normaliseWork({
    boards: [
      { id: 'b1', name: 'Kept', groups: [{ id: 'g1', name: 'G' }], columns: [{ id: 'c1', kind: 'nope', name: 'Bad' }], views: [{ id: 'v1', kind: 'nope' }] },
      null,
      { name: 'No id' },
    ],
    updates: { __proto__: { polluted: true }, i1: [] },
    notifications: 'not a list',
  })
  assert.equal(work.boards.length, 2, 'a null board is dropped, a board with no id is kept')
  assert.ok(work.boards.every((b) => b.id))
  const kept = work.boards.find((b) => b.id === 'b1')
  assert.equal(kept.columns.length, 4, 'an unknown column kind falls back to the starter set')
  assert.equal(kept.views[0].kind, 'table')
  assert.deepEqual(work.notifications, [])
  assert.equal(Object.getPrototypeOf(work.updates).polluted, undefined)
  assert.equal({}.polluted, undefined)
})

test('two rows with the same name are two rows', () => {
  const board = makeBoard({ name: 'B' })
  const a = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Follow up' }))
  const b = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Follow up' }))
  assert.notEqual(a.id, b.id)
})

test('board rows are entities, so triage sees them', () => {
  const board = makeBoard({ name: 'B' })
  const late = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Overdue thing', due: at(-9) }))
  const signals = buildTriage({ [late.id]: late }, { range: { from: addDays(new Date(), -30), to: new Date(), days: 30 } })
  assert.ok(signals.some((s) => JSON.stringify(s).includes('Overdue thing')), 'an overdue board row is a triage signal')
})

test('isBlank knows what empty means for each shape', () => {
  assert.ok(isBlank('') && isBlank(null) && isBlank([]) && isBlank(false) && isBlank({ seconds: 0, running: false }))
  assert.ok(!isBlank(0 === 0) && !isBlank(['a']) && !isBlank({ seconds: 5 }))
})

test('subitems are found by their parent and only their parent', () => {
  const board = makeBoard({ name: 'B' })
  const parent = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Parent' }))
  const child = makeEntity(itemDraft(board, board.groups[0].id, { title: 'Child', meta: { parent: parent.id } }))
  assert.deepEqual(topLevel([parent, child]).map((i) => i.title), ['Parent'])
})

test('a status column keeps the label the person picked', () => {
  const board = makeBoard({
    name: 'B',
    columns: [makeColumn('status', 'Stage', {
      labels: [
        { id: 'review', text: 'In review', tone: 'accent', maps: 'doing' },
        { id: 'building', text: 'Building', tone: 'warning', maps: 'doing' },
      ],
    })],
  })
  const column = board.columns[0]
  const item = makeEntity(itemDraft(board, board.groups[0].id, { title: 'x' }))
  const patch = writeCell(item, column, 'building', board)
  const next = { ...item, ...patch, meta: { ...item.meta, ...patch.meta } }
  assert.equal(next.status, 'doing')
  assert.equal(cellValue(next, column, board), 'building', 'not the first label that also means "doing"')
})

test('the default status labels cover every entity status the app uses', () => {
  const mapped = new Set(DEFAULT_STATUS_LABELS.map((l) => l.maps))
  for (const status of ['open', 'doing', 'done', 'blocked']) assert.ok(mapped.has(status), status)
})
