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

const DB = 'alldash-stash'
const STORE = 'snapshots'
const VERSION = 1

let dbPromise = null

export const available = () => typeof indexedDB !== 'undefined'

function open() {
  if (!available()) return Promise.reject(new Error('This browser has no IndexedDB, so pages cannot be saved.'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('entityId', 'entityId')
        store.createIndex('savedAt', 'savedAt')
      }
    }
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = null }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error || new Error('IndexedDB refused to open.'))
    req.onblocked = () => reject(new Error('Another tab is holding the stash open.'))
  })
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

const ask = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

function write(fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('The stash rejected the write.'))
    tx.onabort = () => reject(tx.error || new Error('The stash write was aborted, usually because the disk is full.'))
    fn(tx.objectStore(STORE))
  }))
}

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
  const db = await open()
  return (await ask(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))) || null
}

export const deleteSnapshot = (id) => write((store) => store.delete(id))

/** Every snapshot, without the text, for a size meter. */
export async function listSnapshots() {
  const db = await open()
  const rows = await ask(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
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
  const db = await open()
  const store = db.transaction(STORE, 'readonly').objectStore(STORE)
  const rows = await Promise.all(ids.map((id) => ask(store.get(id)).catch(() => null)))
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
  const db = await open()
  const rows = await ask(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
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
