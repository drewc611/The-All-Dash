import { listParsers } from '../core/registry.js'
import { addEntities, recordUsage, registerDoc, syncDoc } from '../core/store.js'
import { makeDoc } from '../data/schema.js'
import { hashId, hashBytes } from '../core/id.js'
import { detectFlavor } from './detect.js'

import './parsers/text.js'
import './parsers/csv.js'
import './parsers/json.js'
import './parsers/ics.js'
import './parsers/transcript.js'
import './parsers/xlsx.js'
import './parsers/office.js'

const BINARY_EXTENSIONS = /\.(xlsx|xlsm|docx|pptx|zip)$/i

/**
 * Highest-priority parser whose match() accepts the input. A binary file only
 * ever goes to a parser that declared it can read binary; otherwise a stray
 * .zip would fall through to the plain-text reader and become an empty note.
 */
export function pickParser(input) {
  const binary = Boolean(input.buffer)
  return listParsers().find((p) => {
    if (binary && !p.binary) return false
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
  // A document's identity is its name: importing "Weekly sync.md" again means
  // "here is the newer version", and syncDoc() replaces what the old one
  // produced. The content fingerprint is kept on the doc so the version is
  // still visible.
  const docId = hashId('doc', name.trim().toLowerCase())
  const version = binary ? hashBytes('v', new Uint8Array(buffer)) : hashId('v', text)

  const flavor = binary ? null : detectFlavor({ name, text })
  const input = { name, text, buffer, mime: file.type || '', docId, kind: extensionOf(name), flavor }
  const parser = pickParser(input)
  if (!parser) throw new Error(`No reader for .${input.kind} files`)

  const produced = (await parser.parse(input)) || []
  // A parser may add its own source fields (the line number); the document
  // identity and the parser id are set here so every entity agrees on them.
  const entities = syncDoc(docId, produced.map((e) => ({ ...e, source: { ...e.source, docId, name, kind: parser.id } })))
  const doc = makeDoc({ id: docId, name, kind: parser.id, size: file.size ?? text.length, text, produced: entities.length, version, flavor })
  registerDoc(doc)
  recordUsage('import', parser.id)
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
