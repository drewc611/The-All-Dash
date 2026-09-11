/*
 * Media storage.
 *
 * Everything else in this app lives in localStorage, which tops out around
 * 5MB and only holds strings. A single minute of 1080p video is twenty times
 * that, so media blobs get their own IndexedDB store and the workspace keeps
 * only a pointer: an entity of type "media" whose meta.blobId names the row.
 *
 * That split is deliberate. Export, import, the brain and every widget keep
 * working on the small text workspace; the heavy bytes stay out of the way
 * and can be cleared without losing a single note.
 */

const DB = 'alldash-media'
const STORE = 'blobs'
const VERSION = 1

let dbPromise = null

/** IndexedDB is absent in a worker-less SSR pass and disabled in some private
    windows. Every caller has to cope with that, so say so once, here. */
export const available = () => typeof indexedDB !== 'undefined'

function open() {
  if (!available()) return Promise.reject(new Error('This browser has no IndexedDB, so media cannot be saved.'))
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => {
      // A second tab upgrading the schema would block us forever otherwise.
      req.result.onversionchange = () => { req.result.close(); dbPromise = null }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error || new Error('IndexedDB refused to open.'))
    req.onblocked = () => reject(new Error('Another tab is holding the media database open.'))
  })
  // A failed open must not be cached, or every later call fails with it.
  dbPromise.catch(() => { dbPromise = null })
  return dbPromise
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let result
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error || new Error('The media database rejected the write.'))
    tx.onabort = () => reject(tx.error || new Error('The media write was aborted, usually because the disk is full.'))
    result = fn(tx.objectStore(STORE), (v) => { result = v })
  }))
}

const ask = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

/** Store one blob. Returns the row's descriptor, never the bytes. */
export async function putBlob(id, blob, meta = {}) {
  const row = {
    id,
    blob,
    type: blob.type || meta.type || 'application/octet-stream',
    size: blob.size,
    createdAt: new Date().toISOString(),
    ...meta,
  }
  await run('readwrite', (store) => { store.put(row) })
  const { blob: _omit, ...rest } = row
  return rest
}

export async function getBlob(id) {
  const db = await open()
  const row = await ask(db.transaction(STORE, 'readonly').objectStore(STORE).get(id))
  return row ? row.blob : null
}

export async function deleteBlob(id) {
  await run('readwrite', (store) => { store.delete(id) })
}

/** Descriptors only - reading every blob to list them would load the whole
    library into memory. */
export async function listBlobs() {
  const db = await open()
  const rows = await ask(db.transaction(STORE, 'readonly').objectStore(STORE).getAll())
  return rows.map(({ blob, ...rest }) => ({ ...rest, size: rest.size ?? blob?.size ?? 0 }))
}

export async function clearBlobs() {
  await run('readwrite', (store) => { store.clear() })
}

/** Delete rows no entity points at any more. Closing a tab mid-record, or
    deleting a media entity from the Library, leaves bytes with no owner. */
export async function collectGarbage(liveIds) {
  const keep = new Set(liveIds)
  const rows = await listBlobs()
  const orphans = rows.filter((r) => !keep.has(r.id))
  for (const row of orphans) await deleteBlob(row.id)
  return { removed: orphans.length, bytes: orphans.reduce((n, r) => n + (r.size || 0), 0) }
}

/**
 * What this library costs and what is left.
 *
 * navigator.storage.estimate() reports the whole origin, including the
 * service worker's cache, so "mine" is summed separately - otherwise the
 * meter blames media for the app's own 400KB.
 */
export async function usage() {
  let rows = []
  try { rows = await listBlobs() } catch { rows = [] }
  const mine = rows.reduce((n, r) => n + (r.size || 0), 0)
  let quota = 0
  let used = mine
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate()
      quota = est.quota || 0
      used = est.usage || mine
    } catch { /* Safari in a private window throws here. */ }
  }
  return { count: rows.length, mine, used, quota, free: quota ? Math.max(0, quota - used) : 0 }
}

/** Ask the browser not to evict this origin under storage pressure. Chrome
    grants it silently once the app is installed or used enough; Firefox
    prompts. A refusal is not an error - it just means eviction stays possible. */
export async function requestPersistence() {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch { return false }
}
