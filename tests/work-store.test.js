import test from 'node:test'
import assert from 'node:assert/strict'

import { getState } from '../src/core/store.js'
import {
  activityFor, addAutomation, addSubitem, addUpdate, createBoard, createItem, duplicateBoard,
  findBoard, itemsOf, moveItem, moveItemToBoard, removeBoard, removeGroup, removeItems,
  runTimedAutomations, setCell, toggleTimer, updatesFor,
} from '../src/work/store.js'
import { makeAutomation } from '../src/work/automations.js'
import { makeColumn } from '../src/work/schema.js'
import { cellValue, elapsed } from '../src/work/columns.js'
import { TEMPLATES } from '../src/work/templates.js'
import { addDays, iso } from '../src/core/time.js'

/**
 * The store is a singleton, so each test builds its own board and cleans up
 * after itself rather than resetting shared state out from under the others.
 */
const withBoard = (input, run) => {
  const board = createBoard(input)
  try {
    return run(findBoard(getState(), board.id))
  } finally {
    removeBoard(board.id)
  }
}

test('a rule that fires on a status change lands in the same transaction', () => {
  withBoard(TEMPLATES.find((t) => t.id === 'projects').build(), (board) => {
    const status = board.columns.find((c) => c.kind === 'status')
    const progress = board.columns.find((c) => c.kind === 'progress')
    const done = board.groups.at(-1)
    const item = createItem(board.id, board.groups[0].id, { title: 'Wire it up' })
    setCell(item.id, status.id, 'done')
    const after = getState().entities[item.id]
    assert.equal(after.status, 'done')
    assert.equal(after.meta.group, done.id, 'the rule moved it to Done')
    assert.equal(cellValue(after, progress, board), 100, 'and set progress')
    const log = activityFor(getState(), board.id).map((a) => a.text)
    assert.ok(log.some((line) => line.startsWith('Status:')), log.join(' | '))
    assert.ok(log.includes('created task'))
  })
})

test('a rule that undoes itself stops instead of looping', () => {
  withBoard({ name: 'Loop' }, (board) => {
    const status = board.columns.find((c) => c.kind === 'status')
    addAutomation(board.id, makeAutomation({
      trigger: { kind: 'status-becomes', columnId: status.id, value: 'done' },
      actions: [{ kind: 'set-column', columnId: status.id, value: 'not-started' }],
    }))
    addAutomation(board.id, makeAutomation({
      trigger: { kind: 'status-becomes', columnId: status.id, value: 'not-started' },
      actions: [{ kind: 'set-column', columnId: status.id, value: 'done' }],
    }))
    const item = createItem(board.id, board.groups[0].id, { title: 'Ping pong' })
    setCell(item.id, status.id, 'done')
    // It settles at one of the two, and the tab is still responsive.
    assert.ok(['open', 'done'].includes(getState().entities[item.id].status))
  })
})

test('an @mention in an update becomes a notification', () => {
  withBoard({ name: 'Chat' }, (board) => {
    const before = getState().work.notifications.length
    const item = createItem(board.id, board.groups[0].id, { title: 'Talk about it' })
    addUpdate(item.id, 'Handing this to @ben, shout if it is wrong')
    const updates = updatesFor(getState(), item.id)
    assert.equal(updates.length, 1)
    assert.deepEqual(updates[0].mentions, ['ben'])
    assert.equal(getState().work.notifications.length, before + 1)
    assert.match(getState().work.notifications[0].text, /@ben/)
  })
})

test('deleting an item takes its subitems with it', () => {
  withBoard({ name: 'Nesting' }, (board) => {
    const parent = createItem(board.id, board.groups[0].id, { title: 'Parent' })
    const child = addSubitem(parent.id, 'Child')
    const orphanKeeper = createItem(board.id, board.groups[0].id, { title: 'Unrelated' })
    removeItems(parent.id)
    const ids = itemsOf(getState(), board.id).map((i) => i.id)
    assert.ok(!ids.includes(parent.id))
    assert.ok(!ids.includes(child.id), 'the subitem went too')
    assert.ok(ids.includes(orphanKeeper.id))
  })
})

test('deleting a group keeps its rows, deleting a board does not', () => {
  const board = createBoard({ name: 'Cleanup' })
  const item = createItem(board.id, board.groups[1].id, { title: 'Survivor' })
  removeGroup(board.id, board.groups[1].id)
  assert.equal(getState().entities[item.id].meta.group, board.groups[0].id)
  addUpdate(item.id, 'note')
  removeBoard(board.id)
  assert.equal(getState().entities[item.id], undefined)
  assert.deepEqual(updatesFor(getState(), item.id), [])
  assert.equal(findBoard(getState(), board.id), null)
})

test('moving a row between two rows lands between them', () => {
  withBoard({ name: 'Order' }, (board) => {
    const group = board.groups[0].id
    const a = createItem(board.id, group, { title: 'A' })
    const b = createItem(board.id, group, { title: 'B' })
    const c = createItem(board.id, group, { title: 'C' })
    moveItem(c.id, group, { before: b.id })
    const order = itemsOf(getState(), board.id)
      .sort((x, y) => (x.meta.pos ?? 0) - (y.meta.pos ?? 0))
      .map((i) => i.title)
    assert.deepEqual(order, ['A', 'C', 'B'])
    assert.equal(getState().entities[a.id].meta.group, group)
  })
})

test('a timer accumulates while it runs and stops where it stopped', () => {
  withBoard({ name: 'Timing', columns: [makeColumn('time', 'Time')] }, (board) => {
    const column = board.columns[0]
    const item = createItem(board.id, board.groups[0].id, { title: 'Billable' })
    toggleTimer(item.id, column.id)
    assert.equal(cellValue(getState().entities[item.id], column, board).running, true)
    toggleTimer(item.id, column.id)
    const stopped = cellValue(getState().entities[item.id], column, board)
    assert.equal(stopped.running, false)
    assert.equal(stopped.startedAt, null)
    assert.ok(elapsed(stopped) >= 0)
  })
})

test('a date rule fires once, however often the clock ticks', () => {
  withBoard({ name: 'Reminders' }, (board) => {
    const date = board.columns.find((c) => c.kind === 'date')
    addAutomation(board.id, makeAutomation({
      trigger: { kind: 'date-arrives', columnId: date.id, offset: 0 },
      actions: [{ kind: 'notify', text: '{item} is due today' }],
    }))
    createItem(board.id, board.groups[0].id, { title: 'Renewal', due: iso(new Date()) })
    const before = getState().work.notifications.length
    runTimedAutomations()
    const after = getState().work.notifications.length
    assert.equal(after, before + 1)
    runTimedAutomations()
    runTimedAutomations()
    assert.equal(getState().work.notifications.length, after, 'the same rule does not fire again today')
  })
})

test('moving a row to another board keeps the columns both boards share', () => {
  const from = createBoard({ name: 'From', columns: [makeColumn('number', 'Points'), makeColumn('text', 'Only here')] })
  const to = createBoard({ name: 'To', columns: [makeColumn('number', 'Points')] })
  try {
    const points = from.columns[0]
    const item = createItem(from.id, from.groups[0].id, { title: 'Travelling' })
    setCell(item.id, points.id, 8)
    moveItemToBoard(item.id, to.id, to.groups[0].id)
    const moved = getState().entities[item.id]
    assert.equal(moved.meta.board, to.id)
    assert.equal(cellValue(moved, to.columns[0], to), 8, 'Points came across by name and kind')
    assert.equal(itemsOf(getState(), from.id).length, 0)
  } finally {
    removeBoard(from.id)
    removeBoard(to.id)
  }
})

test('duplicating a board with its rows copies the rows, not their ids', () => {
  const board = createBoard({ name: 'Original' })
  const item = createItem(board.id, board.groups[0].id, { title: 'Row one' })
  const copy = duplicateBoard(board.id, { withItems: true })
  try {
    assert.equal(copy.name, 'Original copy')
    const rows = itemsOf(getState(), copy.id)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, 'Row one')
    assert.notEqual(rows[0].id, item.id)
    assert.equal(rows[0].meta.board, copy.id)
  } finally {
    removeBoard(board.id)
    removeBoard(copy.id)
  }
})

test('an overdue board row is still a task everywhere else', () => {
  withBoard({ name: 'Crossover' }, (board) => {
    const item = createItem(board.id, board.groups[0].id, { title: 'Late one', due: iso(addDays(new Date(), -4)) })
    const entity = getState().entities[item.id]
    assert.equal(entity.type, 'task')
    assert.equal(entity.source.kind, 'board')
    assert.ok(new Date(entity.due) < new Date())
  })
})
