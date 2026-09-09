/**
 * Boards, groups, views and items.
 *
 * A board is a shape: which columns exist, how rows are grouped, which views
 * are saved on it and which automations watch it. The rows themselves are
 * plain Entities in the one entity map, tagged with `meta.board`. That is the
 * whole trick - a board item is a task, so it already shows up in triage, in
 * reminders, on the timeline, in the brain and in every export, and none of
 * those had to learn what a board is.
 */

import { uid } from '../core/id.js'
import { iso } from '../core/time.js'
import { COLUMN_TYPES, DEFAULT_STATUS_LABELS, PRIORITY_LABELS, typeOf } from './columns.js'

export const VIEW_KINDS = {
  table: { name: 'Table', hint: 'Rows and columns, grouped' },
  kanban: { name: 'Kanban', hint: 'One lane per status' },
  timeline: { name: 'Timeline', hint: 'Bars across a date range' },
  calendar: { name: 'Calendar', hint: 'A month at a time' },
  chart: { name: 'Chart', hint: 'Count or sum, broken down' },
  workload: { name: 'Workload', hint: 'Who is carrying what, by week' },
  form: { name: 'Form', hint: 'A fillable form that adds items' },
}

export const BOARD_TONES = ['accent', 'good', 'warning', 'serious', 'critical', 'neutral']

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

export function makeColumn(kind, name, settings = {}) {
  const type = COLUMN_TYPES[kind] || COLUMN_TYPES.text
  return {
    id: settings.id || uid('col'),
    kind: COLUMN_TYPES[kind] ? kind : 'text',
    name: String(name || type.name).slice(0, 60),
    width: settings.width || type.width || 160,
    ...structuredClone(type.settings || {}),
    ...omit(settings, ['id']),
  }
}

export function makeGroup(name, tone = 'accent') {
  return { id: uid('grp'), name: String(name || 'New group').slice(0, 60), tone, collapsed: false }
}

export function makeView(kind, name, config = {}) {
  return {
    id: uid('view'),
    kind: VIEW_KINDS[kind] ? kind : 'table',
    name: String(name || VIEW_KINDS[kind]?.name || 'View').slice(0, 60),
    config: { filters: [], sort: null, groupBy: 'group', hidden: [], ...config },
  }
}

/** The columns every board starts with; a template may replace them. */
const starterColumns = () => [
  makeColumn('person', 'Owner'),
  makeColumn('status', 'Status', { labels: structuredClone(DEFAULT_STATUS_LABELS) }),
  makeColumn('date', 'Due'),
  makeColumn('priority', 'Priority', { labels: structuredClone(PRIORITY_LABELS) }),
]

export function makeBoard(input = {}) {
  const now = iso(new Date())
  const columns = (input.columns || starterColumns()).map((c) => (c.id ? c : makeColumn(c.kind, c.name, c)))
  const groups = (input.groups || [makeGroup('This week'), makeGroup('Next up', 'good'), makeGroup('Someday', 'neutral')])
    .map((g) => (g.id ? g : makeGroup(g.name, g.tone)))
  const views = (input.views || [makeView('table', 'Main table')]).map((v) => (v.id ? v : makeView(v.kind, v.name, v.config)))
  return {
    id: input.id || uid('brd'),
    name: String(input.name || 'New board').slice(0, 80),
    description: String(input.description || '').slice(0, 400),
    tone: BOARD_TONES.includes(input.tone) ? input.tone : 'accent',
    itemType: input.itemType || 'task',
    itemNoun: String(input.itemNoun || 'Item').slice(0, 24),
    groups,
    columns,
    views,
    automations: input.automations || [],
    dependencyMode: input.dependencyMode || 'none',
    archived: false,
    createdAt: input.createdAt || now,
    updatedAt: now,
  }
}

/** The starting entity for a new row on a board. */
export function itemDraft(board, groupId, patch = {}) {
  const group = board.groups.find((g) => g.id === groupId) || board.groups[0]
  const columns = {}
  for (const column of board.columns) {
    const type = typeOf(column)
    if (type.field || type.readOnly) continue
    columns[column.id] = type.blank(column)
  }
  return {
    // Board rows get an explicit id: two rows may legitimately share a title,
    // and the content hash makeEntity() would otherwise derive collides.
    id: patch.id || uid('itm'),
    type: board.itemType || 'task',
    title: patch.title || `New ${(board.itemNoun || 'item').toLowerCase()}`,
    status: board.itemType === 'task' ? 'open' : null,
    tags: [],
    people: [],
    ...omit(patch, ['meta', 'id']),
    source: { docId: `board:${board.id}`, name: board.name, kind: 'board' },
    meta: {
      board: board.id,
      group: group?.id || null,
      pos: Date.now(),
      columns,
      editedByUser: true,
      ...(patch.meta || {}),
    },
  }
}

export const isBoardItem = (entity, boardId) =>
  !!entity?.meta?.board && (!boardId || entity.meta.board === boardId) && entity.type !== 'doc'

export const boardColumn = (board, id) => board?.columns?.find((c) => c.id === id) || null

export const columnOfKind = (board, kind) => board?.columns?.find((c) => c.kind === kind) || null

/** The column a view should use for a role, honouring an explicit choice. */
export function pickColumn(board, kind, preferred) {
  const explicit = preferred && boardColumn(board, preferred)
  if (explicit && explicit.kind === kind) return explicit
  return columnOfKind(board, kind)
}

export function groupOf(board, item) {
  const id = item?.meta?.group
  return board.groups.find((g) => g.id === id) || board.groups[0] || null
}

/** Sort key inside a group: the drag position, then creation order. */
export const itemOrder = (a, b) => (a.meta?.pos ?? 0) - (b.meta?.pos ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt))

export const subitemsOf = (items, parentId) => items.filter((i) => i.meta?.parent === parentId).sort(itemOrder)

export const topLevel = (items) => items.filter((i) => !i.meta?.parent)

/** Repair anything a hand-edited or older workspace file might be missing. */
export function normaliseWork(work) {
  const base = { boards: [], updates: {}, activity: {}, notifications: [], fired: {}, me: '' }
  if (!work || typeof work !== 'object') return base
  const boards = Array.isArray(work.boards) ? work.boards.filter(Boolean).map(repairBoard) : []
  return {
    boards,
    updates: plain(work.updates),
    activity: plain(work.activity),
    notifications: Array.isArray(work.notifications) ? work.notifications.slice(0, 200) : [],
    fired: plain(work.fired),
    me: typeof work.me === 'string' ? work.me.slice(0, 80) : '',
  }
}

function repairBoard(raw) {
  const board = makeBoard({ ...raw, id: raw.id || uid('brd') })
  board.createdAt = raw.createdAt || board.createdAt
  board.archived = raw.archived === true
  // makeBoard would hand back fresh ids for a board that already has some.
  board.groups = (Array.isArray(raw.groups) && raw.groups.length ? raw.groups : board.groups)
    .filter((g) => g && g.id)
    .map((g) => ({ id: g.id, name: String(g.name || 'Group').slice(0, 60), tone: g.tone || 'accent', collapsed: !!g.collapsed }))
  const columns = (Array.isArray(raw.columns) && raw.columns.length ? raw.columns : board.columns)
    .filter((c) => c && c.id && COLUMN_TYPES[c.kind])
  // A board with no columns is unusable, so a file whose columns were all
  // unreadable gets the starter set rather than an empty grid.
  board.columns = columns.length ? columns : starterColumns()
  board.views = (Array.isArray(raw.views) && raw.views.length ? raw.views : board.views)
    .filter((v) => v && v.id && VIEW_KINDS[v.kind])
    .map((v) => ({ ...v, config: { filters: [], sort: null, groupBy: 'group', hidden: [], ...(v.config || {}) } }))
  board.automations = (Array.isArray(raw.automations) ? raw.automations : []).filter((a) => a && a.id && a.trigger)
  if (!board.groups.length) board.groups = [makeGroup('Items')]
  if (!board.views.length) board.views = [makeView('table', 'Main table')]
  return board
}

const plain = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = Object.create(null)
  for (const [k, v] of Object.entries(value)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    out[k] = v
  }
  return { ...out }
}

function omit(object, keys) {
  const out = {}
  for (const [k, v] of Object.entries(object || {})) if (!keys.includes(k)) out[k] = v
  return out
}
