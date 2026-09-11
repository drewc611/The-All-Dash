/*
 * The archive.
 *
 * Text, not bytes, so it gets its own database rather than sharing the media
 * one: different sizes, different lifetimes, different reasons to be cleared.
 *
 * This is the part that makes the whole thing worth building. The platform
 * tier fetches a page once; from then on the text is here, on this device.
 * It reads offline, it survives the backend going away, it survives the site
 * going down, and it survives this app being abandoned - which is exactly
 * what Pocket could not do for anyone when it shut down in 2025 and handed
 * its users a CSV of links with no articles attached.
 */

import { database, available, ask } from '../core/idb.js'

const STORE = 'snapshots'

export { available }

const db = database({
  name: 'alldash-stash',
  version: 1,
  store: STORE,
  label: 'the stash',
  upgrade: (store) => {
    store.createIndex('entityId', 'entityId')
    store.createIndex('savedAt', 'savedAt')
  },
})
const { read, write } = db

/** Keep one version of one page. */
export async function putSnapshot(id, { entityId, url, markdown, title = '', fingerprint = '' }) {
  await write((store) => store.put({
    id,
    entityId,
    url,
    title,
    markdown: String(markdown ?? ''),
    fingerprint,
    bytes: String(markdown ?? '').length,
    savedAt: new Date().toISOString(),
  }))
  return id
}

export async function getSnapshot(id) {
  if (!id) return null
  return (await read((store) => ask(store.get(id)))) || null
}

export const deleteSnapshot = (id) => write((store) => store.delete(id))

/** Every snapshot, without the text, for a size meter. */
export async function listSnapshots() {
  const rows = await read((store) => ask(store.getAll()))
  return rows.map(({ markdown, ...rest }) => ({ ...rest, bytes: rest.bytes ?? markdown?.length ?? 0 }))
}

/**
 * The corpus the search index is built from: id and text for the newest
 * snapshot of every page.
 *
 * Reading every article to build an index sounds alarming and is not: this is
 * text, and a thousand long articles is about 30MB, which a browser holds
 * without noticing.
 */
export async function corpus(ids) {
  if (!ids?.length) return []
  // Every get is issued before the first await, so they share one transaction.
  const rows = await read((store) => Promise.all(ids.map((id) => ask(store.get(id)).catch(() => null))))
  return rows.filter(Boolean).map((row) => ({ id: row.id, entityId: row.entityId, title: row.title, text: row.markdown }))
}

export async function clearSnapshots() {
  await write((store) => store.clear())
}

/** Drop snapshots no record points at any more. */
export async function collectGarbage(liveIds) {
  const keep = new Set(liveIds)
  const rows = await listSnapshots()
  const orphans = rows.filter((r) => !keep.has(r.id))
  for (const row of orphans) await deleteSnapshot(row.id)
  return { removed: orphans.length, bytes: orphans.reduce((n, r) => n + (r.bytes || 0), 0) }
}

export async function usage() {
  let rows = []
  try { rows = await listSnapshots() } catch { rows = [] }
  return {
    count: rows.length,
    bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0),
  }
}

/**
 * Everything, as one JSON file.
 *
 * The workspace export carries records, not article text. This carries the
 * text, because an archive you cannot take with you is not an archive - it is
 * a rental.
 */
export async function exportAll() {
  const rows = await read((store) => ask(store.getAll()))
  return { kind: 'alldash-stash', version: 1, exportedAt: new Date().toISOString(), snapshots: rows }
}

export async function importAll(payload) {
  const rows = Array.isArray(payload?.snapshots) ? payload.snapshots : []
  let written = 0
  for (const row of rows) {
    if (!row?.id) continue
    await write((store) => store.put(row))
    written += 1
  }
  return written
}
