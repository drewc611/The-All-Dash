import { defineParser, defineMetric, defineCommand } from '../core/registry.js'
import { getState } from '../core/store.js'
import { ingestFile } from '../ingest/index.js'
import { q, daily } from '../core/query.js'
import { addDays, dayKey, startOfDay } from '../core/time.js'
import { isOn } from '../core/flags.js'
import { CHANNEL } from '../core/build.js'
import { getKey } from '../ai/keys.js'

/*
 * Telamate: a self-hosted AI front desk (web chat, SMS, voice, email), one
 * record per person, and a callback queue for the calls it could not close.
 *
 * Its server exports an All Dash entity array at /api/alldash/entities, so
 * nothing here maps anything: a callback is already a task, a conversation a
 * note, a contact a person, and each day of each counter a metric. What this
 * module adds is recognition (the Library names the file), three metrics with
 * the right goal direction, a command, and a pull on a timer. The widgets
 * are in telamate-widgets.jsx, next door, because they need JSX and this file
 * has to import under `node --test`.
 *
 * Gating: the widgets carry the `telamate` flag and the registry hides them
 * with it. The pull and the command check the same flag when they run. The
 * parser and the metrics register regardless - the registry has no flag on
 * those, and a metric over rows that are not there is a zero, not a surface.
 */

export const FLAG = 'telamate'
export const TELAMATE_KEY = 'telamate'
export const EXPORT_NAME = 'telamate-export.json'
export const CHANNEL_SERIES = ['Telamate chat', 'Telamate SMS', 'Telamate voice', 'Telamate email']

export const flagOn = () => isOn(FLAG, { channel: CHANNEL, overrides: getState().settings.flags })

// ----------------------------------------------------------------- parser

/** A Telamate export is a bare array whose first record says where it came from. */
export function isTelamateExport(text) {
  const t = String(text || '').trim()
  if (!t.startsWith('[')) return false
  try {
    const data = JSON.parse(t)
    return Array.isArray(data) && data.length > 0 && data[0]?.meta?.origin === 'telamate'
  } catch {
    return false
  }
}

/** The array, with the source filled in. Ids come from Telamate and stay. */
export function readExport(text, source = {}) {
  const data = JSON.parse(String(text || '').trim())
  if (!Array.isArray(data)) return []
  return data
    .filter((r) => r && typeof r === 'object' && r.meta?.origin === 'telamate')
    .map((r) => ({ ...r, ...(r.meta?.kind === 'metric' && r.meta.date ? { at: localNoon(r.meta.date) } : {}), source: { ...(r.source || {}), ...source } }))
}

/*
 * A daily counter means "this many on that calendar day at the business";
 * the export stamps it at noon UTC with the day in meta.date. Bucketing is
 * by the viewer's local day, so in Auckland noon UTC is tomorrow. Re-stamp
 * it at local noon of that date and the day the chart shows is the day the
 * front desk meant.
 */
function localNoon(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date))
  if (!m) return undefined
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).toISOString()
}

defineParser({
  id: 'telamate',
  name: 'Telamate export',
  extensions: ['.json'],
  priority: 60,
  match: ({ text }) => isTelamateExport(text),
  parse: ({ name, text, docId, kind }) => readExport(text, { docId, name, kind }),
})

// -------------------------------------------------------------- selectors

const list = (entities) => (Array.isArray(entities) ? entities : Object.values(entities || {}))
const isCallback = (e) => e.type === 'task' && e.meta?.kind === 'callback'

/** Open callbacks, soonest due first; the undated ones last. */
export function openCallbacks(entities) {
  return q(list(entities)).where(isCallback).open().sort('due').all()
}

export function overdueCallbacks(entities, now = new Date()) {
  const t = now.getTime()
  return openCallbacks(entities).filter((e) => e.due && new Date(e.due).getTime() < t)
}

/** Conversations today: the `Telamate conversations` point for today, or the
    threads whose last message was today when the counters are not there. */
export function conversationsToday(entities, now = new Date()) {
  const today = dayKey(now)
  const rows = list(entities)
  const counter = rows.find((e) => e.type === 'metric' && e.series === 'Telamate conversations' && e.at && dayKey(e.at) === today)
  if (counter) return Number(counter.value) || 0
  return rows.filter((e) => e.type === 'note' && e.meta?.kind === 'conversation' && e.at && dayKey(e.at) === today).length
}

/**
 * One row per day for the last `days` days, with a value per channel, so a
 * chart can stack them. Dense: a quiet day is four zeros, not a missing bar.
 */
export function channelSeries(entities, { days = 14, now = new Date() } = {}) {
  const to = startOfDay(now)
  const from = addDays(to, -(days - 1))
  const rows = list(entities).filter((e) => e.type === 'metric' && CHANNEL_SERIES.includes(e.series))
  const perSeries = CHANNEL_SERIES.map((name) => daily(rows.filter((e) => e.series === name), { from, to, reduce: 'sum' }))
  return perSeries[0].map((point, i) => ({
    key: point.key,
    values: CHANNEL_SERIES.map((name, s) => ({ name, value: perSeries[s][i]?.value || 0 })),
    total: perSeries.reduce((sum, series) => sum + (series[i]?.value || 0), 0),
  }))
}

const sumSeries = (name) => (entities, range) => {
  const rows = q(list(entities)).type('metric').series(name).between(range.from, range.to, 'at').all()
  return { value: rows.reduce((a, e) => a + (Number(e.value) || 0), 0), series: daily(rows, { from: range.from, to: range.to, reduce: 'sum' }) }
}

// ---------------------------------------------------------------- metrics

defineMetric({
  id: 'telamate-open-callbacks',
  name: 'Open callbacks',
  goal: 'down',
  compute: (entities, range) => {
    const rows = openCallbacks(entities)
    return { value: rows.length, series: daily(rows.filter((r) => r.due), { from: range.from, to: range.to, field: 'due' }) }
  },
})

defineMetric({
  id: 'telamate-conversations',
  name: 'Front desk conversations',
  goal: 'neutral',
  compute: sumSeries('Telamate conversations'),
})

defineMetric({
  id: 'telamate-callbacks-closed',
  name: 'Callbacks closed',
  goal: 'up',
  compute: sumSeries('Telamate callbacks closed'),
})

// ------------------------------------------------------------------- sync

/** What the Settings card saved, plus the token from the key store. */
export function telamateConfig(state = getState()) {
  const settings = state.settings.telamate || {}
  return {
    url: String(settings.url || '').trim(),
    token: getKey(TELAMATE_KEY),
    everyMinutes: Number.isFinite(Number(settings.everyMinutes)) ? Math.max(0, Number(settings.everyMinutes)) : 5,
  }
}

/**
 * Pull the array and fold it in through the same path a dropped file takes,
 * under one fixed document name. That is what makes the pull idempotent:
 * the document's identity is its name, so every pull replaces the previous
 * one's records rather than adding to them, and ids from Telamate are kept
 * so a callback somebody marked done by hand stays done (mergeEntity).
 *
 * @returns {Promise<{entities: object[], doc: object}>}
 */
export async function syncTelamate({ url, token, fetcher = globalThis.fetch } = telamateConfig()) {
  if (!url) throw new Error('No Telamate URL set')
  const headers = { Accept: 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetcher(url, { headers })
  if (!response.ok) throw new Error(`Telamate answered ${response.status}`)
  const text = await response.text()
  if (!isTelamateExport(text)) throw new Error('Not a Telamate export')
  return ingestFile(new File([text], EXPORT_NAME, { type: 'application/json' }), { url })
}

/**
 * Pull on load and then every `everyMinutes`, re-reading the setting each
 * time so a change in Settings takes effect at the next tick without a
 * reload. Failure is a console line and nothing else: a front desk that is
 * unreachable for a minute is not a problem the dashboard should shout about.
 *
 * @returns {() => void} stop
 */
export function startTelamateSync({ now = () => Date.now() } = {}) {
  let timer = null
  let stopped = false
  const tick = async () => {
    if (stopped) return
    const config = telamateConfig()
    if (config.url && flagOn()) {
      try { await syncTelamate(config) } catch (error) { console.warn('All Dash: Telamate pull failed', error?.message || error) }
    }
    const every = telamateConfig().everyMinutes
    if (every > 0 && !stopped) timer = setTimeout(tick, every * 60 * 1000)
  }
  tick()
  return () => { stopped = true; clearTimeout(timer) }
}

defineCommand({
  id: 'telamate-sync',
  name: 'Pull from Telamate now',
  hint: 'Fetch callbacks, conversations and counters from the front desk',
  keywords: ['telamate', 'front desk', 'callbacks', 'sync', 'refresh'],
  run: async ({ close }) => {
    close?.()
    const toast = (message, tone) => globalThis.dispatchEvent?.(new CustomEvent('alldash:toast', { detail: { message, tone } }))
    if (!flagOn()) return toast('Telamate is off in this build. Turn the flag on in Settings.', 'warning')
    try {
      const { entities } = await syncTelamate()
      toast(`Pulled ${entities.length} records from Telamate.`, 'good')
    } catch (error) {
      toast(error.message, 'critical')
    }
  },
})
