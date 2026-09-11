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

import { database, available, ask } from '../core/idb.js'

const STORE = 'blobs'

/** IndexedDB is absent in a worker-less SSR pass and disabled in some private
    windows. Every caller has to cope with that, so say so once, here. */
export { available }

const { read, write } = database({
  name: 'alldash-media',
  version: 1,
  store: STORE,
  label: 'the media database',
  upgrade: (store) => { store.createIndex('createdAt', 'createdAt') },
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
  await write((store) => { store.put(row) })
  const { blob: _omit, ...rest } = row
  return rest
}

export async function getBlob(id) {
  const row = await read((store) => ask(store.get(id)))
  return row ? row.blob : null
}

export async function deleteBlob(id) {
  await write((store) => { store.delete(id) })
}

/** Descriptors only - reading every blob to list them would load the whole
    library into memory. */
export async function listBlobs() {
  const rows = await read((store) => ask(store.getAll()))
  return rows.map(({ blob, ...rest }) => ({ ...rest, size: rest.size ?? blob?.size ?? 0 }))
}

export async function clearBlobs() {
  await write((store) => { store.clear() })
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
