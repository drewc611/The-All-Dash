/**
 * Column types.
 *
 * A board column is a small object: a kind, a name and whatever settings that
 * kind needs. Everything the rest of the app does with a cell - render it,
 * sort by it, filter on it, roll it up into a footer summary, write it to CSV -
 * comes from the table below, so adding a kind is one entry here and one
 * editor in ui/work/cells.jsx.
 *
 * Some kinds bind to a native Entity field (`field`). A status column *is* the
 * entity's status, a people column *is* its people. That binding is what makes
 * board items show up in triage, reminders, the timeline and the brain without
 * any of those knowing boards exist.
 */

import { formatDate } from '../core/time.js'
import { format } from '../core/format.js'
import { compileFormula } from './formula.js'

const text = (v) => (v === null || v === undefined ? '' : String(v))
const number = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const list = (v) => {
  const raw = Array.isArray(v) ? v.map(text) : text(v).split(',')
  const seen = new Set()
  const out = []
  for (const entry of raw) {
    const value = entry.trim()
    if (!value || seen.has(value.toLowerCase())) continue
    seen.add(value.toLowerCase())
    out.push(value)
  }
  return out
}
const isoDay = (v) => {
  if (!v) return null
  const date = new Date(v)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

export const LABEL_TONES = ['neutral', 'accent', 'good', 'warning', 'serious', 'critical']

export const DEFAULT_STATUS_LABELS = [
  { id: 'not-started', text: 'Not started', tone: 'neutral', maps: 'open' },
  { id: 'working', text: 'Working on it', tone: 'warning', maps: 'doing' },
  { id: 'stuck', text: 'Stuck', tone: 'critical', maps: 'blocked' },
  { id: 'done', text: 'Done', tone: 'good', maps: 'done' },
]

export const PRIORITY_LABELS = [
  { id: 'low', text: 'Low', tone: 'neutral', value: 0 },
  { id: 'medium', text: 'Medium', tone: 'accent', value: 0 },
  { id: 'high', text: 'High', tone: 'warning', value: 1 },
  { id: 'critical', text: 'Critical', tone: 'critical', value: 2 },
]

/** @type {Record<string, object>} */
export const COLUMN_TYPES = {
  text: {
    name: 'Text', group: 'Basics', width: 180,
    blank: () => '', coerce: (v) => text(v).slice(0, 2000),
    toText: text, fromText: text, sortKey: (v) => text(v).toLowerCase(),
    summaries: ['filled', 'empty'],
  },
  longtext: {
    name: 'Long text', group: 'Basics', width: 240,
    blank: () => '', coerce: (v) => text(v).slice(0, 20000),
    toText: text, fromText: text, sortKey: (v) => text(v).toLowerCase(),
    summaries: ['filled', 'empty'],
  },
  status: {
    name: 'Status', group: 'Basics', field: 'status', width: 150,
    settings: { labels: DEFAULT_STATUS_LABELS },
    blank: (col) => col.labels?.[0]?.id || '',
    coerce: (v, col) => {
      const id = text(v)
      const labels = col.labels || DEFAULT_STATUS_LABELS
      const found = labels.find((l) => l.id === id) || labels.find((l) => l.text.toLowerCase() === id.toLowerCase())
      return found ? found.id : ''
    },
    toText: (v, col) => labelOf(col, v)?.text || '',
    fromText: (t, col) => {
      const labels = col.labels || DEFAULT_STATUS_LABELS
      const found = labels.find((l) => l.text.toLowerCase() === text(t).trim().toLowerCase())
      return found ? found.id : ''
    },
    sortKey: (v, col) => (col.labels || DEFAULT_STATUS_LABELS).findIndex((l) => l.id === v),
    summaries: ['breakdown', 'percent-done'],
  },
  dropdown: {
    name: 'Dropdown', group: 'Basics', width: 170,
    settings: { labels: [], multi: true },
    blank: () => [],
    coerce: (v, col) => {
      const ids = list(v)
      const allowed = new Set((col.labels || []).map((l) => l.id))
      const kept = ids.filter((id) => allowed.has(id))
      return col.multi === false ? kept.slice(0, 1) : kept.slice(0, 12)
    },
    toText: (v, col) => list(v).map((id) => labelOf(col, id)?.text || '').filter(Boolean).join(', '),
    fromText: (t, col) => text(t).split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      .map((s) => (col.labels || []).find((l) => l.text.toLowerCase() === s.toLowerCase())?.id).filter(Boolean),
    sortKey: (v, col) => list(v).map((id) => labelOf(col, id)?.text || '').join(', ').toLowerCase(),
    summaries: ['breakdown'],
  },
  person: {
    name: 'People', group: 'Basics', field: 'people', width: 170,
    blank: () => [], coerce: (v) => list(v).slice(0, 12),
    toText: (v) => list(v).join(', '), fromText: (t) => list(t),
    sortKey: (v) => list(v).join(', ').toLowerCase(),
    summaries: ['breakdown', 'unique'],
  },
  date: {
    name: 'Date', group: 'Dates', field: 'due', width: 140,
    settings: { withTime: false },
    blank: () => null, coerce: (v) => isoDay(v),
    toText: (v) => (v ? formatDate(v, { year: 'numeric' }) : ''), fromText: (t) => isoDay(t),
    sortKey: (v) => (v ? new Date(v).getTime() : null),
    summaries: ['earliest', 'latest', 'overdue'],
  },
  timeline: {
    name: 'Timeline', group: 'Dates', field: 'timeline', width: 190,
    blank: () => null,
    coerce: (v) => {
      if (!v || typeof v !== 'object') return null
      const from = isoDay(v.from)
      const to = isoDay(v.to)
      if (!from && !to) return null
      return { from: from || to, to: to || from }
    },
    toText: (v) => (v ? `${formatDate(v.from)} - ${formatDate(v.to)}` : ''),
    fromText: (t) => {
      const [from, to] = text(t).split(/\s*(?:-|to|–|—)\s*/)
      const range = { from: isoDay(from), to: isoDay(to || from) }
      return range.from ? range : null
    },
    sortKey: (v) => (v?.from ? new Date(v.from).getTime() : null),
    summaries: ['span', 'earliest', 'latest'],
  },
  number: {
    name: 'Number', group: 'Numbers', width: 120,
    settings: { unit: '', decimals: 2 },
    blank: () => null, coerce: (v) => number(v),
    toText: (v, col) => (v === null ? '' : format(v, col.unit || '')),
    fromText: (t) => number(text(t).replace(/[^0-9.eE+-]/g, '')),
    sortKey: (v) => v,
    summaries: ['sum', 'avg', 'min', 'max', 'median'],
  },
  rating: {
    name: 'Rating', group: 'Numbers', width: 120,
    settings: { max: 5 },
    blank: () => 0,
    coerce: (v, col) => Math.max(0, Math.min(col.max || 5, Math.round(number(v) || 0))),
    toText: (v) => (v ? String(v) : ''), fromText: (t) => Math.round(number(t) || 0),
    sortKey: (v) => number(v) || 0,
    summaries: ['avg', 'sum'],
  },
  progress: {
    name: 'Progress', group: 'Numbers', width: 140,
    blank: () => 0,
    coerce: (v) => Math.max(0, Math.min(100, Math.round(number(v) || 0))),
    toText: (v) => `${Math.round(number(v) || 0)}%`, fromText: (t) => Math.round(number(t) || 0),
    sortKey: (v) => number(v) || 0,
    summaries: ['avg'],
  },
  checkbox: {
    name: 'Checkbox', group: 'Basics', width: 90,
    blank: () => false,
    coerce: (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 'yes',
    toText: (v) => (v ? 'Yes' : ''), fromText: (t) => /^(yes|true|1|x|✓)$/i.test(text(t).trim()),
    sortKey: (v) => (v ? 1 : 0),
    summaries: ['checked', 'percent-checked'],
  },
  priority: {
    name: 'Priority', group: 'Basics', field: 'priority', width: 130,
    settings: { labels: PRIORITY_LABELS },
    blank: () => '',
    coerce: (v, col) => ((col.labels || PRIORITY_LABELS).some((l) => l.id === v) ? v : ''),
    toText: (v, col) => labelOf(col, v)?.text || '',
    fromText: (t, col) => (col.labels || PRIORITY_LABELS).find((l) => l.text.toLowerCase() === text(t).trim().toLowerCase())?.id || '',
    sortKey: (v, col) => (col.labels || PRIORITY_LABELS).findIndex((l) => l.id === v),
    summaries: ['breakdown'],
  },
  tags: {
    name: 'Tags', group: 'Basics', field: 'tags', width: 170,
    blank: () => [], coerce: (v) => list(v).slice(0, 24),
    toText: (v) => list(v).join(', '), fromText: (t) => list(t),
    sortKey: (v) => list(v).join(', ').toLowerCase(),
    summaries: ['breakdown', 'unique'],
  },
  link: {
    name: 'Link', group: 'Basics', width: 180,
    blank: () => null,
    coerce: (v) => {
      if (!v) return null
      const raw = typeof v === 'object' ? v : { url: v, label: '' }
      const url = text(raw.url).trim()
      if (!/^https?:\/\//i.test(url)) return null
      return { url: url.slice(0, 2000), label: text(raw.label).slice(0, 120) }
    },
    toText: (v) => (v ? v.url : ''), fromText: (t) => (/^https?:\/\//i.test(text(t).trim()) ? { url: text(t).trim(), label: '' } : null),
    sortKey: (v) => (v ? v.url.toLowerCase() : ''),
    summaries: ['filled'],
  },
  email: {
    name: 'Email', group: 'Basics', width: 180,
    blank: () => '', coerce: (v) => text(v).trim().slice(0, 320),
    toText: text, fromText: (t) => text(t).trim(), sortKey: (v) => text(v).toLowerCase(),
    summaries: ['filled'],
  },
  phone: {
    name: 'Phone', group: 'Basics', width: 150,
    blank: () => '', coerce: (v) => text(v).trim().slice(0, 40),
    toText: text, fromText: (t) => text(t).trim(), sortKey: (v) => text(v).toLowerCase(),
    summaries: ['filled'],
  },
  time: {
    name: 'Time tracking', group: 'Numbers', width: 150,
    blank: () => ({ seconds: 0, running: false, startedAt: null }),
    coerce: (v) => {
      const raw = v && typeof v === 'object' ? v : {}
      const running = raw.running === true && !!raw.startedAt
      return {
        seconds: Math.max(0, Math.round(number(raw.seconds) || 0)),
        running,
        startedAt: running ? isoDay(raw.startedAt) : null,
      }
    },
    toText: (v) => formatDuration(elapsed(v)),
    fromText: (t) => ({ seconds: Math.round((number(t) || 0) * 3600), running: false, startedAt: null }),
    sortKey: (v) => elapsed(v),
    summaries: ['hours'],
  },
  dependency: {
    name: 'Dependency', group: 'Structure', width: 190,
    settings: { mode: 'none' },
    blank: () => [], coerce: (v) => list(v).slice(0, 24),
    toText: (v) => list(v).join(' '), fromText: (t) => list(t),
    sortKey: (v) => list(v).length,
    summaries: ['filled'],
  },
  formula: {
    name: 'Formula', group: 'Structure', width: 150, readOnly: true,
    settings: { formula: '', unit: '' },
    blank: () => null, coerce: () => null,
    toText: (v, col) => (typeof v === 'number' ? format(v, col.unit || '') : text(v)),
    fromText: () => null, sortKey: (v) => (typeof v === 'number' ? v : text(v).toLowerCase()),
    summaries: ['sum', 'avg', 'min', 'max'],
  },
  created: {
    name: 'Created', group: 'Structure', width: 140, readOnly: true, derived: 'createdAt',
    blank: () => null, coerce: () => null,
    toText: (v) => (v ? formatDate(v, { year: 'numeric' }) : ''), fromText: () => null,
    sortKey: (v) => (v ? new Date(v).getTime() : null),
    summaries: ['earliest', 'latest'],
  },
  updated: {
    name: 'Last updated', group: 'Structure', width: 140, readOnly: true, derived: 'updatedAt',
    blank: () => null, coerce: () => null,
    toText: (v) => (v ? formatDate(v, { year: 'numeric' }) : ''), fromText: () => null,
    sortKey: (v) => (v ? new Date(v).getTime() : null),
    summaries: ['earliest', 'latest'],
  },
  itemid: {
    name: 'Item ID', group: 'Structure', width: 110, readOnly: true, derived: 'id',
    blank: () => null, coerce: () => null,
    toText: (v) => text(v).slice(-6), fromText: () => null, sortKey: (v) => text(v),
    summaries: [],
  },
}

export const COLUMN_KINDS = Object.keys(COLUMN_TYPES)

export const typeOf = (column) => COLUMN_TYPES[column?.kind] || COLUMN_TYPES.text

export const labelOf = (column, id) =>
  (column?.labels || (column?.kind === 'status' ? DEFAULT_STATUS_LABELS : column?.kind === 'priority' ? PRIORITY_LABELS : []))
    .find((l) => l.id === id) || null

/** The value one cell holds, whether it lives on the entity or in meta. */
export function readCell(item, column, board) {
  const type = typeOf(column)
  if (type.derived) return item[type.derived] ?? null
  if (column.kind === 'formula') return runFormula(item, column, board)
  if (type.field === 'timeline') return item.at || item.end ? { from: item.at || item.end, to: item.end || item.at } : null
  if (type.field === 'status') return statusToLabel(column, item.status)
  if (type.field === 'priority') return priorityToLabel(column, item.priority)
  if (type.field) return item[type.field] ?? type.blank(column)
  const stored = item.meta?.columns?.[column.id]
  return stored === undefined ? type.blank(column) : stored
}

/** The patch that writing one cell makes to the item. */
export function writeCell(item, column, raw, board) {
  const type = typeOf(column)
  if (type.readOnly) return null
  const value = type.coerce(raw, column)
  if (type.field === 'timeline') {
    return value ? { at: value.from, end: value.to } : { at: null, end: null }
  }
  if (type.field === 'status') {
    const label = labelOf(column, value)
    return { status: label?.maps || 'open', meta: { columns: { ...(item.meta?.columns || {}), [column.id]: value } } }
  }
  if (type.field === 'priority') {
    const label = labelOf(column, value)
    return { priority: label?.value ?? 0, meta: { columns: { ...(item.meta?.columns || {}), [column.id]: value } } }
  }
  if (type.field) return { [type.field]: value }
  return { meta: { columns: { ...(item.meta?.columns || {}), [column.id]: value } } }
}

/**
 * A status column stores its label id in meta so two labels that both mean
 * "done" stay distinct, and falls back to the entity's status so an item that
 * arrived from a parsed document still lands in the right group.
 */
function statusToLabel(column, status) {
  const labels = column.labels || DEFAULT_STATUS_LABELS
  return labels.find((l) => l.maps === status)?.id || labels[0]?.id || ''
}

function priorityToLabel(column, priority) {
  const labels = column.labels || PRIORITY_LABELS
  const wanted = Number(priority) || 0
  return labels.filter((l) => (l.value ?? 0) === wanted).at(-1)?.id || labels[0]?.id || ''
}

/** The label id the item actually stores, preferring what the user picked. */
export function cellValue(item, column, board) {
  const stored = item.meta?.columns?.[column.id]
  if ((column.kind === 'status' || column.kind === 'priority') && stored && labelOf(column, stored)) {
    const label = labelOf(column, stored)
    const agrees = column.kind === 'status' ? label.maps === item.status : (label.value ?? 0) === (Number(item.priority) || 0)
    if (agrees) return stored
  }
  return readCell(item, column, board)
}

const formulaCache = new Map()

function runFormula(item, column, board) {
  const source = column.formula || ''
  let compiled = formulaCache.get(source)
  if (!compiled) {
    compiled = compileFormula(source)
    if (formulaCache.size > 200) formulaCache.clear()
    formulaCache.set(source, compiled)
  }
  if (compiled.error) return ''
  const scope = { name: item.title, title: item.title }
  for (const other of board?.columns || []) {
    if (other.id === column.id || other.kind === 'formula') continue
    const value = readCell(item, other, board)
    const otherType = typeOf(other)
    scope[other.name] = ['number', 'rating', 'progress'].includes(other.kind)
      ? (value ?? 0)
      : other.kind === 'checkbox' ? (value ? 1 : 0)
        : other.kind === 'time' ? elapsed(value) / 3600
          : otherType.field === 'timeline' ? (value?.from || '')
            : otherType.toText(value, other)
  }
  return compiled.run(scope)
}

export const elapsed = (value) => {
  if (!value || typeof value !== 'object') return 0
  const base = Math.max(0, Number(value.seconds) || 0)
  if (!value.running || !value.startedAt) return base
  const since = (Date.now() - new Date(value.startedAt).getTime()) / 1000
  return base + Math.max(0, Math.round(since))
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds || 0))
  if (!total) return ''
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

/** Is this cell empty, for "is empty" filters and the "filled" summary. */
export function isBlank(value) {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return value.seconds !== undefined ? elapsed(value) === 0 : Object.keys(value).length === 0
  return value === false
}
