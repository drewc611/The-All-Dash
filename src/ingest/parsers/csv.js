import { defineParser } from '../../core/registry.js'
import { entitiesFromTable } from '../tabular.js'
import { applyFlavor } from '../detect.js'

/** RFC 4180 reader, delimiter sniffed from the header row. */
export function parseDelimited(text, delimiter) {
  const src = String(text).replace(/^﻿/, '')
  const sep = delimiter || sniff(src)
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && field === '') { quoted = true; continue }
    if (ch === sep) { row.push(field); field = ''; continue }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      if (row.some((c) => c.trim() !== '')) rows.push(row)
      row = []
      field = ''
      continue
    }
    field += ch
  }
  row.push(field)
  if (row.some((c) => c.trim() !== '')) rows.push(row)

  return rows.map((r) => r.map((c) => c.trim()))
}

function sniff(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || ''
  const counts = [',', '\t', ';', '|'].map((d) => [d, line.split(d).length])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 1 ? counts[0][0] : ','
}

/** Skip preamble rows so exports with a title line still land correctly. */
export function toTable(rows) {
  if (!rows.length) return { headers: [], rows: [] }
  let headerIndex = 0
  const width = Math.max(...rows.slice(0, 10).map((r) => r.length))
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if (rows[i].filter((c) => c !== '').length >= Math.max(2, width - 1)) { headerIndex = i; break }
  }
  const headers = rows[headerIndex].map((h, i) => h || `Column ${i + 1}`)
  return { headers, rows: rows.slice(headerIndex + 1).map((r) => headers.map((_, i) => r[i] ?? '')) }
}

defineParser({
  id: 'csv',
  name: 'CSV and TSV',
  extensions: ['.csv', '.tsv'],
  priority: 20,
  match: ({ name }) => /\.(csv|tsv)$/i.test(name || ''),
  parse: ({ name, text, docId, kind, flavor }) =>
    entitiesFromTable(applyFlavor(toTable(parseDelimited(text)), flavor), { docId, name, kind }),
})
