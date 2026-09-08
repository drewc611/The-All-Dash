import { defineParser } from '../../core/registry.js'
import { entitiesFromTable } from '../tabular.js'
import { ENTITY_TYPES } from '../../data/schema.js'
import { iso } from '../../core/time.js'

/**
 * JSON covers three cases: an exported All Dash workspace, a hand-written
 * array of entities, and the far more common "array of records from some API"
 * which is treated as a table.
 */
defineParser({
  id: 'json',
  name: 'JSON records',
  extensions: ['.json', '.ndjson'],
  priority: 20,
  match: ({ name, text }) => /\.(json|ndjson)$/i.test(name || '') || looksLikeJson(text),
  parse: ({ name, text, docId, kind }) => {
    const source = { docId, name, kind }
    const data = readJson(text)
    if (!data) return []

    // An entity array, straight through.
    if (Array.isArray(data) && data.every((r) => r && ENTITY_TYPES.includes(r.type))) {
      return data.map((r) => ({ ...r, source }))
    }

    const records = pickRecordArray(data)
    if (records?.length) {
      const headers = [...new Set(records.flatMap((r) => Object.keys(r)))]
      const rows = records.map((r) => headers.map((h) => flatten(r[h])))
      return entitiesFromTable({ headers, rows }, source)
    }

    return [{
      type: 'note',
      title: name.replace(/\.[a-z0-9]+$/i, ''),
      body: JSON.stringify(data, null, 2).slice(0, 4000),
      at: iso(new Date()),
      tags: ['json'],
      source,
      confidence: 1,
    }]
  },
})

function looksLikeJson(text) {
  const t = String(text || '').trim()
  return (t.startsWith('{') || t.startsWith('[')) && t.length > 1
}

function readJson(text) {
  const t = String(text || '').trim()
  try {
    return JSON.parse(t)
  } catch {
    // NDJSON
    const lines = t.split(/\r?\n/).filter(Boolean)
    const parsed = []
    for (const line of lines) {
      try { parsed.push(JSON.parse(line)) } catch { return null }
    }
    return parsed.length ? parsed : null
  }
}

/** Find the array of objects, whether it is the root or one level down. */
function pickRecordArray(data) {
  if (Array.isArray(data) && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return data
  if (data && typeof data === 'object') {
    const candidates = Object.values(data).filter(
      (v) => Array.isArray(v) && v.length && v.every((r) => r && typeof r === 'object' && !Array.isArray(r))
    )
    candidates.sort((a, b) => b.length - a.length)
    return candidates[0] || null
  }
  return null
}

const flatten = (v) => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return Array.isArray(v) ? v.join(', ') : JSON.stringify(v)
  return v
}
