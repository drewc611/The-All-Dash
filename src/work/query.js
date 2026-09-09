/**
 * Filtering, sorting, grouping and the footer summaries.
 *
 * Every view shares this: a saved view is a filter list, a sort and a group-by,
 * and each of the seven view kinds just draws the same result differently.
 */

import { formatDate } from '../core/time.js'
import { format, pluralise } from '../core/format.js'
import { cellValue, elapsed, formatDuration, isBlank, labelOf, typeOf } from './columns.js'

export const FILTER_OPS = {
  is: { name: 'is', needsValue: true },
  'is-not': { name: 'is not', needsValue: true },
  contains: { name: 'contains', needsValue: true },
  'not-contains': { name: 'does not contain', needsValue: true },
  empty: { name: 'is empty', needsValue: false },
  'not-empty': { name: 'is not empty', needsValue: false },
  gt: { name: 'is greater than', needsValue: true, numeric: true },
  lt: { name: 'is less than', needsValue: true, numeric: true },
  before: { name: 'is before', needsValue: true, date: true },
  after: { name: 'is after', needsValue: true, date: true },
  within: { name: 'is', needsValue: true, date: true, choices: true },
}

export const DATE_WINDOWS = {
  today: 'today',
  tomorrow: 'tomorrow',
  'this-week': 'this week',
  'next-week': 'next week',
  'past': 'in the past',
  'next-7': 'in the next 7 days',
  overdue: 'overdue',
  none: 'not set',
}

const DAY = 86400000

export function opsFor(column) {
  const kind = column?.kind
  if (!column || kind === 'text' || kind === 'longtext' || kind === 'email' || kind === 'phone' || kind === 'link') {
    return ['contains', 'not-contains', 'is', 'is-not', 'empty', 'not-empty']
  }
  if (kind === 'status' || kind === 'priority' || kind === 'dropdown') return ['is', 'is-not', 'empty', 'not-empty']
  if (kind === 'person' || kind === 'tags') return ['is', 'is-not', 'contains', 'empty', 'not-empty']
  if (kind === 'date' || kind === 'timeline' || kind === 'created' || kind === 'updated') {
    return ['within', 'before', 'after', 'empty', 'not-empty']
  }
  if (kind === 'checkbox') return ['is', 'is-not']
  return ['gt', 'lt', 'is', 'empty', 'not-empty']
}

/** One filter against one item. `columnId` may be the pseudo-column "title". */
function matches(item, filter, board) {
  if (!filter?.op) return true
  const column = board.columns.find((c) => c.id === filter.columnId)
  const raw = column ? cellValue(item, column, board) : filter.columnId === 'title' ? item.title : null
  const type = column ? typeOf(column) : null

  if (filter.op === 'empty') return isBlank(raw)
  if (filter.op === 'not-empty') return !isBlank(raw)

  const asText = column ? type.toText(raw, column) : String(raw ?? '')
  const wanted = String(filter.value ?? '')

  switch (filter.op) {
    case 'is': {
      if (column?.kind === 'checkbox') return !!raw === (wanted === 'true' || wanted === '1')
      if (Array.isArray(raw)) return raw.some((v) => String(v).toLowerCase() === wanted.toLowerCase()) || asText.toLowerCase() === wanted.toLowerCase()
      return String(raw ?? '').toLowerCase() === wanted.toLowerCase() || asText.toLowerCase() === wanted.toLowerCase()
    }
    case 'is-not':
      return !matches(item, { ...filter, op: 'is' }, board)
    case 'contains':
      return asText.toLowerCase().includes(wanted.toLowerCase())
    case 'not-contains':
      return !asText.toLowerCase().includes(wanted.toLowerCase())
    case 'gt':
      return toNumber(raw) !== null && toNumber(raw) > Number(wanted)
    case 'lt':
      return toNumber(raw) !== null && toNumber(raw) < Number(wanted)
    case 'before': {
      const at = toTime(raw)
      const edge = Date.parse(wanted)
      return at !== null && Number.isFinite(edge) && at < edge
    }
    case 'after': {
      const at = toTime(raw)
      const edge = Date.parse(wanted)
      return at !== null && Number.isFinite(edge) && at > edge
    }
    case 'within':
      return inWindow(toTime(raw), wanted, item)
    default:
      return true
  }
}

function inWindow(at, window, item) {
  if (window === 'none') return at === null
  if (at === null) return false
  const now = new Date()
  const startOfToday = new Date(now).setHours(0, 0, 0, 0)
  const endOfToday = startOfToday + DAY - 1
  switch (window) {
    case 'today': return at >= startOfToday && at <= endOfToday
    case 'tomorrow': return at >= startOfToday + DAY && at <= endOfToday + DAY
    case 'this-week': return at >= startOfToday - now.getDay() * DAY && at < startOfToday + (7 - now.getDay()) * DAY
    case 'next-week': return at >= startOfToday + (7 - now.getDay()) * DAY && at < startOfToday + (14 - now.getDay()) * DAY
    case 'past': return at < startOfToday
    case 'next-7': return at >= startOfToday && at < startOfToday + 7 * DAY
    case 'overdue': return at < startOfToday && item.status !== 'done' && item.status !== 'cancelled'
    default: return true
  }
}

const toNumber = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v && typeof v === 'object' && v.seconds !== undefined) return elapsed(v)
  const n = Number(v)
  return v !== '' && v !== null && Number.isFinite(n) ? n : null
}

const toTime = (v) => {
  if (!v) return null
  const raw = typeof v === 'object' && v.from ? v.from : v
  const at = Date.parse(raw)
  return Number.isFinite(at) ? at : null
}

export function applyFilters(items, view, board) {
  const filters = (view?.config?.filters || []).filter((f) => f && f.op)
  const search = String(view?.config?.search || '').trim().toLowerCase()
  let rows = items
  if (filters.length) rows = rows.filter((item) => filters.every((f) => matches(item, f, board)))
  if (search) {
    rows = rows.filter((item) => {
      if (item.title.toLowerCase().includes(search)) return true
      return board.columns.some((c) => typeOf(c).toText(cellValue(item, c, board), c).toLowerCase().includes(search))
    })
  }
  return rows
}

export function applySort(items, view, board) {
  const sort = view?.config?.sort
  if (!sort?.columnId) return items
  const column = board.columns.find((c) => c.id === sort.columnId)
  const direction = sort.dir === 'desc' ? -1 : 1
  const key = column
    ? (item) => typeOf(column).sortKey(cellValue(item, column, board), column)
    : (item) => item.title.toLowerCase()
  return [...items].sort((a, b) => {
    const av = key(a)
    const bv = key(b)
    // Empty cells sink to the bottom whichever way the column is sorted.
    if (av === null || av === undefined || av === '') return bv === null || bv === undefined || bv === '' ? 0 : 1
    if (bv === null || bv === undefined || bv === '') return -1
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction
    return String(av).localeCompare(String(bv)) * direction
  })
}

/**
 * Rows into buckets. "group" uses the board's own groups; any other column id
 * buckets by that column's value, which is what Kanban lanes are made of.
 */
export function groupItems(items, board, groupBy = 'group') {
  if (groupBy === 'none') return [{ id: 'all', name: 'All items', tone: 'accent', items }]
  if (groupBy === 'group' || !groupBy) {
    const buckets = board.groups.map((g) => ({ ...g, items: [] }))
    const byId = new Map(buckets.map((b) => [b.id, b]))
    const fallback = buckets[0]
    for (const item of items) (byId.get(item.meta?.group) || fallback)?.items.push(item)
    return buckets
  }
  const column = board.columns.find((c) => c.id === groupBy)
  if (!column) return [{ id: 'all', name: 'All items', tone: 'accent', items }]
  const type = typeOf(column)
  const buckets = new Map()
  const add = (id, name, tone, item) => {
    if (!buckets.has(id)) buckets.set(id, { id, name, tone, items: [] })
    buckets.get(id).items.push(item)
  }
  // A status or dropdown column has its lanes up front, so an empty lane is
  // still a lane you can drag into.
  for (const label of column.labels || []) add(label.id, label.text, label.tone, null)
  for (const bucket of buckets.values()) bucket.items = []
  for (const item of items) {
    const value = cellValue(item, column, board)
    if (Array.isArray(value)) {
      if (!value.length) add('', 'Not set', 'neutral', item)
      else for (const v of value) add(String(v), labelOf(column, String(v))?.text || String(v), labelOf(column, String(v))?.tone || 'accent', item)
    } else if (isBlank(value)) {
      add('', 'Not set', 'neutral', item)
    } else {
      const label = labelOf(column, value)
      add(String(value), label?.text || type.toText(value, column) || String(value), label?.tone || 'accent', item)
    }
  }
  return [...buckets.values()]
}

// ------------------------------------------------------------- summaries

export const SUMMARY_NAMES = {
  sum: 'Sum', avg: 'Average', min: 'Min', max: 'Max', median: 'Median',
  breakdown: 'Breakdown', filled: 'Filled', empty: 'Empty', unique: 'Unique',
  earliest: 'Earliest', latest: 'Latest', overdue: 'Overdue',
  checked: 'Checked', 'percent-checked': '% checked', 'percent-done': '% done',
  hours: 'Total time', span: 'Span',
}

/** The one line under a column, per group and per board. */
export function summarise(items, column, board, kind) {
  const type = typeOf(column)
  const wanted = kind || type.summaries?.[0]
  if (!wanted || !items.length) return null
  const values = items.map((item) => cellValue(item, column, board))
  const numbers = values.map(toNumber).filter((n) => n !== null)
  const times = values.map(toTime).filter((t) => t !== null)

  switch (wanted) {
    case 'sum': return { label: 'Sum', text: format(round(numbers.reduce((a, b) => a + b, 0)), column.unit || '') }
    case 'avg': return { label: 'Avg', text: numbers.length ? format(round(numbers.reduce((a, b) => a + b, 0) / numbers.length), column.unit || '') : '-' }
    case 'min': return { label: 'Min', text: numbers.length ? format(Math.min(...numbers), column.unit || '') : '-' }
    case 'max': return { label: 'Max', text: numbers.length ? format(Math.max(...numbers), column.unit || '') : '-' }
    case 'median': return { label: 'Median', text: numbers.length ? format(median(numbers), column.unit || '') : '-' }
    case 'filled': return { label: 'Filled', text: `${values.filter((v) => !isBlank(v)).length}/${values.length}` }
    case 'empty': return { label: 'Empty', text: String(values.filter(isBlank).length) }
    case 'unique': {
      const seen = new Set(values.flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => !isBlank(v)).map(String))
      return { label: 'Unique', text: `${seen.size} ${pluralise(seen.size, 'value')}` }
    }
    case 'earliest': return { label: 'Earliest', text: times.length ? formatDate(new Date(Math.min(...times))) : '-' }
    case 'latest': return { label: 'Latest', text: times.length ? formatDate(new Date(Math.max(...times))) : '-' }
    case 'span': return { label: 'Span', text: times.length ? `${Math.round((Math.max(...times) - Math.min(...times)) / DAY)}d` : '-' }
    case 'overdue': {
      const now = Date.now()
      const late = items.filter((item, i) => times[i] !== undefined && toTime(values[i]) !== null && toTime(values[i]) < now && item.status !== 'done')
      return { label: 'Overdue', text: String(late.length), tone: late.length ? 'critical' : undefined }
    }
    case 'checked': return { label: 'Checked', text: `${values.filter(Boolean).length}/${values.length}` }
    case 'percent-checked': {
      const done = values.filter(Boolean).length
      return { label: 'Checked', text: `${Math.round((done / values.length) * 100)}%` }
    }
    case 'percent-done': {
      const done = items.filter((i) => i.status === 'done').length
      return { label: 'Done', text: `${Math.round((done / items.length) * 100)}%`, tone: done === items.length ? 'good' : undefined }
    }
    case 'hours': return { label: 'Tracked', text: formatDuration(values.reduce((a, v) => a + elapsed(v), 0)) || '0s' }
    case 'breakdown': {
      const counts = new Map()
      for (const value of values) {
        for (const one of Array.isArray(value) ? (value.length ? value : ['']) : [value]) {
          const label = labelOf(column, one)
          const name = label?.text || type.toText(one, column) || 'Not set'
          counts.set(name, { count: (counts.get(name)?.count || 0) + 1, tone: label?.tone })
        }
      }
      const parts = [...counts.entries()].sort((a, b) => b[1].count - a[1].count)
      return { label: 'Breakdown', text: parts.slice(0, 3).map(([name, v]) => `${name} ${v.count}`).join(' · '), parts }
    }
    default: return null
  }
}

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2)
}

const round = (n) => Math.round(n * 100) / 100

export { matches as matchesFilter }
