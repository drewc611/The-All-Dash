import test from 'node:test'
import assert from 'node:assert/strict'

import { parseReply, plainText, visiblePortion, validateAction, lineReader, deltaFromLine, stopFromLine } from '../src/ai/protocol.js'
import { terms, relevance, retrieve, describe, buildContext, SYSTEM_PROMPT } from '../src/ai/context.js'
import { resolve, PROVIDERS, assertKeyTransport } from '../src/ai/providers.js'
import { makeEntity } from '../src/data/schema.js'
import { addDays, iso, rangeFor, parseLooseDate } from '../src/core/time.js'

const at = (offset) => iso(addDays(new Date(), offset))
const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))

const fixture = () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Rewrite the rollback script', status: 'open', due: at(-2), people: ['Priya Raman'], tags: ['infra'], body: 'Never run against production data.' }),
    makeEntity({ type: 'task', title: 'Draft customer comms', status: 'open', due: at(3), people: ['Sam Ojo'] }),
    makeEntity({ type: 'task', title: 'Order lunch', status: 'done' }),
    makeEntity({ type: 'risk', title: 'Legal review unscheduled', status: 'open' }),
    makeEntity({ type: 'decision', title: 'Ship behind a flag' }),
    makeEntity({ type: 'event', title: 'Standup', at: new Date().toISOString(), end: new Date(Date.now() + 1800000).toISOString() }),
    makeEntity({ type: 'note', title: 'Retro notes', body: 'Long body text about the migration and the rollback plan.' }),
    makeEntity({ type: 'person', title: 'Priya Raman', people: ['Priya Raman'] }),
  ]
  return map(rows)
}

test('parseReply splits citations into segments and keeps only known ids', () => {
  const entities = fixture()
  const [task] = Object.values(entities)
  const reply = parseReply(`The script is late [[${task.id}]] and this one is made up [[task_nope]].`, { known: entities })
  assert.deepEqual(reply.citations, [task.id])
  assert.equal(reply.segments.filter((s) => s.ref).length, 1)
  assert.match(reply.text, /made up \[\[task_nope\]\]/)
})

test('parseReply lifts a fenced actions block out of the prose and validates each op', () => {
  const entities = fixture()
  const [task] = Object.values(entities)
  const raw = [
    'I can close it for you.',
    '```actions',
    JSON.stringify([
      { op: 'update', id: task.id, patch: { status: 'done', priority: 9, bogus: 1 } },
      { op: 'update', id: 'task_missing', patch: { status: 'done' } },
      { op: 'create', entity: { type: 'task', title: 'Follow up with Legal', due: '2026-10-01', people: ['Sam'] } },
      { op: 'create', entity: { type: 'doc', title: 'not allowed' } },
      { op: 'navigate', view: 'triage' },
      { op: 'navigate', view: 'nowhere' },
      { op: 'delete', id: task.id },
    ]),
    '```',
  ].join('\n')
  const reply = parseReply(raw, { known: entities })
  assert.equal(reply.text, 'I can close it for you.')
  assert.equal(reply.actions.length, 3)
  assert.deepEqual(reply.actions[0], { op: 'update', id: task.id, patch: { status: 'done' }, note: '' })
  assert.equal(reply.actions[1].op, 'create')
  assert.equal(reply.actions[1].entity.due, parseLooseDate('2026-10-01'))
  assert.deepEqual(reply.actions[1].entity.people, ['Sam'])
  assert.equal(reply.actions[2].view, 'triage')
})

test('a json block that is not a list of actions is left in the prose', () => {
  const reply = parseReply('Here is a table:\n```json\n{"a":1}\n```\n', {})
  assert.equal(reply.actions.length, 0)
  assert.match(reply.text, /"a":1/)
})

test('validateAction normalises due to ISO, rejects bad status, allows clearing a date', () => {
  assert.equal(validateAction({ op: 'update', id: 'x', patch: { status: 'finished' } }), null)
  assert.equal(validateAction({ op: 'update', id: 'x', patch: { due: null } }).patch.due, null)
  assert.equal(validateAction({ op: 'update', id: 'x', patch: { due: 'not a date' } }), null)
  assert.equal(validateAction({ op: 'update', id: 'x', patch: { priority: '2' } }).patch.priority, 2)
})

test('plainText strips citations, fences and markdown for speech', () => {
  const spoken = plainText('**Two** tasks are late [[task_abc1]].\n```actions\n[]\n```')
  assert.equal(spoken, 'Two tasks are late .')
})

test('visiblePortion hides a reply from the first action fence onward while streaming', () => {
  assert.equal(visiblePortion('Sure.\n```actions\n[{'), 'Sure.\n')
  assert.equal(visiblePortion('No block here'), 'No block here')
})

test('lineReader hands back whole lines and keeps the remainder', () => {
  const reader = lineReader()
  assert.deepEqual(reader.push('data: a\ndata: b\r\ndat'), ['data: a', 'data: b'])
  assert.deepEqual(reader.push('a: c\n'), ['data: c'])
  assert.deepEqual(reader.flush(), [])
  reader.push('tail')
  assert.deepEqual(reader.flush(), ['tail'])
})

test('deltaFromLine reads all three streaming formats and surfaces errors', () => {
  assert.equal(deltaFromLine('anthropic', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}'), 'Hi')
  assert.equal(deltaFromLine('anthropic', 'event: message_start'), null)
  assert.equal(deltaFromLine('openai', 'data: {"choices":[{"delta":{"content":"Yo"}}]}'), 'Yo')
  assert.equal(deltaFromLine('openai', 'data: [DONE]'), null)
  assert.equal(deltaFromLine('ollama', '{"message":{"content":"Hey"},"done":false}'), 'Hey')
  assert.throws(() => deltaFromLine('anthropic', 'data: {"type":"error","error":{"message":"bad key"}}'), /bad key/)
  assert.throws(() => deltaFromLine('openai', 'data: {"error":{"message":"quota"}}'), /quota/)
  assert.throws(() => deltaFromLine('ollama', '{"error":"model not found"}'), /model not found/)
  assert.equal(stopFromLine('anthropic', 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}'), 'end_turn')
  assert.equal(stopFromLine('openai', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'), 'stop')
  assert.equal(stopFromLine('ollama', '{"done":true,"done_reason":"stop"}'), 'stop')
})

test('terms drops stopwords and relevance rewards title, people and tags', () => {
  const entities = fixture()
  const [task] = Object.values(entities)
  const tokens = terms('What is Priya doing about the rollback?')
  assert.deepEqual(tokens, ['priya', 'doing', 'rollback'])
  assert.ok(relevance(task, tokens) >= 5)
  assert.equal(relevance(makeEntity({ type: 'task', title: 'Unrelated' }), tokens), 0)
})

test('retrieve puts matches first, adds the baseline, skips people and honours focus', () => {
  const entities = fixture()
  const rows = Object.values(entities)
  const retro = rows.find((e) => e.title === 'Retro notes')
  const picked = retrieve(entities, 'rollback plan', { limit: 6 })
  assert.equal(picked[0].title, 'Rewrite the rollback script')
  assert.ok(picked.some((e) => e.title === 'Retro notes'))
  assert.ok(picked.some((e) => e.type === 'risk'))
  assert.ok(!picked.some((e) => e.type === 'person'))
  const focused = retrieve(entities, 'anything', { limit: 3, focus: [retro.id] })
  assert.equal(focused[0].id, retro.id)
  assert.equal(focused.length, 3)
})

test('describe prints one citable line, and titles-only privacy drops the body', () => {
  const entities = fixture()
  const [task] = Object.values(entities)
  const full = describe(task)
  assert.match(full, new RegExp(`^\\[\\[${task.id}\\]\\] task "Rewrite the rollback script" \\| open \\| due \\d{4}-\\d{2}-\\d{2} \\| @Priya Raman \\| #infra`))
  assert.match(full, /Never run against production/)
  assert.doesNotMatch(describe(task, { privacy: 'titles' }), /Never run/)
})

test('buildContext carries the snapshot, triage and items, and the system prompt explains the protocol', () => {
  const entities = fixture()
  const state = { settings: { assistant: { privacy: 'titles', contextLimit: 5 } }, customMetrics: [], triage: {} }
  const ctx = buildContext(entities, 'what is late?', { state, range: rangeFor('30d') })
  assert.match(ctx.text, /Workspace: 0 documents, 2 open tasks \(1 overdue\)/)
  assert.match(ctx.text, /Triage \(most urgent first\):/)
  assert.match(ctx.text, /Items \(5, titles only\)/)
  assert.equal(ctx.items.length, 5)
  assert.match(SYSTEM_PROMPT, /\[\[task_abc123\]\]/)
  assert.match(SYSTEM_PROMPT, /"op":"update"/)
})

test('resolve fills provider defaults and strips a trailing slash from the base URL', () => {
  assert.deepEqual(resolve({}), { provider: 'anthropic', baseUrl: PROVIDERS.anthropic.baseUrl, model: 'claude-opus-5', needsKey: true })
  const local = resolve({ provider: 'ollama', baseUrl: 'http://box:11434/', model: 'qwen2.5' })
  assert.equal(local.baseUrl, 'http://box:11434')
  assert.equal(local.needsKey, false)
  assert.equal(resolve({ provider: 'openai' }).model, '')
})

test('an API key only travels over TLS or to this machine', () => {
  assert.throws(() => assertKeyTransport('http://api.example.com/v1', 'sk-x'), /plain HTTP/)
  assert.throws(() => assertKeyTransport('not a url', 'sk-x'), /not a valid URL/)
  assert.doesNotThrow(() => assertKeyTransport('https://api.example.com/v1', 'sk-x'))
  assert.doesNotThrow(() => assertKeyTransport('http://localhost:1234/v1', 'sk-x'))
  assert.doesNotThrow(() => assertKeyTransport('http://127.0.0.1:1234', 'sk-x'))
  assert.doesNotThrow(() => assertKeyTransport('http://[::1]:11434', 'sk-x'))
  assert.doesNotThrow(() => assertKeyTransport('http://lmstudio.localhost:1234', 'sk-x'))
  assert.doesNotThrow(() => assertKeyTransport('http://api.example.com/v1', ''))
})

test('validateAction ignores ids that only exist on Object.prototype', () => {
  const known = { t1: { id: 't1' } }
  assert.equal(validateAction({ op: 'update', id: '__proto__', patch: { status: 'done' } }, known), null)
  assert.equal(validateAction({ op: 'update', id: 'constructor', patch: { status: 'done' } }, known), null)
  assert.equal(validateAction({ op: 'update', id: 't1', patch: { status: 'done' } }, known).id, 't1')
})
