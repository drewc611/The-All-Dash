/*
 * Opening an IndexedDB database, once, correctly.
 *
 * Three things here keep bytes rather than records - the article archive, the
 * media blobs, and the assistant's answer cache - and each had grown its own
 * copy of this. The copies had drifted, which is the usual way duplicated
 * setup code goes wrong: the answer cache was missing the `onblocked`
 * handler the other two had, so a second tab upgrading that database left
 * every cache read waiting on a promise that would never settle.
 *
 * The awkward parts, in one place:
 *
 *  - A failed open must not be cached. Caching it means one transient failure
 *    turns into an app that can never save anything again for the life of the
 *    tab.
 *  - `onversionchange` has to close the connection. Without it, a second tab
 *    running a newer version of the app blocks on the upgrade forever, and so
 *    does this one.
 *  - `onblocked` has to reject. It is the same deadlock seen from the other
 *    side, and a promise that never settles is worse than an error, because
 *    nothing above it can show the person what went wrong.
 */

export const available = () => typeof indexedDB !== 'undefined'

/** An IDBRequest as a promise. */
export const ask = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result)
  req.onerror = () => reject(req.error)
})

/**
 * One database with one object store.
 *
 * `label` names the database in the errors people actually read ("the stash",
 * "the media database"), and `upgrade` is handed the store on creation so a
 * caller can add its own indexes.
 */
export function database({ name, version = 1, store: storeName, keyPath = 'id', label, upgrade }) {
  let dbPromise = null

  function open() {
    if (!available()) return Promise.reject(new Error(`This browser has no IndexedDB, so ${label} cannot be used.`))
    if (dbPromise) return dbPromise
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, version)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(storeName)) {
          upgrade?.(db.createObjectStore(storeName, { keyPath }))
        }
      }
      req.onsuccess = () => {
        req.result.onversionchange = () => { req.result.close(); dbPromise = null }
        resolve(req.result)
      }
      req.onerror = () => reject(req.error || new Error('IndexedDB refused to open.'))
      req.onblocked = () => reject(new Error(`Another tab is holding ${label} open.`))
    })
    dbPromise.catch(() => { dbPromise = null })
    return dbPromise
  }

  /** Read. The callback gets the object store and may issue several requests
      against it; they all run in the one transaction. */
  const read = (fn) => open().then((db) => fn(db.transaction(storeName, 'readonly').objectStore(storeName)))

  /** Write, resolving when the transaction commits rather than when the
      request succeeds - a request can succeed inside a transaction that then
      aborts, and reporting that as a successful save is a lie. */
  const write = (fn) => open().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error(`${label} rejected the write.`))
    tx.onabort = () => reject(tx.error || new Error(`The write to ${label} was aborted, usually because the disk is full.`))
    fn(tx.objectStore(storeName))
  }))

  return { open, read, write, available }
}
