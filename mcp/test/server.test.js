import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'

import { readConfig } from '../src/config.js'
import { createServer, hostName, startHttp } from '../src/server.js'
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
      if (path === '/web/capabilities') return send(200, { native: ['scrape', 'map', 'crawl', 'batch'], firecrawl: false, search: false, render: false, screenshot: false, model: null, extract: false, agent: false, limits: { max_pages: 200, sync_max_pages: 25 } })
      if (path === '/web/scrape') return send(200, { url: JSON.parse(body).url, final_url: JSON.parse(body).url, status: 200, title: 'Pricing', markdown: '# Pricing\n\n' + 'x'.repeat(30000), html: '<html>big</html>', engine: 'native', metadata: {} })
      if (path === '/web/crawl' && req.url.includes('async=true')) return send(200, { id: 'job1', kind: 'crawl', status: 'queued' })
      if (path === '/web/jobs/job1') return send(200, { id: 'job1', kind: 'crawl', status: 'done', request: {}, result: { pages: [{ url: 'https://example.com/', markdown: 'hi', title: 'Home' }], failures: [] }, error: '' })
      if (path === '/web/search') return send(501, { detail: 'Web search needs Firecrawl' })
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
    assert.ok(['web_scrape', 'web_map', 'web_crawl', 'web_batch', 'web_search', 'web_extract', 'web_agent', 'web_job', 'web_capabilities'].every((t) => tools.includes(t)))
    const scraped = parse(await client.callTool({ name: 'web_scrape', arguments: { url: 'https://example.com/pricing', formats: ['markdown', 'html'] } }))
    assert.equal(scraped.title, 'Pricing')
    assert.match(scraped.markdown, /\[truncated \d+ characters\]$/)
    assert.match(scraped.html, /omitted/)
    const job = parse(await client.callTool({ name: 'web_crawl', arguments: { url: 'https://example.com', async: true } }))
    assert.equal(job.status, 'queued')
    assert.equal(parse(await client.callTool({ name: 'web_job', arguments: { id: 'job1' } })).result.pages[0].title, 'Home')
    const unavailable = await client.callTool({ name: 'web_search', arguments: { query: 'x' } })
    assert.equal(unavailable.isError, true)
    assert.match(unavailable.content[0].text, /501.*Firecrawl/)
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

/** node:http, because fetch() rewrites the Host header and the test needs to forge one. */
const post = (url, headers, body) =>
  new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = ''
      res.on('data', (c) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('error', reject)
    req.end(body)
  })

test('http transport fails closed: no token refuses to start, open mode is loopback-only with a Host allow-list', async () => {
  const { file } = await fixtureWorkspace()
  const base = { workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '', port: 0, path: '/mcp', authToken: '' }
  assert.throws(() => startHttp({ ...base }), /MCP_AUTH_TOKEN is required/)
  assert.throws(() => startHttp({ ...base, allowUnauthenticated: true, host: '0.0.0.0' }), /loopback/)
  assert.equal(hostName('[::1]:8080'), '[::1]')
  assert.equal(hostName(' Dash.Example.com:443 '), 'dash.example.com')

  const open = startHttp({ ...base, allowUnauthenticated: true })
  await new Promise((r) => open.once('listening', r))
  assert.equal(open.address().address, '127.0.0.1')
  const url = `http://127.0.0.1:${open.address().port}`
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } }
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  try {
    const rebinding = await post(`${url}/mcp`, { ...headers, host: 'evil.example' }, JSON.stringify(init))
    assert.equal(rebinding.status, 421)
    assert.equal((await fetch(`${url}/healthz`)).status, 200)
    const ok = await post(`${url}/mcp`, headers, JSON.stringify(init))
    assert.equal(ok.status, 200)
  } finally {
    open.close()
  }

  // With a token, an explicit allow-list still applies on the MCP path.
  const pinned = startHttp({ ...base, authToken: 't', allowedHosts: ['dash.example.com'] })
  await new Promise((r) => pinned.once('listening', r))
  const purl = `http://127.0.0.1:${pinned.address().port}`
  try {
    const wrong = await post(`${purl}/mcp`, { ...headers, authorization: 'Bearer t' }, JSON.stringify(init))
    assert.equal(wrong.status, 421)
    const right = await post(`${purl}/mcp`, { ...headers, authorization: 'Bearer t', host: 'dash.example.com' }, JSON.stringify(init))
    assert.equal(right.status, 200)
  } finally {
    pinned.close()
  }
})

test('workspace ids that name Object.prototype members resolve to nothing', async () => {
  const { file } = await fixtureWorkspace()
  const { client } = await connect({ workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '' })
  const fetched = await client.callTool({ name: 'fetch', arguments: { id: 'ws:__proto__' } })
  assert.equal(fetched.isError, true)
  const updated = await client.callTool({ name: 'workspace_update_task', arguments: { id: 'constructor', status: 'done' } })
  assert.equal(updated.isError, true)
  assert.match(updated.content[0].text, /No entity/)
})

test('adding the same task twice keeps both, and concurrent writes all land', async () => {
  const { file } = await fixtureWorkspace()
  const { client } = await connect({ workspaceFile: file, apiUrl: '', apiKey: '', publicUrl: '' })
  const first = parse(await client.callTool({ name: 'workspace_add_task', arguments: { title: 'Call Legal', due: '2026-10-01' } }))
  const second = parse(await client.callTool({ name: 'workspace_add_task', arguments: { title: 'Call Legal', due: '2026-10-01' } }))
  assert.notEqual(first.id, second.id)
  await Promise.all([1, 2, 3, 4].map((n) => client.callTool({ name: 'workspace_add_task', arguments: { title: `Parallel ${n}` } })))
  const state = JSON.parse(await readFile(file, 'utf8'))
  const titles = Object.values(state.entities).map((e) => e.title)
  assert.equal(titles.filter((t) => t === 'Call Legal').length, 2)
  for (const n of [1, 2, 3, 4]) assert.ok(titles.includes(`Parallel ${n}`), `Parallel ${n} was lost`)
})

test('config ignores unexpanded placeholders of both shapes and takes one public URL', () => {
  const c = readConfig({ ALLDASH_WORKSPACE_FILE: '${ALLDASH_WORKSPACE_FILE:-}', ALLDASH_API_URL: '${ALLDASH_API_URL}', MCP_PUBLIC_URL: 'https://a.example, https://b.example' }, () => false)
  assert.equal(c.workspaceFile, '')
  assert.equal(c.apiUrl, '')
  assert.equal(c.publicUrl, 'https://a.example')
})

test('crawl and batch refuse a fifth format before the platform would', async () => {
  const stub = await stubPlatform()
  const { client } = await connect({ workspaceFile: '', apiUrl: stub.url, apiKey: 'k', publicUrl: '' })
  try {
    const result = await client.callTool({ name: 'web_batch', arguments: { urls: ['https://example.com/'], formats: ['markdown', 'html', 'text', 'links', 'screenshot'] } })
    assert.equal(result.isError, true)
  } finally {
    stub.server.close()
  }
})

/* ------------------------------------------------------------------ agents */

/** A workspace with a contradiction and two sources that agree, so the five
    have something real to find rather than an empty room. */
async function fixtureForAgents() {
  const dir = await mkdtemp(join(tmpdir(), 'alldash-agents-'))
  const rows = [
    makeEntity({ type: 'risk', title: 'The rollback script has never been run against production data', tags: ['atlas'] }),
    makeEntity({ type: 'note', title: 'The rollback script was run against production data last week', body: 'We did run the rollback script against production data last week and it finished in 40 minutes.', tags: ['atlas'] }),
    makeEntity({ type: 'note', title: 'The cutover runbook is out of date', body: 'The cutover runbook is out of date and nobody has revised it since phase one.', tags: ['atlas'] }),
    makeEntity({ type: 'decision', title: 'The cutover runbook is out of date', body: 'Marco confirmed the cutover runbook is out of date after the phase one retro.', tags: ['atlas'] }),
  ]
  const state = {
    version: 1,
    workspace: { name: 'Atlas' },
    entities: Object.fromEntries(rows.map((r) => [r.id, r])),
    docs: [], customMetrics: [], triage: {}, ui: { range: '30d' },
  }
  const file = join(dir, 'workspace.json')
  await writeFile(file, JSON.stringify(state))
  return { file, rows }
}

test('agents: the five run over the export and cite what they used', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })

  const result = parse(await client.callTool({ name: 'agents_ask', arguments: { question: 'rollback script production data' } }))

  assert.ok(result.answer.length > 0)
  assert.ok(result.passages.length > 0)
  // Every claim in the answer carries an id, and every id is a passage that
  // came back. That is the Critic's rule, and it holds over MCP too.
  const ids = [...result.answer.matchAll(/\[\[([a-z0-9_-]+)\]\]/gi)].map((m) => m[1])
  assert.ok(ids.length > 0, result.answer)
  const known = new Set(result.passages.map((p) => p.id))
  for (const id of ids) assert.ok(known.has(id), `${id} was cited but not retrieved`)

  assert.ok(result.contradictions.length >= 1, JSON.stringify(result.contradictions))
  assert.ok(result.passages.every((p) => typeof p.why.relevance === 'number'))
})

test('agents: asking changes nothing, however often it is asked', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })
  const before = await readFile(file, 'utf8')

  await client.callTool({ name: 'agents_ask', arguments: { question: 'rollback script' } })
  await client.callTool({ name: 'agents_ask', arguments: { question: 'cutover runbook' } })

  // An agent exploring a workspace must not be able to change which claims
  // survive simply by asking about them enough times.
  assert.equal(await readFile(file, 'utf8'), before)
})

test('agents: a taught claim becomes a Markdown file in the workspace', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })

  const learned = parse(await client.callTool({
    name: 'genome_learn',
    arguments: { claim: 'The cutover runbook is out of date', body: 'Two sources say so.', sources: ['a', 'b'] },
  }))
  assert.equal(learned.added.length, 1)
  const id = learned.added[0].id

  const listed = parse(await client.callTool({ name: 'genome_list', arguments: {} }))
  assert.equal(listed.length, 1)
  assert.equal(listed[0].generation, 1)
  assert.ok(listed[0].fitness > 0)

  const doc = parse(await client.callTool({ name: 'genome_file', arguments: { id } }))
  assert.match(doc.path, /^genome\//)
  assert.match(doc.markdown, /^---\n/)
  assert.match(doc.markdown, /generation: 1/)

  // And it is a real entity in the file, so the app sees it on restore.
  const state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.entities[id].type, 'gene')
  assert.equal(state.entities[id].title, 'The cutover runbook is out of date')
})

test('agents: the same claim taught twice is confirmed, not duplicated', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })

  await client.callTool({ name: 'genome_learn', arguments: { claim: 'Latency is the problem', sources: ['a'] } })
  const again = parse(await client.callTool({ name: 'genome_learn', arguments: { claim: 'Latency is the problem', sources: ['b'] } }))

  assert.equal(again.added.length, 0)
  assert.equal(again.confirmed.length, 1)
  assert.equal(parse(await client.callTool({ name: 'genome_list', arguments: {} })).length, 1)
})

test('agents: judging a claim moves its fitness', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })
  const id = parse(await client.callTool({ name: 'genome_learn', arguments: { claim: 'The replica lags under load' } })).added[0].id

  const before = parse(await client.callTool({ name: 'genome_list', arguments: {} }))[0].fitness
  const after = parse(await client.callTool({ name: 'genome_judge', arguments: { id, verdict: 'confirm' } }))
  assert.ok(after.fitness > before, `${after.fitness} should beat ${before}`)

  const against = parse(await client.callTool({ name: 'genome_judge', arguments: { id, verdict: 'contradict' } }))
  assert.ok(against.fitness < after.fitness)

  const missing = await client.callTool({ name: 'genome_judge', arguments: { id: 'nope', verdict: 'confirm' } })
  assert.equal(missing.isError, true)
})

test('agents: selection retires a claim that has decayed, and never deletes it', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })
  const id = parse(await client.callTool({ name: 'genome_learn', arguments: { claim: 'Something said once long ago' } })).added[0].id

  // Age it past the floor by hand: the schedule is the thing under test, not
  // the clock.
  const state = JSON.parse(await readFile(file, 'utf8'))
  const old = new Date(Date.now() - 400 * 86400000).toISOString()
  state.entities[id].body = state.entities[id].body.replace(/changed: .*/, `changed: ${old}`)
  await writeFile(file, JSON.stringify(state))

  const pruned = parse(await client.callTool({ name: 'genome_prune', arguments: {} }))
  assert.equal(pruned.retired.length, 1)
  assert.equal(pruned.retired[0].id, id)

  assert.equal(parse(await client.callTool({ name: 'genome_list', arguments: {} })).length, 0)
  assert.equal(parse(await client.callTool({ name: 'genome_list', arguments: { includeRetired: true } })).length, 1)
  // Retired is out of retrieval, not gone.
  assert.ok(JSON.parse(await readFile(file, 'utf8')).entities[id])
})

test('agents: applying a proposal writes the thing that was proposed', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })

  const asked = parse(await client.callTool({ name: 'agents_ask', arguments: { question: 'rollback script production data' } }))
  const proposal = asked.proposals.find((p) => p.kind === 'resolve')
  assert.ok(proposal, JSON.stringify(asked.proposals))

  const applied = parse(await client.callTool({
    name: 'agents_apply',
    arguments: { kind: proposal.kind, title: proposal.title, body: proposal.why },
  }))
  const state = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(state.entities[applied.id].title, proposal.title)
  assert.equal(state.entities[applied.id].type, 'task')
})

test('agents: the study queue withholds the answer until the card is graded', async () => {
  const { file } = await fixtureForAgents()
  // A card the browser would have written into the export.
  const state = JSON.parse(await readFile(file, 'utf8'))
  state.study = {
    cards: {
      card_1: {
        id: 'card_1', question: 'The rollback script has ______ been run', answer: 'never',
        source: 'x', kind: 'cloze', ease: 2.5, interval: 0, repetitions: 0, due: '', lapses: 0, lastGrade: null,
      },
    },
  }
  await writeFile(file, JSON.stringify(state))
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })

  const queue = parse(await client.callTool({ name: 'study_queue', arguments: {} }))
  assert.equal(queue.due, 1)
  assert.equal(queue.queue[0].id, 'card_1')
  assert.equal(Object.hasOwn(queue.queue[0], 'answer'), false, 'a queue that hands over the answer is not a test')

  const graded = parse(await client.callTool({ name: 'study_grade', arguments: { id: 'card_1', score: 5 } }))
  assert.equal(graded.answer, 'never')
  assert.equal(graded.interval, 1)

  const failed = parse(await client.callTool({ name: 'study_grade', arguments: { id: 'card_1', score: 1 } }))
  assert.equal(failed.interval, 0)
  assert.equal(failed.lapses, 1)
})

test('agents: the genome is served as a directory of Markdown files', async () => {
  const { file } = await fixtureForAgents()
  const { client } = await connect({ workspaceFile: file, apiUrl: '' })
  await client.callTool({ name: 'genome_learn', arguments: { claim: 'The replica lags under load', topic: 'infra' } })

  const read = await client.readResource({ uri: 'alldash://workspace/genome' })
  assert.match(read.contents[0].text, /genome\/infra\//)
  assert.match(read.contents[0].text, /The replica lags under load/)
})

test('agents: with no workspace file the agent tools are not offered at all', async () => {
  const { client } = await connect({ workspaceFile: '', apiUrl: 'http://127.0.0.1:9/api', apiKey: 'k' })
  const names = (await client.listTools()).tools.map((t) => t.name)
  for (const name of ['agents_ask', 'genome_list', 'study_queue']) {
    assert.equal(names.includes(name), false, `${name} needs a workspace`)
  }
})
