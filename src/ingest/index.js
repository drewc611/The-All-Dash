import { listParsers } from '../core/registry.js'
import { addEntities, registerDoc } from '../core/store.js'
import { makeDoc } from '../data/schema.js'
import { hashId } from '../core/id.js'

import './parsers/text.js'
import './parsers/csv.js'
import './parsers/json.js'
import './parsers/ics.js'
import './parsers/transcript.js'
import './parsers/xlsx.js'
import './parsers/office.js'

const BINARY_EXTENSIONS = /\.(xlsx|xlsm|docx|pptx|zip)$/i

/** Highest-priority parser whose match() accepts the input. */
export function pickParser(input) {
  return listParsers().find((p) => {
    try {
      return p.match ? p.match(input) : p.extensions.some((ext) => input.name?.toLowerCase().endsWith(ext))
    } catch {
      return false
    }
  })
}

/**
 * Read one file and fold the result into the store.
 * @returns {Promise<{doc, entities, parser}>}
 */
export async function ingestFile(file) {
  const name = file.name || 'Untitled'
  const binary = BINARY_EXTENSIONS.test(name)
  const buffer = binary ? await file.arrayBuffer() : null
  const text = binary ? '' : await file.text()
  const docId = hashId('doc', name, String(file.size ?? text.length))

  const input = { name, text, buffer, mime: file.type || '', docId, kind: extensionOf(name) }
  const parser = pickParser(input)
  if (!parser) throw new Error(`Nothing here can read ${name}`)

  const produced = (await parser.parse(input)) || []
  // A parser may add its own source fields (the line number); the document
  // identity and the parser id are set here so every entity agrees on them.
  const entities = addEntities(produced.map((e) => ({ ...e, source: { ...e.source, docId, name, kind: parser.id } })))
  const doc = makeDoc({ id: docId, name, kind: parser.id, size: file.size ?? text.length, text, produced: entities.length })
  registerDoc(doc)
  // The document is an entity too, so search and the activity feed can see it.
  addEntities([doc])
  return { doc, entities, parser }
}

/** Paste path: same pipeline, synthetic file. */
export function ingestText(text, name = 'Pasted note.md') {
  return ingestFile(new File([text], name, { type: 'text/plain' }))
}

export async function ingestFiles(files) {
  const results = []
  for (const file of files) {
    try {
      results.push({ ok: true, ...(await ingestFile(file)) })
    } catch (error) {
      results.push({ ok: false, name: file.name, error: error.message })
    }
  }
  return results
}

const extensionOf = (name) => (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || 'txt').toLowerCase()
