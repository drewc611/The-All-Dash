import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isTelamateExport, readExport, openCallbacks, overdueCallbacks, conversationsToday, channelSeries,
  syncTelamate, telamateConfig, EXPORT_NAME, CHANNEL_SERIES,
} from '../src/integrations/telamate.js'
import { listParsers, getMetric, listCommands } from '../src/core/registry.js'
import { pickParser } from '../src/ingest/index.js'
import { evaluate } from '../src/engine/metrics.js'
import { getState, clearWorkspace, updateEntity } from '../src/core/store.js'
import { normaliseSettings } from '../src/core/settings-schema.js'
import { REGISTRY } from '../src/core/flags.js'
import { addDays, iso, dayKey, rangeFor } from '../src/core/time.js'

const at = (offset) => iso(addDays(new Date(), offset))
const noon = (offset) => `${dayKey(addDays(new Date(), offset))}T12:00:00Z`

const source = { name: 'Telamate', kind: 'telamate', url: 'https://desk.example/api/alldash/entities' }
const tm = (kind, extra) => ({ tags: ['telamate'], people: [], source, confidence: 1, ...extra, meta: { origin: 'telamate', kind, ...(extra.meta || {}) } })

/** A small export shaped exactly as docs/API.md in the Telamate repo says. */
const fixture = () => [
  tm('callback', { id: 'tm-cb-1', type: 'task', title: 'Call back Dana Ruiz', due: at(-1), status: 'open', priority: 1, people: ['Dana Ruiz'], tags: ['telamate', 'callback', 'sms'], meta: { id: 1, contactId: 3, phone: '+15125550143' } }),
  tm('callback', { id: 'tm-cb-2', type: 'task', title: 'Call back Lee Park', due: at(2), status: 'open', people: ['Lee Park'], tags: ['telamate', 'callback', 'voice'], meta: { id: 2 } }),
  tm('callback', { id: 'tm-cb-3', type: 'task', title: 'Call back Sam Ortiz', due: at(1), status: 'open', people: ['Sam Ortiz'], tags: ['telamate', 'callback', 'chat'], meta: { id: 3 } }),
  tm('callback', { id: 'tm-cb-4', type: 'task', title: 'Call back Ana Silva', due: at(-3), status: 'done', people: ['Ana Silva'], tags: ['telamate', 'callback', 'email'], meta: { id: 4 } }),
  tm('conversation', { id: 'tm-th-7', type: 'note', title: 'SMS · Dana Ruiz', at: at(0), people: ['Dana Ruiz'], tags: ['telamate', 'conversation', 'sms'], meta: { id: 7, channels: ['sms'], messageCount: 4, status: 'open' } }),
  tm('contact', { id: 'tm-ct-3', type: 'person', title: 'Dana Ruiz', body: '+15125550143', meta: { id: 3, phones: ['+15125550143'], emails: [] } }),
  ...[0, -1, -2].flatMap((d) => [
    tm('metric', { id: `tm-m-conversations-${dayKey(addDays(new Date(), d))}`, type: 'metric', title: 'Telamate conversations', series: 'Telamate conversations', at: noon(d), value: 5 + d, unit: '' }),
    tm('metric', { id: `tm-m-callbacks-closed-${dayKey(addDays(new Date(), d))}`, type: 'metric', title: 'Telamate callbacks closed', series: 'Telamate callbacks closed', at: noon(d), value: 2, unit: '' }),
    tm('metric', { id: `tm-m-chat-${dayKey(addDays(new Date(), d))}`, type: 'metric', title: 'Telamate chat', series: 'Telamate chat', at: noon(d), value: 3, unit: '' }),
    tm('metric', { id: `tm-m-sms-${dayKey(addDays(new Date(), d))}`, type: 'metric', title: 'Telamate SMS', series: 'Telamate SMS', at: noon(d), value: 1, unit: '' }),
  ]),
]

const asText = (rows) => JSON.stringify(rows)
const range = () => rangeFor('7d')

/* ------------------------------------------------------------ the parser */

test('the parser recognises a Telamate export and not a random JSON array', () => {
  assert.equal(isTelamateExport(asText(fixture())), true)
  assert.equal(isTelamateExport(JSON.stringify([{ type: 'task', title: 'Plain entity' }])), false)
  assert.equal(isTelamateExport(JSON.stringify([{ id: 1, name: 'A record' }, { id: 2 }])), false)
  assert.equal(isTelamateExport(JSON.stringify({ meta: { origin: 'telamate' } })), false)
  assert.equal(isTelamateExport('[]'), false)
  assert.equal(isTelamateExport('not json'), false)
})

test('the Telamate parser outranks the generic JSON reader for its own file, and only its own', () => {
  const parser = listParsers().find((p) => p.id === 'telamate')
  assert.ok(parser)
  assert.equal(parser.priority, 60)
  assert.equal(pickParser({ name: 'telamate-export.json', text: asText(fixture()) }).id, 'telamate')
  assert.equal(pickParser({ name: 'issues.json', text: JSON.stringify([{ id: 1, title: 'x' }]) }).id, 'json')
})

test('parse keeps Telamate ids and stamps the source', () => {
  const rows = readExport(asText(fixture()), { docId: 'doc_x', name: 'telamate-export.json', kind: 'telamate' })
  assert.equal(rows.length, fixture().length)
  assert.equal(rows[0].id, 'tm-cb-1')
  assert.equal(rows[0].source.docId, 'doc_x')
  assert.equal(rows[0].source.url, source.url)
})

/* ----------------------------------------------------------- the metrics */

test('the metrics compute the right numbers from the fixture', () => {
  const rows = fixture()
  const open = evaluate('telamate-open-callbacks', rows, range())
  assert.equal(open.value, 3)
  assert.equal(open.goal, 'down')

  const conversations = evaluate('telamate-conversations', rows, range())
  assert.equal(conversations.value, 5 + 4 + 3)
  assert.equal(conversations.goal, 'neutral')
  const today = conversations.series.find((p) => p.key === dayKey(new Date()))
  assert.equal(today.value, 5)
  assert.equal(conversations.series.filter((p) => p.value).length, 3)

  const closed = evaluate('telamate-callbacks-closed', rows, range())
  assert.equal(closed.value, 6)
  assert.equal(closed.goal, 'up')
  assert.equal(getMetric('telamate-callbacks-closed').goal, 'up')
})

test('conversations today reads the counter first and falls back to threads', () => {
  assert.equal(conversationsToday(fixture()), 5)
  const withoutCounters = fixture().filter((e) => e.type !== 'metric')
  assert.equal(conversationsToday(withoutCounters), 1)
})

test('channel series is dense across fourteen days and stacks in channel order', () => {
  const days = channelSeries(fixture(), { days: 14 })
  assert.equal(days.length, 14)
  assert.equal(days.at(-1).key, dayKey(new Date()))
  assert.deepEqual(days.at(-1).values.map((v) => v.name), CHANNEL_SERIES)
  assert.deepEqual(days.at(-1).values.map((v) => v.value), [3, 1, 0, 0])
  assert.equal(days.at(-1).total, 4)
  assert.equal(days[0].total, 0)
})

/* -------------------------------------------------------- the queue widget */

test('the queue selector returns open callbacks sorted by due, overdue first', () => {
  const rows = openCallbacks(fixture())
  assert.deepEqual(rows.map((r) => r.id), ['tm-cb-1', 'tm-cb-3', 'tm-cb-2'])
  assert.ok(rows.every((r) => r.status !== 'done'))
  assert.deepEqual(overdueCallbacks(fixture()).map((r) => r.id), ['tm-cb-1'])
})

test('a task that is not a callback stays out of the queue', () => {
  const rows = [...fixture(), { id: 'other', type: 'task', title: 'Unrelated', status: 'open', due: at(-5), tags: [], people: [], meta: {} }]
  assert.equal(openCallbacks(rows).some((r) => r.id === 'other'), false)
})

/* ------------------------------------------------------------- the sync */

const fetcher = (rows) => async (url, { headers }) => ({ ok: true, status: 200, headers, url, text: async () => asText(rows) })

test('the sync folds entities with stable ids: pulling twice gives the same count', async () => {
  clearWorkspace()
  const first = await syncTelamate({ url: source.url, token: 't0k', fetcher: fetcher(fixture()) })
  assert.equal(first.doc.title, EXPORT_NAME)
  assert.equal(first.parser.id, 'telamate')
  const countAfterFirst = Object.keys(getState().entities).length
  assert.equal(countAfterFirst, fixture().length + 1, 'every record, plus the document itself')
  assert.ok(getState().entities['tm-cb-1'])

  const second = await syncTelamate({ url: source.url, token: 't0k', fetcher: fetcher(fixture()) })
  assert.equal(Object.keys(getState().entities).length, countAfterFirst)
  assert.equal(second.entities.length, first.entities.length)
  assert.equal(getState().docs.filter((d) => d.title === EXPORT_NAME).length, 1)
})

test('a callback that disappears from the export is dropped; one marked done by hand stays done', async () => {
  clearWorkspace()
  await syncTelamate({ url: source.url, fetcher: fetcher(fixture()) })
  updateEntity('tm-cb-2', { status: 'done' })
  await syncTelamate({ url: source.url, fetcher: fetcher(fixture().filter((e) => e.id !== 'tm-cb-3')) })
  assert.equal(getState().entities['tm-cb-3'], undefined)
  assert.equal(getState().entities['tm-cb-2'].status, 'done')
  assert.deepEqual(openCallbacks(getState().entities).map((r) => r.id), ['tm-cb-1'])
})

test('the sync sends the bearer token and refuses a body that is not an export', async () => {
  clearWorkspace()
  let seen = null
  const spy = async (url, init) => { seen = init.headers; return { ok: true, status: 200, text: async () => asText(fixture()) } }
  await syncTelamate({ url: source.url, token: 'secret', fetcher: spy })
  assert.equal(seen.Authorization, 'Bearer secret')
  await assert.rejects(() => syncTelamate({ url: source.url, fetcher: fetcher([{ id: 1, name: 'x' }]) }), /Not a Telamate export/)
  await assert.rejects(() => syncTelamate({ url: '', fetcher: spy }), /No Telamate URL/)
  await assert.rejects(() => syncTelamate({ url: source.url, fetcher: async () => ({ ok: false, status: 401 }) }), /401/)
})

/* ---------------------------------------------------- flag, command, settings */

test('the flag is declared at beta and the command is registered', () => {
  assert.equal(REGISTRY.telamate.maturity, 'beta')
  assert.ok(listCommands().some((c) => c.id === 'telamate-sync'))
})

test('settings default to a five-minute pull and a restored file cannot set the URL', () => {
  clearWorkspace()
  assert.deepEqual(telamateConfig(), { url: '', token: '', everyMinutes: 5 })
  const base = { flags: {}, platform: { url: '' }, assistant: { baseUrl: '' }, media: { youtube: false, ffmpeg: false }, telamate: { url: '', everyMinutes: 5 } }
  const hostile = { telamate: { url: 'https://evil.example/entities', everyMinutes: 1 } }
  const untrusted = normaliseSettings(hostile, base, { trusted: false })
  assert.equal(untrusted.settings.telamate.url, '')
  assert.equal(untrusted.settings.telamate.everyMinutes, 1)
  assert.ok(untrusted.dropped.includes('the Telamate URL'))
  const trusted = normaliseSettings(hostile, base, { trusted: true })
  assert.equal(trusted.settings.telamate.url, 'https://evil.example/entities')
})
