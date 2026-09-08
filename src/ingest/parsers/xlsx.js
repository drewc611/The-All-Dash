import { defineParser } from '../../core/registry.js'
import { entitiesFromTable } from '../tabular.js'
import { toTable } from './csv.js'
import { readZip } from '../zip.js'
import { unescapeXml } from '../xml.js'

/**
 * Excel workbooks, every sheet, no dependency. The XML here is regular enough
 * that regex beats pulling in a parser - and it keeps this working in Node for
 * the tests as well as in the browser.
 */

const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
const EXCEL_EPOCH = Date.UTC(1899, 11, 30)

export function columnIndex(ref) {
  const letters = String(ref).match(/^[A-Z]+/)?.[0] || 'A'
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function serialToDate(serial) {
  return new Date(EXCEL_EPOCH + Math.round(serial * 86400000))
}

export function parseSharedStrings(xml) {
  if (!xml) return []
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(([, block]) =>
    [...block.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('')
  )
}

/** numFmtId per style index, so date-formatted numbers come back as dates. */
export function parseDateStyles(xml) {
  if (!xml) return new Set()
  const custom = new Set()
  for (const [, id, code] of xml.matchAll(/<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const clean = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '')
    if (/[dy]/i.test(clean) && !/[$€£]/.test(clean)) custom.add(Number(id))
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || ''
  const dateStyles = new Set()
  ;[...cellXfs.matchAll(/<xf\b[^>]*>/g)].forEach((m, index) => {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0)
    if (DATE_FORMATS.has(id) || custom.has(id)) dateStyles.add(index)
  })
  return dateStyles
}

export function parseSheet(xml, shared, dateStyles) {
  const rows = []
  for (const [, attrs, body] of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(attrs.match(/r="(\d+)"/)?.[1] ?? rows.length + 1) - 1
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    for (const [, cellAttrs, content = ''] of body.matchAll(cellRe)) {
      const ref = cellAttrs.match(/r="([A-Z]+\d+)"/)?.[1]
      const type = cellAttrs.match(/t="([^"]+)"/)?.[1]
      const style = Number(cellAttrs.match(/s="(\d+)"/)?.[1] ?? -1)
      const index = ref ? columnIndex(ref) : cells.length
      cells[index] = readCell(type, style, content, shared, dateStyles)
    }
    rows[rowIndex] = Array.from(cells, (c) => c ?? '')
  }
  const width = Math.max(0, ...rows.map((r) => (r ? r.length : 0)))
  return rows.filter(Boolean).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
}

function readCell(type, style, content, shared, dateStyles) {
  if (type === 'inlineStr') {
    return [...content.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('')
  }
  const raw = content.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  if (raw === undefined) return ''
  if (type === 's') return shared[Number(raw)] ?? ''
  if (type === 'str' || type === 'e') return unescapeXml(raw)
  if (type === 'b') return raw === '1' ? 'TRUE' : 'FALSE'
  const num = Number(raw)
  if (!Number.isFinite(num)) return unescapeXml(raw)
  if (dateStyles.has(style)) return serialToDate(num).toISOString().slice(0, 10)
  return num
}

export async function readWorkbook(buffer) {
  const zip = await readZip(buffer)
  const shared = parseSharedStrings(await zip.text('xl/sharedStrings.xml'))
  const dateStyles = parseDateStyles(await zip.text('xl/styles.xml'))

  const workbook = (await zip.text('xl/workbook.xml')) || ''
  const rels = (await zip.text('xl/_rels/workbook.xml.rels')) || ''
  const relTargets = new Map(
    [...rels.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(([, id, target]) => [
      id,
      target.replace(/^\/?xl\//, '').replace(/^\//, ''),
    ])
  )

  const sheets = []
  for (const [, attrs] of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unescapeXml(attrs.match(/name="([^"]*)"/)?.[1] || `Sheet${sheets.length + 1}`)
    const rid = attrs.match(/r:id="([^"]+)"/)?.[1]
    const path = `xl/${relTargets.get(rid) || `worksheets/sheet${sheets.length + 1}.xml`}`
    if (!zip.has(path)) continue
    sheets.push({ name, rows: parseSheet(await zip.text(path), shared, dateStyles) })
  }
  return sheets
}

defineParser({
  id: 'xlsx',
  name: 'Excel workbooks',
  extensions: ['.xlsx', '.xlsm'],
  priority: 40,
  binary: true,
  match: ({ name }) => /\.(xlsx|xlsm)$/i.test(name || ''),
  parse: async ({ name, buffer, docId, kind }) => {
    const sheets = await readWorkbook(buffer)
    const out = []
    for (const sheet of sheets) {
      if (!sheet.rows.length) continue
      const table = toTable(sheet.rows.map((r) => r.map((c) => (c === null ? '' : c))))
      if (!table.headers.length) continue
      out.push(...entitiesFromTable({ ...table, sheet: sheet.name }, { docId, name, kind }))
    }
    return out
  },
})
