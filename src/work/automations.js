/**
 * Automations: when this happens, do that.
 *
 * A rule is data - a trigger, some conditions and a list of actions - and this
 * module only ever *decides*. It returns a list of effects; the store is what
 * writes them. That split is what makes a rule testable without a browser, and
 * it is why a rule can never do anything the store cannot already do.
 *
 * Rules that fire rules are allowed, to a depth of three. Past that the chain
 * stops and says so, because "when Done, set Done" should not lock the tab.
 */

import { uid } from '../core/id.js'
import { iso } from '../core/time.js'
import { cellValue, labelOf } from './columns.js'
import { matchesFilter } from './query.js'
import { boardColumn } from './schema.js'

export const MAX_CHAIN = 3

export const TRIGGERS = {
  'item-created': { name: 'an item is created', needs: [] },
  'status-becomes': { name: 'a status changes to something', needs: ['column:status', 'label'] },
  'column-changes': { name: 'a column changes', needs: ['column'] },
  'person-assigned': { name: 'someone is assigned', needs: ['column:person'] },
  'item-moves-group': { name: 'an item moves to a group', needs: ['group'] },
  'date-arrives': { name: 'a date arrives', needs: ['column:date', 'offset'], timed: true },
  'item-overdue': { name: 'an item becomes overdue', needs: ['column:date'], timed: true },
}

export const ACTIONS = {
  'set-column': { name: 'set a column', needs: ['column', 'value'] },
  'move-to-group': { name: 'move it to a group', needs: ['group'] },
  'assign': { name: 'assign someone', needs: ['column:person', 'person'] },
  'notify': { name: 'notify me', needs: ['text'] },
  'add-update': { name: 'post an update', needs: ['text'] },
  'create-subitem': { name: 'create a subitem', needs: ['text'] },
  'create-item': { name: 'create an item on a board', needs: ['board', 'group', 'text'] },
  'push-dates': { name: 'push its dates', needs: ['days'] },
  'archive': { name: 'archive it', needs: [] },
}

export function makeAutomation(input = {}) {
  return {
    id: input.id || uid('aut'),
    name: input.name || '',
    enabled: input.enabled !== false,
    trigger: input.trigger || { kind: 'item-created' },
    conditions: Array.isArray(input.conditions) ? input.conditions : [],
    actions: Array.isArray(input.actions) && input.actions.length ? input.actions : [{ kind: 'notify', text: '{item} changed' }],
    lastRun: input.lastRun || null,
    runs: Number(input.runs) || 0,
  }
}

/** The English sentence shown in the automations list. */
export function describeAutomation(board, automation, boards = []) {
  const trigger = TRIGGERS[automation.trigger?.kind]
  const when = (() => {
    const t = automation.trigger || {}
    const column = boardColumn(board, t.columnId)
    switch (t.kind) {
      case 'status-becomes': return `${column?.name || 'Status'} becomes ${labelOf(column, t.value)?.text || 'something'}`
      case 'column-changes': return `${column?.name || 'a column'} changes`
      case 'person-assigned': return `someone is assigned in ${column?.name || 'People'}`
      case 'item-moves-group': return `an item moves to ${board.groups.find((g) => g.id === t.groupId)?.name || 'a group'}`
      case 'date-arrives': return offsetPhrase(t.offset, column?.name || 'Date')
      case 'item-overdue': return `${column?.name || 'Date'} passes and the item is not done`
      default: return trigger?.name || 'something happens'
    }
  })()
  const then = (automation.actions || []).map((a) => describeAction(board, a, boards)).join(', then ')
  const ifs = (automation.conditions || []).length
    ? ` (only if ${automation.conditions.map((c) => `${boardColumn(board, c.columnId)?.name || 'a column'} ${c.op.replace('-', ' ')}${c.value ? ` ${labelOf(boardColumn(board, c.columnId), c.value)?.text || c.value}` : ''}`).join(' and ')})`
    : ''
  return `When ${when}${ifs}, ${then || 'do nothing'}.`
}

function describeAction(board, action, boards) {
  const column = boardColumn(board, action.columnId)
  switch (action.kind) {
    case 'set-column': return `set ${column?.name || 'a column'} to ${labelOf(column, action.value)?.text || action.value || 'empty'}`
    case 'move-to-group': return `move it to ${board.groups.find((g) => g.id === action.groupId)?.name || 'a group'}`
    case 'assign': return `assign ${action.person || 'someone'}`
    case 'notify': return `notify me: "${action.text || ''}"`
    case 'add-update': return `post an update`
    case 'create-subitem': return `create a subitem "${action.text || ''}"`
    case 'create-item': return `create an item on ${boards.find((b) => b.id === action.boardId)?.name || 'a board'}`
    case 'push-dates': return `push its dates by ${action.days || 0} days`
    case 'archive': return 'archive it'
    default: return action.kind
  }
}

const offsetPhrase = (offset, name) => {
  const days = Number(offset) || 0
  if (days === 0) return `${name} arrives`
  if (days < 0) return `${name} is ${Math.abs(days)} days away`
  return `${name} was ${days} days ago`
}

// --------------------------------------------------------------- matching

function triggerMatches(automation, event, board) {
  const trigger = automation.trigger || {}
  if (trigger.kind !== event.kind) return false
  switch (trigger.kind) {
    case 'item-created':
      return true
    case 'status-becomes': {
      if (trigger.columnId && event.columnId && trigger.columnId !== event.columnId) return false
      return !trigger.value || String(event.value) === String(trigger.value)
    }
    case 'column-changes':
      return !trigger.columnId || trigger.columnId === event.columnId
    case 'person-assigned':
      return (!trigger.columnId || trigger.columnId === event.columnId) && (event.value || []).length > 0
    case 'item-moves-group':
      return !trigger.groupId || trigger.groupId === event.groupId
    case 'date-arrives':
    case 'item-overdue':
      return !trigger.columnId || trigger.columnId === event.columnId
    default:
      return false
  }
}

const conditionsHold = (automation, item, board) =>
  (automation.conditions || []).every((condition) => matchesFilter(item, condition, board))

/**
 * The effects one event produces. Each effect is a plain object the store
 * knows how to apply; nothing here touches state.
 */
export function planEffects(board, event, { boards = [], now = new Date() } = {}) {
  const effects = []
  for (const automation of board.automations || []) {
    if (automation.enabled === false) continue
    if (!triggerMatches(automation, event, board)) continue
    if (!conditionsHold(automation, event.item, board)) continue
    for (const action of automation.actions || []) {
      const effect = actionEffect(board, automation, action, event, { boards, now })
      if (effect) effects.push(effect)
    }
  }
  return effects
}

function actionEffect(board, automation, action, event, { boards, now }) {
  const item = event.item
  const base = { automationId: automation.id, boardId: board.id, itemId: item.id }
  switch (action.kind) {
    case 'set-column': {
      const column = boardColumn(board, action.columnId)
      if (!column) return null
      return { ...base, kind: 'set-cell', columnId: column.id, value: action.value }
    }
    case 'move-to-group':
      return action.groupId ? { ...base, kind: 'move-group', groupId: action.groupId } : null
    case 'assign': {
      const column = boardColumn(board, action.columnId) || board.columns.find((c) => c.kind === 'person')
      if (!column || !action.person) return null
      return { ...base, kind: 'set-cell', columnId: column.id, value: [action.person], mode: 'add' }
    }
    case 'notify':
      return { ...base, kind: 'notify', text: fill(action.text || '{item}', board, item, event) }
    case 'add-update':
      return { ...base, kind: 'add-update', text: fill(action.text || '', board, item, event) }
    case 'create-subitem':
      return { ...base, kind: 'create-item', parentId: item.id, groupId: item.meta?.group, title: fill(action.text || 'Follow up', board, item, event) }
    case 'create-item':
      return { ...base, kind: 'create-item', boardId: action.boardId || board.id, groupId: action.groupId, title: fill(action.text || 'New item', board, item, event) }
    case 'push-dates':
      return { ...base, kind: 'push-dates', days: Number(action.days) || 0 }
    case 'archive':
      return { ...base, kind: 'archive' }
    default:
      return null
  }
}

function fill(template, board, item, event) {
  const value = event.valueText ?? (Array.isArray(event.value) ? event.value.join(', ') : event.value ?? '')
  return String(template)
    .replace(/\{item\}/g, item.title)
    .replace(/\{board\}/g, board.name)
    .replace(/\{value\}/g, String(value))
    .replace(/\{group\}/g, board.groups.find((g) => g.id === item.meta?.group)?.name || '')
    .replace(/\{people\}/g, (item.people || []).join(', '))
    .slice(0, 400)
}

/**
 * Time-based rules. Called on the app's minute tick with everything on the
 * board; `lastRun` per automation keeps a date-arrives rule from firing twice
 * for the same item on the same day.
 */
export function dueEffects(board, items, { now = new Date(), fired = {} } = {}) {
  const effects = []
  for (const automation of board.automations || []) {
    if (automation.enabled === false) continue
    const trigger = automation.trigger || {}
    if (!TRIGGERS[trigger.kind]?.timed) continue
    const column = boardColumn(board, trigger.columnId) || board.columns.find((c) => c.kind === 'date')
    if (!column) continue
    for (const item of items) {
      const raw = cellValue(item, column, board)
      const at = Date.parse(typeof raw === 'object' && raw?.from ? raw.from : raw)
      if (!Number.isFinite(at)) continue
      const offset = (Number(trigger.offset) || 0) * 86400000
      if (trigger.kind === 'date-arrives' && !sameDay(at + offset, now)) continue
      if (trigger.kind === 'item-overdue' && !(at < now.getTime() && item.status !== 'done' && item.status !== 'cancelled')) continue
      const key = `${automation.id}:${item.id}:${dayStamp(now)}`
      if (fired[key]) continue
      if (!conditionsHold(automation, item, board)) continue
      for (const action of automation.actions || []) {
        const effect = actionEffect(board, automation, action, { kind: trigger.kind, item, columnId: column.id }, { boards: [], now })
        if (effect) effects.push({ ...effect, fireKey: key })
      }
    }
  }
  return effects
}

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString()
const dayStamp = (d) => iso(d).slice(0, 10)

/** The starter rules offered on a new board, and in the "add automation" list. */
export function recipeCatalogue(board) {
  const status = board.columns.find((c) => c.kind === 'status')
  const person = board.columns.find((c) => c.kind === 'person')
  const date = board.columns.find((c) => c.kind === 'date')
  const doneLabel = status?.labels?.find((l) => l.maps === 'done')
  const done = board.groups.find((g) => /done|complete|shipped/i.test(g.name)) || board.groups.at(-1)
  const recipes = []
  if (status && doneLabel && done) {
    recipes.push({
      id: 'done-to-group',
      title: `When ${status.name} becomes ${doneLabel.text}, move the item to ${done.name}`,
      build: () => makeAutomation({
        trigger: { kind: 'status-becomes', columnId: status.id, value: doneLabel.id },
        actions: [{ kind: 'move-to-group', groupId: done.id }],
      }),
    })
  }
  if (status) {
    const stuck = status.labels?.find((l) => l.maps === 'blocked')
    if (stuck) {
      recipes.push({
        id: 'stuck-notify',
        title: `When ${status.name} becomes ${stuck.text}, notify me`,
        build: () => makeAutomation({
          trigger: { kind: 'status-becomes', columnId: status.id, value: stuck.id },
          actions: [{ kind: 'notify', text: '{item} is stuck' }],
        }),
      })
    }
  }
  if (date) {
    recipes.push({
      id: 'due-tomorrow',
      title: `The day before ${date.name}, notify me`,
      build: () => makeAutomation({
        trigger: { kind: 'date-arrives', columnId: date.id, offset: -1 },
        actions: [{ kind: 'notify', text: '{item} is due tomorrow' }],
      }),
    })
    recipes.push({
      id: 'overdue',
      title: `When ${date.name} passes and the item is not done, notify me`,
      build: () => makeAutomation({
        trigger: { kind: 'item-overdue', columnId: date.id },
        actions: [{ kind: 'notify', text: '{item} is overdue' }],
      }),
    })
  }
  if (person) {
    recipes.push({
      id: 'assigned-update',
      title: 'When someone is assigned, post an update saying so',
      build: () => makeAutomation({
        trigger: { kind: 'person-assigned', columnId: person.id },
        actions: [{ kind: 'add-update', text: 'Assigned to {value}' }],
      }),
    })
  }
  recipes.push({
    id: 'new-item-notify',
    title: 'When an item is created, notify me',
    build: () => makeAutomation({ trigger: { kind: 'item-created' }, actions: [{ kind: 'notify', text: 'New item: {item}' }] }),
  })
  return recipes
}

/**
 * Dependency mode: when a predecessor's end moves, the items that depend on it
 * follow. Returns date patches, so it is the same kind of decision as a rule.
 */
export function dependencyShifts(board, items, changedId) {
  const column = board.columns.find((c) => c.kind === 'dependency')
  if (!column || board.dependencyMode !== 'push') return []
  const byId = new Map(items.map((i) => [i.id, i]))
  const shifts = []
  const seen = new Set()
  const walk = (id, depth) => {
    if (depth > 10 || seen.has(id)) return
    seen.add(id)
    const predecessor = byId.get(id)
    const end = Date.parse(predecessor?.end || predecessor?.due || predecessor?.at || '')
    if (!Number.isFinite(end)) return
    for (const item of items) {
      const deps = cellValue(item, column, board) || []
      if (!deps.includes(id)) continue
      const start = Date.parse(item.at || item.due || '')
      if (!Number.isFinite(start) || start > end) continue
      const move = end - start + 86400000
      shifts.push({ itemId: item.id, days: Math.ceil(move / 86400000) })
      walk(item.id, depth + 1)
    }
  }
  walk(changedId, 0)
  return shifts
}
