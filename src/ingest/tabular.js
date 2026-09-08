import { parseLooseDate, iso } from '../core/time.js'
import { splitPeople, slug } from './extract.js'

/**
 * Rows in, entities out.
 *
 * CSV, TSV, JSON arrays and spreadsheet sheets all converge here. The work is
 * guessing what a column means, which is done once and reused by every format,
 * so "support .xlsx" only ever means "get me rows".
 */

const ROLE_PATTERNS = [
  ['title', /^(task|title|name|item|summary|subject|description|activity|deliverable|work item|milestone|content|card|issue)$/i],
  ['status', /^(status|state|stage|progress|done)$/i],
  ['owner', /^(owner|assignee|assignees|assigned to|responsible|who|lead|reporter)$/i],
  ['due', /^(due|due date|due on|deadline|target date|end date|finish|target)$/i],
  ['start', /^(start|start date|begins|from|date|day|when|timestamp|created|created at|period|month|week)$/i],
  ['priority', /^(priority|p|severity|importance)$/i],
  ['tags', /^(tags?|labels?|category|categories|type|epic|project|team|sprint|section|column|list|board|cycle name|issue type)$/i],
  ['notes', /^(notes?|comments?|details?|body|context|desc)$/i],
]

const STATUS_MAP = {
  done: 'done', complete: 'done', completed: 'done', closed: 'done', shipped: 'done', yes: 'done', true: 'done',
  doing: 'doing', 'in progress': 'doing', wip: 'doing', started: 'doing', active: 'doing',
  blocked: 'blocked', stuck: 'blocked', 'at risk': 'blocked', waiting: 'blocked',
  cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled',
  open: 'open', todo: 'open', 'to do': 'open', backlog: 'open', new: 'open', 'not started': 'open', no: 'open', false: 'open',
}

/** Turn a raw cell into a number plus its unit, or null when it is not numeric. */
export function toNumber(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, unit: '' } : null
  const text = String(raw).trim()
  if (!text) return null
  if (!/[0-9]/.test(text)) return null
  const currency = text.match(/^([$€£])\s*-?[\d,]/)
  const percent = /%\s*$/.test(text)
  const cleaned = text.replace(/[\s,$€£%]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''))
  if (!/^-?\d*\.?\d+([eE][+-]?\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return { value, unit: percent ? '%' : currency ? currency[1] : '' }
}

/** Look at up to 40 rows and decide what each column is. */
export function profileColumns(headers, rows) {
  const sample = rows.slice(0, 40)
  return headers.map((header, i) => {
    const name = String(header ?? `Column ${i + 1}`).trim() || `Column ${i + 1}`
    const values = sample.map((r) => r[i]).filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    const numeric = values.filter((v) => toNumber(v)).length
    const dated = values.filter((v) => parseLooseDate(v)).length
    const role = ROLE_PATTERNS.find(([, re]) => re.test(name))?.[0] || null
    const kind =
      values.length === 0 ? 'empty'
        : dated / values.length > 0.7 ? 'date'
          : numeric / values.length > 0.7 ? 'number'
            : 'text'
    const unit = kind === 'number' ? (toNumber(values.find((v) => toNumber(v)))?.unit || guessUnit(name)) : ''
    return { index: i, name, role, kind, unit }
  })
}

function guessUnit(name) {
  if (/(revenue|cost|spend|budget|arr|mrr|price|\$|usd|eur|gbp)/i.test(name)) return '$'
  if (/(rate|pct|percent|%|margin|uptime|conversion)/i.test(name)) return '%'
  if (/(hours?|hrs)/i.test(name)) return 'h'
  if (/(days?)/i.test(name)) return 'd'
  if (/(points?|pts|story)/i.test(name)) return 'pts'
  return ''
}

/**
 * @param {{headers: string[], rows: any[][], sheet?: string}} table
 * @param {{docId, name, kind}} source
 */
export function entitiesFromTable(table, source) {
  const { headers, rows, sheet } = table
  if (!headers?.length || !rows?.length) return []
  const cols = profileColumns(headers, rows)
  const byRole = (role) => cols.find((c) => c.role === role)
  const numberCols = cols.filter((c) => c.kind === 'number' && c.role !== 'priority')
  const dateCol = byRole('start') || byRole('due') || cols.find((c) => c.kind === 'date')
  const titleCol =
    byRole('title') || cols.find((c) => c.kind === 'text' && !c.role) || cols.find((c) => c.kind === 'text')

  const isTaskTable = Boolean(titleCol && (byRole('status') || byRole('owner') || byRole('due')))
  const label = sheet ? `${source.name} / ${sheet}` : source.name
  const sheetTag = slug(sheet || String(source.name).replace(/\.[a-z0-9]+$/i, ''))
  const out = []

  if (isTaskTable) {
    rows.forEach((row, rowIndex) => {
      const title = cell(row, titleCol)
      if (!title) return
      const statusRaw = String(cell(row, byRole('status')) || '').trim().toLowerCase()
      const dueRaw = cell(row, byRole('due'))
      const priorityRaw = String(cell(row, byRole('priority')) || '').toLowerCase()
      out.push({
        type: 'task',
        title,
        body: cell(row, byRole('notes')) || '',
        status: STATUS_MAP[statusRaw] || (statusRaw ? 'open' : 'open'),
        due: dueRaw ? parseLooseDate(dueRaw) : null,
        at: cell(row, byRole('start')) ? parseLooseDate(cell(row, byRole('start'))) : null,
        people: splitPeople(cell(row, byRole('owner')) || ''),
        tags: [sheetTag, ...cols.filter((c) => c.role === 'tags').flatMap((c) => splitTags(row[c.index]))],
        priority: /p0|urgent|critical|high/.test(priorityRaw) ? 2 : /p1|medium/.test(priorityRaw) ? 1 : 0,
        source: { ...source, line: rowIndex + 2 },
        confidence: 0.9,
      })
    })
  }

  // Numeric columns become metric series. With a date column they get real
  // timestamps; without one they collapse to a single point at import time.
  if (numberCols.length) {
    if (dateCol) {
      rows.forEach((row, rowIndex) => {
        const at = parseLooseDate(cell(row, dateCol))
        if (!at) return
        for (const col of numberCols) {
          const parsed = toNumber(row[col.index])
          if (!parsed) continue
          out.push({
            type: 'metric',
            title: col.name,
            series: col.name,
            value: parsed.value,
            unit: parsed.unit || col.unit,
            at,
            tags: [sheetTag],
            source: { ...source, line: rowIndex + 2 },
            confidence: 0.95,
          })
        }
      })
    } else {
      const at = iso(new Date())
      for (const col of numberCols) {
        const values = rows.map((r) => toNumber(r[col.index])).filter(Boolean).map((n) => n.value)
        if (!values.length) continue
        out.push({
          type: 'metric',
          title: col.name,
          series: col.name,
          value: values.reduce((a, b) => a + b, 0),
          unit: col.unit,
          at,
          tags: [sheetTag],
          meta: { rows: values.length, avg: values.reduce((a, b) => a + b, 0) / values.length, max: Math.max(...values) },
          source,
          confidence: 0.7,
        })
      }
    }
  }

  // Always keep the table itself, so a sheet is browsable even when nothing
  // else about it was recognised.
  out.push({
    type: 'note',
    title: `Table: ${label}`,
    body: `${rows.length} rows, ${headers.length} columns: ${cols.map((c) => c.name).join(', ')}`,
    at: iso(new Date()),
    tags: ['table', sheetTag],
    meta: {
      table: { headers: cols.map((c) => c.name), rows: rows.slice(0, 500), columns: cols },
    },
    source,
    confidence: 1,
  })

  return out
}

const cell = (row, col) => (col ? row[col.index] : null)

function splitTags(raw) {
  if (!raw) return []
  return String(raw)
    .split(/[,;|]/)
    .map((t) => slug(t))
    .filter(Boolean)
}
