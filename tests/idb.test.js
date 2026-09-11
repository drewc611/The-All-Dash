import test from 'node:test'
import assert from 'node:assert/strict'

import { database, available, ask } from '../src/core/idb.js'

/*
 * The three storage layers used to each carry their own copy of this, and the
 * copies had drifted. These pin the behaviours that drifting broke, against a
 * stub rather than a browser, because every one of them is about what happens
 * when the open does not simply succeed - which is the case a browser test
 * never reaches on a healthy machine.
 */

/** Enough of IndexedDB to drive the open handshake, and no more. */
function stubIndexedDB({ outcome = 'success', existing = [] } = {}) {
  const calls = []
  const db = {
    objectStoreNames: { contains: (name) => existing.includes(name) },
    createObjectStore: (name, options) => {
      calls.push({ createObjectStore: name, options })
      return { createIndex: (index) => calls.push({ createIndex: index }) }
    },
    close: () => calls.push({ close: true }),
    transaction: () => ({ objectStore: () => ({}) }),
  }
  const indexedDB = {
    open(name, version) {
      calls.push({ open: name, version })
      const req = { result: db, error: null }
      queueMicrotask(() => {
        if (outcome === 'error') { req.error = new Error('quota'); req.onerror?.() } else if (outcome === 'blocked') req.onblocked?.()
        else { req.onupgradeneeded?.(); req.onsuccess?.() }
      })
      return req
    },
  }
  return { indexedDB, db, calls }
}

const withStub = async (stub, fn) => {
  const had = 'indexedDB' in globalThis
  const previous = globalThis.indexedDB
  globalThis.indexedDB = stub.indexedDB
  try {
    return await fn()
  } finally {
    if (had) globalThis.indexedDB = previous
    else delete globalThis.indexedDB
  }
}

const make = (over = {}) => database({ name: 'test-db', version: 3, store: 'rows', label: 'the test store', ...over })

test('a store is created with its indexes on first open', async () => {
  const stub = stubIndexedDB()
  await withStub(stub, async () => {
    const db = make({ upgrade: (store) => { store.createIndex('at') } })
    await db.open()
  })
  assert.deepEqual(stub.calls[0], { open: 'test-db', version: 3 })
  assert.deepEqual(stub.calls[1], { createObjectStore: 'rows', options: { keyPath: 'id' } })
  assert.deepEqual(stub.calls[2], { createIndex: 'at' })
})

test('an existing store is left alone', async () => {
  const stub = stubIndexedDB({ existing: ['rows'] })
  await withStub(stub, async () => {
    const db = make({ upgrade: () => { throw new Error('must not run') } })
    await db.open()
  })
  assert.equal(stub.calls.some((c) => c.createObjectStore), false)
})

test('the connection is opened once and shared', async () => {
  const stub = stubIndexedDB()
  await withStub(stub, async () => {
    const db = make()
    await Promise.all([db.open(), db.open(), db.open()])
    await db.open()
  })
  assert.equal(stub.calls.filter((c) => c.open).length, 1)
})

test('a failed open is not cached, so one bad moment is not permanent', async () => {
  // This is the bug that caching the rejection causes: every later call fails
  // with the first failure, for the life of the tab.
  const failing = stubIndexedDB({ outcome: 'error' })
  await withStub(failing, async () => {
    const db = make()
    await assert.rejects(db.open(), /quota/)
    await assert.rejects(db.open(), /quota/)
    assert.equal(failing.calls.filter((c) => c.open).length, 2, 'it must try again rather than replay the failure')
  })
})

test('a blocked open rejects rather than hanging forever', async () => {
  // The answer cache had no onblocked handler, so a second tab upgrading it
  // left every read waiting on a promise that could never settle. An error is
  // worse than success and far better than silence.
  const stub = stubIndexedDB({ outcome: 'blocked' })
  await withStub(stub, async () => {
    await assert.rejects(make().open(), /Another tab is holding the test store open/)
  })
})

test('another tab upgrading closes this connection instead of deadlocking it', async () => {
  const stub = stubIndexedDB()
  await withStub(stub, async () => {
    const db = make()
    const first = await db.open()
    first.onversionchange()
    await db.open()
  })
  assert.equal(stub.calls.some((c) => c.close), true)
  assert.equal(stub.calls.filter((c) => c.open).length, 2, 'after closing, the next call opens again')
})

test('without IndexedDB the error names the store rather than the API', async () => {
  const had = 'indexedDB' in globalThis
  const previous = globalThis.indexedDB
  delete globalThis.indexedDB
  try {
    assert.equal(available(), false)
    await assert.rejects(make().open(), /no IndexedDB, so the test store cannot be used/)
  } finally {
    if (had) globalThis.indexedDB = previous
  }
})

test('ask resolves a request result and rejects its error', async () => {
  const good = {}
  const goodPromise = ask(good)
  good.result = 7
  good.onsuccess()
  assert.equal(await goodPromise, 7)

  const bad = {}
  const badPromise = ask(bad)
  bad.error = new Error('nope')
  bad.onerror()
  await assert.rejects(badPromise, /nope/)
})
