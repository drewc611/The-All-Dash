/*
 * The cache.
 *
 * Every gateway that caches does it by embedding similarity: embed the
 * question, find a near neighbour, return its answer. That has two problems
 * nobody advertises.
 *
 * The first is that it needs an embedding model and a vector store, which is
 * a service to deploy and a bill to pay in order to save money.
 *
 * The second is worse. "What is our Q3 revenue" and "what is our Q4 revenue"
 * are extremely close in embedding space and have different answers. A
 * similarity threshold loose enough to be useful is loose enough to return
 * the wrong quarter, confidently, with no way to tell.
 *
 * So this caches on the question *and* on a fingerprint of the workspace
 * context the answer was built from. Two consequences follow, and the second
 * is the one a general gateway cannot have:
 *
 * - It never answers a different question. The key is lexical, so there is no
 *   similarity threshold to tune and nothing to get wrong.
 * - It expires itself. Change a due date the answer depended on and the
 *   fingerprint changes, so the entry is gone. A gateway sitting in front of
 *   an API has no idea the underlying facts moved; this one is inside the
 *   app that moved them.
 */

import { database, available, ask } from '../core/idb.js'

const DB = 'alldash-ai'
const STORE = 'replies'
const VERSION = 1

export { available }

/**
 * Normalise a question so trivial differences hit the same entry.
 *
 * Case, whitespace and trailing punctuation only. Deliberately not stemming
 * or dropping words: "what is not done" and "what is done" must never
 * collapse into one key, and every cleverer scheme risks exactly that.
 */
export function normaliseQuestion(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/[?!.,;:\s]+$/g, '')
    .trim()
}

/** FNV-1a over a string. Not a security hash and never used as one. */
export function hash(text) {
  let value = 0x811c9dc5
  const input = String(text ?? '')
  for (let i = 0; i < input.length; i += 1) {
    value ^= input.charCodeAt(i)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value.toString(16).padStart(8, '0')
}

/**
 * A fingerprint of what the answer was allowed to know.
 *
 * Built from each entity's id and updatedAt, so editing any item in the
 * context changes it and adding or removing one changes it. Sorted, so the
 * order the retriever happened to return things in does not.
 */
export function groundingFingerprint(entities = []) {
  const parts = entities
    .map((entity) => `${entity?.id || ''}:${entity?.updatedAt || entity?.at || ''}`)
    .sort()
  return hash(parts.join('|'))
}

/**
 * The key. Model and system prompt are in it because the same question asked
 * of a different model, or under a changed system prompt, is a different
 * question.
 */
export function cacheKey({ question, provider, model, system = '', grounding = '' }) {
  return [
    hash(normaliseQuestion(question)),
    provider || '',
    model || '',
    hash(system).slice(0, 4),
    grounding,
  ].join('-')
}

/* ------------------------------------------------------------------ store */

const { read: readStore, write } = database({
  name: DB,
  version: VERSION,
  store: STORE,
  keyPath: 'key',
  label: 'the answer cache',
  upgrade: (store) => { store.createIndex('at', 'at') },
})

/** An entry still worth using. Age is a backstop, not the mechanism: the
    fingerprint has usually already killed a stale answer. */
export async function read(key, { maxAgeMs = 7 * 24 * 3600_000 } = {}) {
  if (!available() || !key) return null
  try {
    const row = await readStore((store) => ask(store.get(key)))
    if (!row) return null
    if (Date.now() - Date.parse(row.at) > maxAgeMs) {
      await write((store) => store.delete(key)).catch(() => {})
      return null
    }
    return row
  } catch { return null }
}

export async function put(key, { text, provider, model, inputTokens = 0, outputTokens = 0, question = '' }) {
  if (!available() || !key) return
  try {
    await write((store) => store.put({
      key, text, provider, model, inputTokens, outputTokens,
      question: String(question).slice(0, 300),
      at: new Date().toISOString(),
    }))
  } catch { /* a full disk must not break answering */ }
}

export async function clear() {
  if (!available()) return
  await write((store) => store.clear()).catch(() => {})
}

export async function stats() {
  if (!available()) return { count: 0, bytes: 0 }
  try {
    const rows = await readStore((store) => ask(store.getAll()))
    return { count: rows.length, bytes: rows.reduce((n, row) => n + (row.text?.length || 0), 0) }
  } catch { return { count: 0, bytes: 0 } }
}

/** Drop the oldest entries once there are more than `keep`. Answers are small
    and few; this exists so a long-lived workspace cannot grow without bound. */
export async function prune({ keep = 500 } = {}) {
  if (!available()) return 0
  try {
    const rows = await readStore((store) => ask(store.getAll()))
    if (rows.length <= keep) return 0
    const doomed = rows.sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, rows.length - keep)
    for (const row of doomed) await write((store) => store.delete(row.key))
    return doomed.length
  } catch { return 0 }
}
