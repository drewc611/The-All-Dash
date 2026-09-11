/*
 * Write a workspace export without opening a browser.
 *
 * The MCP server reads an export of the browser app, which normally means
 * clicking Settings → Your data → Export. That is fine for a person and
 * useless for a fresh machine, a CI job, or anybody trying the MCP server
 * before they have used the app at all - and a connector that cannot start
 * until you have used the thing it connects to is a bad first five minutes.
 *
 * So this seeds the sample project through the app's own ingest pipeline and
 * writes what the app would have written.
 *
 *   node scripts/sample-workspace.mjs [path]     (default ~/.all-dash/workspace.json)
 *
 * The localStorage shim is the one piece of pretence: the store persists to
 * localStorage, which node does not have, and every read returns null so the
 * store starts empty exactly as a first run does. Nothing is read back
 * through it - the export is taken from the store's own state.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }

const { seedWorkspace } = await import('../src/data/seed.js')
const { exportWorkspace, getState } = await import('../src/core/store.js')

const target = process.argv[2] || join(homedir(), '.all-dash', 'workspace.json')

await seedWorkspace()
const json = exportWorkspace()

await mkdir(dirname(target), { recursive: true })
await writeFile(target, json)

const state = getState()
console.log(`Wrote ${target}`)
console.log(`${Object.keys(state.entities).length} records from ${state.docs.length} documents, ${(json.length / 1024).toFixed(0)}KB.`)
console.log('Point the MCP server at it with ALLDASH_WORKSPACE_FILE, or leave it at the default path and restart the server.')
