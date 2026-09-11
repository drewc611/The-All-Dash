/**
 * Every write a board can make.
 *
 * The store module owns one object and one `set`; this file owns the part of
 * that object boards care about. Actions here do three things in one
 * transaction: change the item, write the activity line, and hand whatever
 * changed to the automation engine so its effects land in the same render.
 */

import { mutate, getState } from '../core/store.js'
import { makeEntity } from '../data/schema.js'
import { uid } from '../core/id.js'
import { addDays, iso } from '../core/time.js'
import { cellValue, labelOf, typeOf, writeCell } from './columns.js'
import { MAX_CHAIN, dependencyShifts, dueEffects, planEffects } from './automations.js'
import { boardColumn, itemDraft, makeBoard, makeColumn, makeGroup, makeView } from './schema.js'

const ACTIVITY_CAP = 400
const NOTIFICATION_CAP = 120

// ------------------------------------------------------------------ reads

export const boardsOf = (state) => state.work?.boards || []
export const findBoard = (state, id) => boardsOf(state).find((b) => b.id === id) || null
export const itemsOf = (state, boardId) =>
  Object.values(state.entities).filter((e) => e.meta?.board === boardId && e.type !== 'doc')
export const updatesFor = (state, itemId) => state.work?.updates?.[itemId] || []
export const activityFor = (state, boardId) => state.work?.activity?.[boardId] || []

// ----------------------------------------------------------------- boards

export function createBoard(input = {}) {
  const board = makeBoard(input)
  mutate((s) => ({ ...s, work: { ...s.work, boards: [...boardsOf(s), board] } }))
  return board
}

export function updateBoard(boardId, patch) {
  mutate((s) => withBoard(s, boardId, (board) => ({ ...board, ...patch, updatedAt: iso(new Date()) })))
}

export function removeBoard(boardId) {
  mutate((s) => {
    const entities = {}
    const dropped = new Set()
    for (const [id, entity] of Object.entries(s.entities)) {
      if (entity.meta?.board === boardId) { dropped.add(id); continue }
      entities[id] = entity
    }
    const updates = { ...s.work.updates }
    for (const id of dropped) delete updates[id]
    const activity = { ...s.work.activity }
    delete activity[boardId]
    return {
      ...s,
      entities,
      work: {
        ...s.work,
        boards: boardsOf(s).filter((b) => b.id !== boardId),
        updates,
        activity,
        notifications: s.work.notifications.filter((n) => n.boardId !== boardId),
      },
    }
  })
}

/** A copy of the shape, optionally with the rows. */
export function duplicateBoard(boardId, { withItems = false } = {}) {
  const state = getState()
  const source = findBoard(state, boardId)
  if (!source) return null
  const copy = makeBoard({ ...structuredClone(source), id: undefined, name: `${source.name} copy` })
  // Groups, columns and views keep their ids so saved view configs still point
  // at the right column; only the board and its rows are new.
  copy.groups = structuredClone(source.groups)
  copy.columns = structuredClone(source.columns)
  copy.views = structuredClone(source.views)
  copy.automations = structuredClone(source.automations)
  const rows = withItems
    ? itemsOf(state, boardId).map((item) => makeEntity({
      ...item,
      id: uid('itm'),
      createdAt: undefined,
      updatedAt: undefined,
      source: { ...item.source, docId: `board:${copy.id}`, name: copy.name },
      meta: { ...item.meta, board: copy.id, parent: null },
    }))
    : []
  mutate((s) => ({
    ...s,
    entities: { ...s.entities, ...Object.fromEntries(rows.map((r) => [r.id, r])) },
    work: { ...s.work, boards: [...boardsOf(s), copy] },
  }))
  return copy
}

const withBoard = (state, boardId, fn) => ({
  ...state,
  work: { ...state.work, boards: boardsOf(state).map((b) => (b.id === boardId ? fn(b) : b)) },
})

// ----------------------------------------------------- groups and columns

export function addGroup(boardId, name = 'New group', tone) {
  const group = makeGroup(name, tone)
  mutate((s) => withBoard(s, boardId, (b) => ({ ...b, groups: [...b.groups, group] })))
  return group
}

export function updateGroup(boardId, groupId, patch) {
  mutate((s) => withBoard(s, boardId, (b) => ({
    ...b, groups: b.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g)),
  })))
}

/** Removing a group moves its rows to the one above, never deletes them. */
export function removeGroup(boardId, groupId) {
  mutate((s) => {
    const board = findBoard(s, boardId)
    if (!board || board.groups.length < 2) return s
    const index = board.groups.findIndex((g) => g.id === groupId)
    const target = board.groups[index === 0 ? 1 : index - 1]
    const entities = { ...s.entities }
    for (const item of itemsOf(s, boardId)) {
      if (item.meta?.group !== groupId) continue
      entities[item.id] = { ...item, meta: { ...item.meta, group: target.id } }
    }
    return withBoard({ ...s, entities }, boardId, (b) => ({ ...b, groups: b.groups.filter((g) => g.id !== groupId) }))
  })
}

export function moveGroup(boardId, groupId, delta) {
  mutate((s) => withBoard(s, boardId, (b) => {
    const groups = [...b.groups]
    const index = groups.findIndex((g) => g.id === groupId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= groups.length) return b
    const [group] = groups.splice(index, 1)
    groups.splice(target, 0, group)
    return { ...b, groups }
  }))
}

export function addColumn(boardId, kind, name, settings) {
  const column = makeColumn(kind, name, settings)
  mutate((s) => withBoard(s, boardId, (b) => ({ ...b, columns: [...b.columns, column] })))
  return column
}

export function updateColumn(boardId, columnId, patch) {
  mutate((s) => withBoard(s, boardId, (b) => ({
    ...b, columns: b.columns.map((c) => (c.id === columnId ? { ...c, ...patch } : c)),
  })))
}

export function removeColumn(boardId, columnId) {
  mutate((s) => {
    const entities = { ...s.entities }
    for (const item of itemsOf(s, boardId)) {
      if (!item.meta?.columns || !Object.hasOwn(item.meta.columns, columnId)) continue
      const columns = { ...item.meta.columns }
      delete columns[columnId]
      entities[item.id] = { ...item, meta: { ...item.meta, columns } }
    }
    return withBoard({ ...s, entities }, boardId, (b) => ({
      ...b,
      columns: b.columns.filter((c) => c.id !== columnId),
      views: b.views.map((v) => ({ ...v, config: { ...v.config, filters: (v.config.filters || []).filter((f) => f.columnId !== columnId) } })),
    }))
  })
}

export function moveColumn(boardId, columnId, delta) {
  mutate((s) => withBoard(s, boardId, (b) => {
    const columns = [...b.columns]
    const index = columns.findIndex((c) => c.id === columnId)
    const target = index + delta
    if (index < 0 || target < 0 || target >= columns.length) return b
    const [column] = columns.splice(index, 1)
    columns.splice(target, 0, column)
    return { ...b, columns }
  }))
}

// ------------------------------------------------------------------ views

export function addView(boardId, kind, name, config) {
  const view = makeView(kind, name, config)
  mutate((s) => withBoard(s, boardId, (b) => ({ ...b, views: [...b.views, view] })))
  return view
}

export function updateView(boardId, viewId, patch) {
  mutate((s) => withBoard(s, boardId, (b) => ({
    ...b,
    views: b.views.map((v) => (v.id === viewId ? { ...v, ...patch, config: { ...v.config, ...(patch.config || {}) } } : v)),
  })))
}

export function removeView(boardId, viewId) {
  mutate((s) => withBoard(s, boardId, (b) => (b.views.length < 2 ? b : { ...b, views: b.views.filter((v) => v.id !== viewId) })))
}

// ------------------------------------------------------------ automations

export function addAutomation(boardId, automation) {
  mutate((s) => withBoard(s, boardId, (b) => ({ ...b, automations: [...(b.automations || []), automation] })))
  return automation
}

export function updateAutomation(boardId, automationId, patch) {
  mutate((s) => withBoard(s, boardId, (b) => ({
    ...b, automations: (b.automations || []).map((a) => (a.id === automationId ? { ...a, ...patch } : a)),
  })))
}

export function removeAutomation(boardId, automationId) {
  mutate((s) => withBoard(s, boardId, (b) => ({ ...b, automations: (b.automations || []).filter((a) => a.id !== automationId) })))
}

// ------------------------------------------------------------------ items

export function createItem(boardId, groupId, patch = {}) {
  const state = getState()
  const board = findBoard(state, boardId)
  if (!board) return null
  const siblings = itemsOf(state, boardId).filter((i) => i.meta?.group === groupId && !i.meta?.parent)
  const pos = siblings.length ? Math.max(...siblings.map((i) => i.meta?.pos ?? 0)) + 1 : 0
  const item = makeEntity(itemDraft(board, groupId, { ...patch, meta: { pos, ...(patch.meta || {}) } }))
  mutate((s) => {
    let next = { ...s, entities: { ...s.entities, [item.id]: item } }
    next = logActivity(next, boardId, item, `created ${board.itemNoun.toLowerCase()}`)
    return runEffects(next, planEffects(board, { kind: 'item-created', item }, { boards: boardsOf(s) }), 0)
  })
  return item
}

export function createItems(boardId, groupId, list) {
  const created = []
  for (const patch of list) {
    const item = createItem(boardId, groupId, patch)
    if (item) created.push(item)
  }
  return created
}

/** Write one cell, then let whatever watches that column react. */
export function setCell(itemId, columnId, value) {
  mutate((s) => {
    const item = s.entities[itemId]
    const board = item && findBoard(s, item.meta?.board)
    const column = board && boardColumn(board, columnId)
    if (!column) return s
    const patch = writeCell(item, column, value, board)
    if (!patch) return s
    return applyItemPatch(s, item, patch, board, { columnId })
  })
}

export function setItemFields(itemId, patch) {
  mutate((s) => {
    const item = s.entities[itemId]
    if (!item) return s
    const board = findBoard(s, item.meta?.board)
    if (!board) return s
    return applyItemPatch(s, item, patch, board, {})
  })
}

export function moveItem(itemId, groupId, { before = null } = {}) {
  mutate((s) => {
    const item = s.entities[itemId]
    const board = item && findBoard(s, item.meta?.board)
    if (!board) return s
    const siblings = itemsOf(s, board.id)
      .filter((i) => i.meta?.group === groupId && i.id !== itemId && !i.meta?.parent)
      .sort((a, b) => (a.meta?.pos ?? 0) - (b.meta?.pos ?? 0))
    const index = before ? siblings.findIndex((i) => i.id === before) : siblings.length
    const at = index < 0 ? siblings.length : index
    const previous = at > 0 ? siblings[at - 1].meta?.pos ?? 0 : null
    const next = at < siblings.length ? siblings[at].meta?.pos ?? 0 : null
    const pos = previous === null && next === null ? 0
      : previous === null ? next - 1
        : next === null ? previous + 1
          : (previous + next) / 2
    const moved = item.meta?.group !== groupId
    let state = applyItemPatch(s, item, { meta: { ...item.meta, group: groupId, pos } }, board, { silent: !moved })
    if (moved) {
      state = runEffects(
        state,
        planEffects(board, { kind: 'item-moves-group', item: state.entities[itemId], groupId }, { boards: boardsOf(state) }),
        0
      )
    }
    return state
  })
}

/** Same row, a different board: keep what maps, drop what does not. */
export function moveItemToBoard(itemId, targetBoardId, groupId) {
  mutate((s) => {
    const item = s.entities[itemId]
    const target = findBoard(s, targetBoardId)
    if (!item || !target) return s
    const source = findBoard(s, item.meta?.board)
    const columns = {}
    for (const column of target.columns) {
      const twin = source?.columns.find((c) => c.name.toLowerCase() === column.name.toLowerCase() && c.kind === column.kind)
      if (!twin) continue
      columns[column.id] = item.meta?.columns?.[twin.id]
    }
    const next = {
      ...item,
      source: { ...item.source, docId: `board:${target.id}`, name: target.name },
      meta: { ...item.meta, board: target.id, group: groupId || target.groups[0]?.id, columns, parent: null },
      updatedAt: iso(new Date()),
    }
    return logActivity({ ...s, entities: { ...s.entities, [itemId]: next } }, target.id, next, `moved in from ${source?.name || 'another board'}`)
  })
}

export function duplicateItem(itemId) {
  const state = getState()
  const item = state.entities[itemId]
  if (!item) return null
  const copy = makeEntity({
    ...item,
    id: uid('itm'),
    title: `${item.title} copy`,
    createdAt: undefined,
    updatedAt: undefined,
    meta: { ...item.meta, pos: (item.meta?.pos ?? 0) + 0.5 },
  })
  mutate((s) => logActivity({ ...s, entities: { ...s.entities, [copy.id]: copy } }, item.meta.board, copy, 'duplicated'))
  return copy
}

export function removeItems(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  mutate((s) => {
    const entities = { ...s.entities }
    const updates = { ...s.work.updates }
    const gone = new Set(list)
    // A subitem cannot outlive its parent.
    for (const entity of Object.values(entities)) if (gone.has(entity.meta?.parent)) gone.add(entity.id)
    for (const id of gone) { delete entities[id]; delete updates[id] }
    return { ...s, entities, work: { ...s.work, updates } }
  })
}

export function addSubitem(parentId, title) {
  const state = getState()
  const parent = state.entities[parentId]
  const board = parent && findBoard(state, parent.meta?.board)
  if (!board) return null
  return createItem(board.id, parent.meta?.group, { title, meta: { parent: parentId } })
}

// ------------------------------------------------------ updates and time

export function addUpdate(itemId, text, author) {
  const body = String(text || '').trim()
  if (!body) return null
  const entry = {
    id: uid('upd'),
    at: iso(new Date()),
    author: author || getState().work?.me || 'Me',
    text: body.slice(0, 4000),
    mentions: [...body.matchAll(/@([\w][\w.'-]{1,40})/g)].map((m) => m[1]),
    likes: 0,
  }
  mutate((s) => {
    const item = s.entities[itemId]
    const board = item && findBoard(s, item.meta?.board)
    let next = { ...s, work: { ...s.work, updates: { ...s.work.updates, [itemId]: [entry, ...(s.work.updates[itemId] || [])].slice(0, 200) } } }
    if (board) {
      next = logActivity(next, board.id, item, 'posted an update')
      for (const who of entry.mentions) {
        next = notify(next, { boardId: board.id, itemId, text: `${entry.author} mentioned @${who} on "${item.title}"` })
      }
    }
    return next
  })
  return entry
}

export function likeUpdate(itemId, updateId) {
  mutate((s) => ({
    ...s,
    work: {
      ...s.work,
      updates: {
        ...s.work.updates,
        [itemId]: (s.work.updates[itemId] || []).map((u) => (u.id === updateId ? { ...u, likes: (u.likes || 0) + 1 } : u)),
      },
    },
  }))
}

export function removeUpdate(itemId, updateId) {
  mutate((s) => ({
    ...s,
    work: { ...s.work, updates: { ...s.work.updates, [itemId]: (s.work.updates[itemId] || []).filter((u) => u.id !== updateId) } },
  }))
}

/** One timer runs at a time per cell; starting a running one stops it. */
export function toggleTimer(itemId, columnId) {
  mutate((s) => {
    const item = s.entities[itemId]
    const board = item && findBoard(s, item.meta?.board)
    const column = board && boardColumn(board, columnId)
    if (!column || column.kind !== 'time') return s
    const current = cellValue(item, column, board) || { seconds: 0, running: false, startedAt: null }
    const next = current.running && current.startedAt
      ? {
        seconds: Math.max(0, Math.round((current.seconds || 0) + (Date.now() - new Date(current.startedAt).getTime()) / 1000)),
        running: false,
        startedAt: null,
      }
      : { seconds: current.seconds || 0, running: true, startedAt: iso(new Date()) }
    const patch = writeCell(item, column, next, board)
    return applyItemPatch(s, item, patch, board, { columnId, silent: true })
  })
}

// ---------------------------------------------------------- notifications

function notify(state, { boardId, itemId, text }) {
  const entry = { id: uid('ntf'), at: iso(new Date()), boardId, itemId, text: String(text).slice(0, 300), read: false }
  return { ...state, work: { ...state.work, notifications: [entry, ...state.work.notifications].slice(0, NOTIFICATION_CAP) } }
}

export function markNotificationsRead() {
  mutate((s) => ({ ...s, work: { ...s.work, notifications: s.work.notifications.map((n) => ({ ...n, read: true })) } }))
}

export function clearNotifications() {
  mutate((s) => ({ ...s, work: { ...s.work, notifications: [] } }))
}

export function setMe(name) {
  mutate((s) => ({ ...s, work: { ...s.work, me: String(name || '').slice(0, 80) } }))
}

// --------------------------------------------------------------- internals

function logActivity(state, boardId, item, text, by) {
  if (!boardId || !item) return state
  const entry = {
    id: uid('act'),
    at: iso(new Date()),
    itemId: item.id,
    itemTitle: item.title,
    text: String(text).slice(0, 300),
    by: by || state.work?.me || 'Me',
  }
  return {
    ...state,
    work: { ...state.work, activity: { ...state.work.activity, [boardId]: [entry, ...(state.work.activity[boardId] || [])].slice(0, ACTIVITY_CAP) } },
  }
}

/**
 * The one path every item change goes through: merge the patch, describe what
 * changed for the activity log, then run whatever the change triggered.
 */
function applyItemPatch(state, item, patch, board, { columnId, silent = false, depth = 0 } = {}) {
  const merged = {
    ...item,
    ...patch,
    meta: {
      ...item.meta,
      ...(patch.meta || {}),
      columns: { ...(item.meta?.columns || {}), ...(patch.meta?.columns || {}) },
      editedByUser: true,
    },
    updatedAt: iso(new Date()),
  }
  let next = { ...state, entities: { ...state.entities, [item.id]: merged } }
  const events = eventsFor(board, item, merged, columnId)
  if (!silent) {
    for (const line of describeChanges(board, item, merged)) next = logActivity(next, board.id, merged, line)
  }
  const effects = events.flatMap((event) => planEffects(board, event, { boards: boardsOf(next) }))
  next = runEffects(next, effects, depth)
  // A dependency chain shifts dates only after the change itself has landed.
  for (const shift of dependencyShifts(board, itemsOf(next, board.id), item.id)) {
    const target = next.entities[shift.itemId]
    if (!target || !shift.days) continue
    next = {
      ...next,
      entities: {
        ...next.entities,
        [shift.itemId]: {
          ...target,
          at: target.at ? iso(addDays(target.at, shift.days)) : target.at,
          end: target.end ? iso(addDays(target.end, shift.days)) : target.end,
          due: target.due ? iso(addDays(target.due, shift.days)) : target.due,
        },
      },
    }
    next = logActivity(next, board.id, target, `dates pushed ${shift.days} days by a dependency`)
  }
  return next
}

function eventsFor(board, before, after, columnId) {
  const events = []
  for (const column of board.columns) {
    if (columnId && column.id !== columnId) continue
    const was = cellValue(before, column, board)
    const now = cellValue(after, column, board)
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue
    const valueText = typeOf(column).toText(now, column)
    events.push({ kind: 'column-changes', item: after, columnId: column.id, value: now, valueText })
    if (column.kind === 'status' || column.kind === 'priority') {
      events.push({ kind: 'status-becomes', item: after, columnId: column.id, value: now, valueText })
    }
    if (column.kind === 'person') {
      events.push({ kind: 'person-assigned', item: after, columnId: column.id, value: now, valueText })
    }
  }
  return events
}

function describeChanges(board, before, after) {
  const lines = []
  if (before.title !== after.title) lines.push(`renamed to "${after.title}"`)
  for (const column of board.columns) {
    if (typeOf(column).readOnly) continue
    const was = cellValue(before, column, board)
    const now = cellValue(after, column, board)
    if (JSON.stringify(was ?? null) === JSON.stringify(now ?? null)) continue
    const type = typeOf(column)
    const from = labelOf(column, was)?.text || type.toText(was, column)
    const to = labelOf(column, now)?.text || type.toText(now, column)
    lines.push(`${column.name}: ${from || 'empty'} → ${to || 'empty'}`)
  }
  if (before.meta?.group !== after.meta?.group) {
    lines.push(`moved to ${board.groups.find((g) => g.id === after.meta?.group)?.name || 'another group'}`)
  }
  return lines.slice(0, 6)
}

/** Apply automation effects, letting them trigger each other to a fixed depth. */
function runEffects(state, effects, depth) {
  if (!effects?.length || depth >= MAX_CHAIN) return state
  let next = state
  for (const effect of effects) {
    const board = findBoard(next, effect.boardId)
    const item = next.entities[effect.itemId]
    switch (effect.kind) {
      case 'set-cell': {
        if (!board || !item) break
        const column = boardColumn(board, effect.columnId)
        if (!column) break
        const value = effect.mode === 'add'
          ? [...new Set([...(cellValue(item, column, board) || []), ...(Array.isArray(effect.value) ? effect.value : [effect.value])])]
          : effect.value
        const patch = writeCell(item, column, value, board)
        if (patch) next = applyItemPatch(next, item, patch, board, { columnId: column.id, depth: depth + 1 })
        break
      }
      case 'move-group': {
        if (!board || !item || item.meta?.group === effect.groupId) break
        next = applyItemPatch(next, item, { meta: { ...item.meta, group: effect.groupId } }, board, { depth: depth + 1 })
        break
      }
      case 'push-dates': {
        if (!item || !effect.days) break
        next = {
          ...next,
          entities: {
            ...next.entities,
            [item.id]: {
              ...item,
              at: item.at ? iso(addDays(item.at, effect.days)) : item.at,
              end: item.end ? iso(addDays(item.end, effect.days)) : item.end,
              due: item.due ? iso(addDays(item.due, effect.days)) : item.due,
              updatedAt: iso(new Date()),
            },
          },
        }
        break
      }
      case 'notify':
        next = notify(next, { boardId: effect.boardId, itemId: effect.itemId, text: effect.text })
        break
      case 'add-update': {
        if (!effect.text) break
        const entry = { id: uid('upd'), at: iso(new Date()), author: 'Automation', text: effect.text, mentions: [], likes: 0 }
        next = {
          ...next,
          work: { ...next.work, updates: { ...next.work.updates, [effect.itemId]: [entry, ...(next.work.updates[effect.itemId] || [])].slice(0, 200) } },
        }
        break
      }
      case 'create-item': {
        const target = findBoard(next, effect.boardId || board?.id)
        if (!target) break
        const created = makeEntity(itemDraft(target, effect.groupId || target.groups[0]?.id, {
          title: effect.title,
          meta: effect.parentId ? { parent: effect.parentId } : {},
        }))
        next = { ...next, entities: { ...next.entities, [created.id]: created } }
        next = logActivity(next, target.id, created, 'created by an automation', 'Automation')
        break
      }
      case 'archive': {
        if (!item) break
        next = {
          ...next,
          entities: { ...next.entities, [item.id]: { ...item, status: 'cancelled', meta: { ...item.meta, archived: true }, updatedAt: iso(new Date()) } },
        }
        break
      }
      default:
        break
    }
    if (effect.fireKey) next = { ...next, work: { ...next.work, fired: { ...next.work.fired, [effect.fireKey]: true } } }
    if (effect.automationId && board) {
      next = withBoard(next, board.id, (b) => ({
        ...b,
        automations: (b.automations || []).map((a) => (a.id === effect.automationId ? { ...a, runs: (a.runs || 0) + 1, lastRun: iso(new Date()) } : a)),
      }))
    }
  }
  return next
}

/**
 * The minute tick: date-based rules that have come due. Keys already fired
 * today are remembered so a rule notifies once, not sixty times an hour.
 */
export function runTimedAutomations(now = new Date()) {
  mutate((s) => {
    let next = s
    let changed = false
    for (const board of boardsOf(s)) {
      if (!(board.automations || []).some((a) => a.enabled !== false)) continue
      const effects = dueEffects(board, itemsOf(next, board.id), { now, fired: next.work.fired || {} })
      if (!effects.length) continue
      changed = true
      next = runEffects(next, effects, 0)
    }
    if (!changed) return s
    // Yesterday's fire keys are dead weight; keep only today's.
    const today = iso(now).slice(0, 10)
    const fired = Object.fromEntries(Object.entries(next.work.fired || {}).filter(([key]) => key.endsWith(today)))
    return { ...next, work: { ...next.work, fired } }
  })
}
