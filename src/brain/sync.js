/**
 * Keep a folder of Markdown files on the person's own disk in step with the
 * brain, through the File System Access API (Chrome, Edge, Opera). The
 * directory handle is kept in IndexedDB so the folder survives a reload; the
 * browser asks for permission again after a restart, which is the API's
 * design and the reason the Brain view has a "Reconnect" button.
 *
 * Firefox and Safari have no such API: there, the zip download in bundle.js
 * is the way out.
 */

const DB = 'all-dash-brain'
const STORE = 'handles'
const KEY = 'folder'

export const canSyncFolder = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idb(mode, fn) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

/** Ask for a folder. Must run from a click. Returns its name. */
export async function connectFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'all-dash-brain', startIn: 'documents' })
  await idb('readwrite', (store) => store.put(handle, KEY))
  return handle.name
}

export async function disconnectFolder() {
  try {
    await idb('readwrite', (store) => store.delete(KEY))
  } catch {
    // Nothing stored, nothing to remove.
  }
}

/**
 * The stored handle with permission confirmed, or null. Pass `ask: true`
 * from a click handler to prompt; a background sync never prompts.
 */
export async function folderHandle({ ask = false } = {}) {
  let handle
  try {
    handle = await idb('readonly', (store) => store.get(KEY))
  } catch {
    return null
  }
  if (!handle) return null
  const options = { mode: 'readwrite' }
  try {
    if ((await handle.queryPermission(options)) === 'granted') return handle
    if (ask && (await handle.requestPermission(options)) === 'granted') return handle
  } catch {
    return null
  }
  return null
}

/** Write every file, creating sub-folders as needed. Returns the count. */
export async function writeFiles(handle, files) {
  let written = 0
  for (const file of files) {
    const parts = file.path.split('/')
    let dir = handle
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true })
    const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true })
    const stream = await fh.createWritable()
    await stream.write(file.text)
    await stream.close()
    written += 1
  }
  return written
}
