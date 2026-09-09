import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { readConfig } from '../src/config.js'
import { createServer, startHttp } from '../src/server.js'
import { makeEntity } from '../../src/data/schema.js'
import { addDays, iso } from '../../src/core/time.js'

const at = (n) => iso(addDays(new Date(), n))

/** A workspace export the way the browser app writes one. */
async function fixtureWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'alldash-'))
  const rows = [
    makeEntity({ type: 'task', title: 'Rewrite the rollback script', status: 'open', due: at(-3), people: ['Priya Raman'], tags: ['infra'], body: 'Never run in prod.' }),
    makeEntity({ type: 'task', title: 'Draft the launch brief', status: 'blocked', due: at(2), people: ['Sam Ojo'] }),
    makeEntity({ type: 'task', title: 'Shipped thing', status: 'done', updatedAt: at(-1) }),
    makeEntity({ type: 'decision', title: 'Ship behind a flag' }),
    makeEntity({ type: 'risk', title: 'Legal review unscheduled', status: 'open', updatedAt: at(-10) }),
    makeEntity({ type: 'event', title: 'Standup', at: new Date().toISOString(), end: new Date(Date.now() + 1800000).toISOString() }),
    makeEntity({ type: 'person', title: 'Priya Raman', people: ['Priya Raman'] }),
  ]
  const state = {
    version: 1,
    workspace: { name: 'Atlas' },
    entities: Object.fromEntries(rows.map((r) => [r.id, r])),
    docs: [],
    customMetrics: [],
    triage: {},
    ui: { range: '30d' },
  }
  const file = join(dir, 'workspace.json')
  await writeFile(file, JSON.stringify(state))
  return { file, rows }
}

/** Enough of the platform API for the tools to be exercised end to end. */
function stubPlatform() {
  const seen = []
  const tasks = [{ id: 't1', title: 'Board deck', context: 'work', priority: 'P1', status: 'open', due_date: '2026-09-08', notes: '' }]
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], body: body ? JSON.parse(body) : null })
      const send = (code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }
      const path = req.url.split('?')[0]
      if (req.headers['x-api-key'] !== 'k') return send(401, { detail: 'Missing or invalid API key' })
      if (path === '/daily/latest') return send(200, { id: 'b1', brief_date: '2026-09-08', summary: 'Morning brief.', payload: {} })
      if (path === '/daily/run') return send(202, { status: 'built', brief_date: '2026-09-08' })
      if (path === '/tasks/today') return send(200, tasks)
      if (path === '/tasks' && req.method === 'GET') return send(200, { items: tasks, total: 1, limit: 200, offset: 0 })
      if (path === '/tasks' && req.method === 'POST') return send(201, { id: 't2', ...JSON.parse(body) })
      if (path === '/tasks/t1/toggle') return send(200, { ...tasks[0], status: 'done' })
      if (path === '/tasks/t1') return send(200, tasks[0])
      if (path === '/tasks/nope') return send(404, { detail: 'Task nope not found' })
      if (path === '/projects') return send(200, { items: [{ id: 'p1', name: 'Atlas', description: '', context: 'work', stage: 'in_progress' }], total: 1 })
      if (path === '/projects/nope') return send(404, { detail: 'nope' })
      if (path === '/invoices') return send(200, { items: [], total: 0 })
      if (path === '/invoices/nope') return send(404, { detail: 'nope' })
      if (path === '/expenses') return send(200, { items: [], total: 0 })
      if (path === '/expenses/nope') return send(404, { detail: 'nope' })
      if (path === '/ai-audit-logs/nope') return send(404, { detail: 'nope' })
      if (path === '/finance/summary') return send(200, { collected_cents: 100, expenses_cents: 40, margin_cents: 60, burn: { daily_cents: 2 } })
      if (path === '/ai-audit-logs/verify') return send(200, { ok: true, checked: 3, first_bad_seq: null })
      if (path === '/ai-audit-logs' && req.method === 'POST') return send(201, { id: 'a9', seq: 4, hash: 'h', ...JSON.parse(body) })
      if (path === '/ai-audit-logs') return send(200, { items: [], total: 0 })
      send(404, { detail: `no stub for ${req.method} ${path}` })
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, seen })))
}

async function connect(config) {
  const server = createServer(config)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(clientSide)
  return { client, server }
}

const parse = (result) => JSON.parse(result.content[0].text)

test('config: with nothing set, the default export path is used only when it exists', () => {
  const env = { HOME: '/home/someone' }
  assert.equal(readConfig(env, () => false).workspaceFile, '')
  assert.equal(readConfig(env, () => true).workspaceFile, '/home/someone/.all-dash/workspace.json')
  assert.equal(readConfig({ ...env, ALLDASH_API_URL: 'http://api' }, () => true).workspaceFile, '')
  assert.equal(readConfig({ ...env, ALLDASH_WORKSPACE_FILE: '/x.json' }, () => true).workspaceFile, '/x.json')
})

test('refuses to start with no source configured', () => {
  assert.throws(() => createServer({ workspaceFile: '', apiUrl: '', apiKey: '', publicUrl: '' }), /ALLDASH_WORKSPACE_FILE/)
})

test('workspace mode: overview, triage, status update, search and fetch use the app engines', async () => {
  const { file, rows } = await fixtureWorkspace()
  const { client, server } = await connect({ workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '' })
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name)
    assert.ok(tools.includes('search') && tools.includes('fetch') && tools.includes('workspace_triage'))
    assert.ok(!tools.includes('platform_brief'))

    const overview = parse(await client.callTool({ name: 'workspace_overview', arguments: {} }))
    assert.equal(overview.workspace, 'Atlas')
    assert.equal(overview.openTasks, 2)
    assert.equal(overview.overdueTasks, 1)
    assert.ok(overview.triage.total >= 3)

    const triage = parse(await client.callTool({ name: 'workspace_triage', arguments: { severity: 'serious' } }))
    assert.ok(triage.every((s) => s.severity === 'serious'))
    assert.ok(triage.some((s) => s.kind === 'overdue' || s.kind === 'blocked'))

    const status = await client.callTool({ name: 'workspace_status_update', arguments: {} })
    assert.match(status.content[0].text, /^# Status update/)
    assert.match(status.content[0].text, /Shipped thing/)

    const search = parse(await client.callTool({ name: 'search', arguments: { query: 'rollback' } }))
    assert.equal(search.results.length, 1)
    assert.match(search.results[0].id, /^ws:/)
    assert.match(search.results[0].url, /^alldash:\/\/workspace\//)

    const fetched = parse(await client.callTool({ name: 'fetch', arguments: { id: search.results[0].id } }))
    assert.equal(fetched.title, 'Rewrite the rollback script')
    assert.match(fetched.text, /Never run in prod/)
    assert.equal(fetched.metadata.people[0], 'Priya Raman')

    const missing = await client.callTool({ name: 'fetch', arguments: { id: 'ws:nothing' } })
    assert.equal(missing.isError, true)

    const resources = (await client.listResources()).resources.map((r) => r.uri)
    assert.ok(resources.includes('alldash://workspace/status-update'))
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name)
    assert.deepEqual(prompts.sort(), ['explain-signal', 'morning-review'])
    const prompt = await client.getPrompt({ name: 'morning-review', arguments: { context: 'work' } })
    assert.match(prompt.messages[0].content.text, /workspace_triage/)
    assert.doesNotMatch(prompt.messages[0].content.text, /platform_brief/)
    assert.equal(rows.length, 7)
  } finally {
    await client.close()
    await server.close()
  }
})

test('workspace mode: adding and updating a task writes the export file atomically', async () => {
  const { file } = await fixtureWorkspace()
  const { client, server } = await connect({ workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '' })
  try {
    const added = parse(await client.callTool({ name: 'workspace_add_task', arguments: { title: 'Call Legal', due: '2026-10-02', people: ['Sam'], tags: ['compliance'], priority: 2 } }))
    assert.equal(added.type, 'task')
    assert.equal(added.priority, 2)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.entities[added.id].title, 'Call Legal')
    assert.equal(saved.entities[added.id].meta.editedByUser, true)
    assert.equal(saved.entities[added.id].source.name, 'MCP')

    const updated = parse(await client.callTool({ name: 'workspace_update_task', arguments: { id: added.id, status: 'done', due: null } }))
    assert.equal(updated.status, 'done')
    assert.equal(updated.due, null)
    const again = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(again.entities[added.id].status, 'done')

    const bad = await client.callTool({ name: 'workspace_update_task', arguments: { id: 'nope', status: 'done' } })
    assert.equal(bad.isError, true)
  } finally {
    await client.close()
    await server.close()
  }
})

test('platform mode: tools map to endpoints, carry the key, and log decisions as the assistant', async () => {
  const stub = await stubPlatform()
  const { client, server } = await connect({ workspaceFile: '', apiUrl: stub.url, apiKey: 'k', publicUrl: 'https://dash.example.com' })
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name)
    assert.ok(tools.includes('platform_brief') && tools.includes('platform_log_decision'))
    assert.ok(!tools.includes('workspace_overview'))

    const brief = parse(await client.callTool({ name: 'platform_brief', arguments: {} }))
    assert.equal(brief.summary, 'Morning brief.')
    assert.equal(stub.seen.at(-1).url, '/daily/latest')

    const today = parse(await client.callTool({ name: 'platform_tasks_today', arguments: { context: 'work' } }))
    assert.equal(today[0].title, 'Board deck')
    assert.equal(stub.seen.at(-1).url, '/tasks/today?context=work')

    const created = parse(await client.callTool({ name: 'platform_create_task', arguments: { title: 'New', due_date: '2026-09-09' } }))
    assert.equal(created.context, 'work')
    assert.equal(created.priority, 'P2')
    assert.deepEqual(stub.seen.at(-1).body, { title: 'New', due_date: '2026-09-09', context: 'work', priority: 'P2' })

    const toggled = parse(await client.callTool({ name: 'platform_toggle_task', arguments: { id: 't1' } }))
    assert.equal(toggled.status, 'done')

    const logged = parse(await client.callTool({ name: 'platform_log_decision', arguments: { action: 'recommended_first_task', subject_type: 'task', subject_id: 't1', decision: 'Do the deck first', confidence: 0.8 } }))
    assert.equal(logged.actor, 'assistant')
    assert.equal(stub.seen.at(-1).body.confidence, 0.8)

    const verify = parse(await client.callTool({ name: 'platform_audit_verify', arguments: {} }))
    assert.equal(verify.ok, true)

    const search = parse(await client.callTool({ name: 'search', arguments: { query: 'atlas' } }))
    assert.deepEqual(search.results.map((r) => r.id), ['pf:p1'])
    assert.equal(search.results[0].url, 'https://dash.example.com/project/p1')

    const fetched = parse(await client.callTool({ name: 'fetch', arguments: { id: 'pf:t1' } }))
    assert.equal(fetched.title, 'Board deck')
    const missing = await client.callTool({ name: 'fetch', arguments: { id: 'pf:nope' } })
    assert.equal(missing.isError, true)

    assert.ok(stub.seen.every((r) => r.key === 'k'))
  } finally {
    await client.close()
    await server.close()
    stub.server.close()
  }
})

test('platform errors come back as tool errors, not crashes', async () => {
  const stub = await stubPlatform()
  const { client, server } = await connect({ workspaceFile: '', apiUrl: stub.url, apiKey: 'wrong', publicUrl: '' })
  try {
    const res = await client.callTool({ name: 'platform_brief', arguments: {} })
    assert.equal(res.isError, true)
    assert.match(res.content[0].text, /401/)
  } finally {
    await client.close()
    await server.close()
    stub.server.close()
  }
})

test('http transport: health is open, the MCP path needs the bearer token, and initialize works', async () => {
  const { file } = await fixtureWorkspace()
  const httpServer = startHttp({ workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '', port: 0, path: '/mcp', authToken: 'secret' })
  await new Promise((r) => httpServer.once('listening', r))
  const base = `http://127.0.0.1:${httpServer.address().port}`
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200)
    assert.equal((await fetch(`${base}/nope`)).status, 404)
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    const denied = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(init) })
    assert.equal(denied.status, 401)
    const ok = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, authorization: 'Bearer secret' }, body: JSON.stringify(init) })
    assert.equal(ok.status, 200)
    const text = await ok.text()
    assert.match(text, /"serverInfo"/)
    assert.match(text, /all-dash/)
  } finally {
    httpServer.close()
  }
})
