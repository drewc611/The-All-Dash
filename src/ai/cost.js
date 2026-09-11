/*
 * What a call costs, before it is made.
 *
 * Every gateway I have read reports spend after the fact: you discover the
 * bill by receiving it. The useful moment is earlier - before the request -
 * because that is the only point at which anyone can still decide not to.
 *
 * So the estimate is computed up front, shown up front, and a ceiling
 * *refuses* rather than warns. A budget that only warns is a log line.
 */

import { model as modelSpec } from './catalogue.js'

/**
 * Tokens in a string, without a tokeniser.
 *
 * Byte-pair encoders differ per model and none of them ship in 40KB, so this
 * is a heuristic and is labelled as one everywhere it surfaces. It is built
 * from the two things that actually predict BPE length in English: about four
 * characters per token, and a floor of roughly one token per whitespace word
 * for text full of short words.
 *
 * It runs ~10% high on prose and higher on code, which is the direction an
 * estimate should err when it gates spending.
 */
export function estimateTokens(text) {
  const value = String(text ?? '')
  if (!value) return 0
  const chars = value.length / 4
  const words = value.trim() ? value.trim().split(/\s+/).length : 0
  return Math.max(1, Math.ceil(Math.max(chars, words)))
}

export const countMessages = (messages = []) =>
  messages.reduce((n, msg) => n + estimateTokens(typeof msg === 'string' ? msg : msg?.content) + 4, 0)

/** Dollars for a known token count. Returns null when the model is unpriced,
    which callers must show as "unknown" rather than as zero. */
export function priceOf({ provider, model, inputTokens = 0, outputTokens = 0 }) {
  const spec = modelSpec(provider, model)
  if (!spec) return null
  return (inputTokens / 1_000_000) * spec.in + (outputTokens / 1_000_000) * spec.out
}

/**
 * The pre-flight estimate.
 *
 * Output is unknown before the call, so the caller's cap is used: this is the
 * worst case, not a guess at the likely case. A ceiling has to be checked
 * against the most it could cost or it is not a ceiling.
 */
export function estimate({ provider, model, system = '', messages = [], maxTokens = 4096 }) {
  const inputTokens = estimateTokens(system) + countMessages(messages)
  const spec = modelSpec(provider, model)
  const outputTokens = spec ? Math.min(maxTokens, spec.context) : maxTokens
  const dollars = priceOf({ provider, model, inputTokens, outputTokens })
  return {
    inputTokens,
    outputTokens,
    dollars,
    known: dollars !== null,
    // Free is a real answer, not a missing one: a local model costs nothing.
    free: dollars === 0,
    contextFits: spec ? inputTokens < spec.context : true,
    context: spec?.context || null,
  }
}

/** Dollars, at the precision the number deserves. Four figures below a cent,
    because "$0.00" for a real charge reads as free. */
export function formatCost(dollars) {
  if (dollars === null || dollars === undefined || !Number.isFinite(dollars)) return 'unknown'
  if (dollars === 0) return 'free'
  if (dollars < 0.01) return `$${dollars.toFixed(4)}`
  if (dollars < 1) return `$${dollars.toFixed(3)}`
  return `$${dollars.toFixed(2)}`
}

/* ------------------------------------------------------------------ budget */

export const PERIODS = ['day', 'week', 'month']

/** The window a budget is measured over, as an ISO instant. */
export function windowStart(period, now = new Date()) {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  if (period === 'week') {
    // Monday, matching the rest of the app's week.
    const day = (date.getDay() + 6) % 7
    date.setDate(date.getDate() - day)
  } else if (period === 'month') {
    date.setDate(1)
  }
  return date.toISOString()
}

/** What has been spent in the current window. */
export function spentSince(calls, since) {
  return (calls || [])
    .filter((call) => call?.at >= since && Number.isFinite(call?.dollars))
    .reduce((total, call) => total + call.dollars, 0)
}

/**
 * Decide whether a call may proceed.
 *
 * Three outcomes, not two. "over" refuses. "unknown" is the interesting one:
 * an unpriced model under an active ceiling cannot be checked, and silently
 * allowing it would make the ceiling a decoration - so it is surfaced and the
 * person decides once, per model.
 */
export function checkBudget({ estimate: pre, limit, period = 'day', calls = [], now = new Date(), allowUnpriced = false }) {
  if (!limit || limit <= 0) return { ok: true, reason: 'no ceiling set' }
  const since = windowStart(period, now)
  const spent = spentSince(calls, since)

  if (!pre?.known) {
    return allowUnpriced
      ? { ok: true, spent, limit, reason: 'this model has no price, and you allowed that' }
      : {
        ok: false,
        code: 'unknown',
        spent,
        limit,
        reason: 'This model has no price in the catalogue, so the ceiling cannot be checked. Price it in Settings, or allow unpriced calls.',
      }
  }

  const after = spent + pre.dollars
  if (after > limit) {
    return {
      ok: false,
      code: 'over',
      spent,
      limit,
      would: after,
      reason: `This would take the ${period} to ${formatCost(after)}, past your ${formatCost(limit)} ceiling.`,
    }
  }
  return { ok: true, spent, limit, would: after, remaining: limit - after }
}

/** One line in the ledger. Written after the call, with what it really cost. */
export function ledgerEntry({
  provider, model, at = new Date().toISOString(), inputTokens = 0, outputTokens = 0,
  ms = 0, verdict = 'ok', attempt = 1, cached = false, error = '',
}) {
  return {
    provider,
    model,
    at,
    inputTokens,
    outputTokens,
    // A cache hit costs nothing, and recording it as zero is what makes the
    // cache's value visible in the same units as the spend it avoided.
    dollars: cached ? 0 : priceOf({ provider, model, inputTokens, outputTokens }),
    saved: cached ? priceOf({ provider, model, inputTokens, outputTokens }) : 0,
    ms,
    verdict,
    attempt,
    cached,
    error: String(error || '').slice(0, 300),
  }
}

/**
 * Per-provider report: what each one costs, how fast it is, and how often it
 * came back good. The last column is the one no gateway shows, and it is the
 * only one that says whether the cheap provider is actually cheaper.
 */
export function summarise(calls, { since = '' } = {}) {
  const rows = new Map()
  for (const call of calls || []) {
    if (since && call.at < since) continue
    const key = `${call.provider}/${call.model}`
    if (!rows.has(key)) {
      rows.set(key, {
        key, provider: call.provider, model: call.model,
        calls: 0, good: 0, cached: 0, dollars: 0, saved: 0, ms: 0, timed: 0, tokens: 0,
      })
    }
    const row = rows.get(key)
    row.calls += 1
    if (call.verdict === 'ok') row.good += 1
    if (call.cached) row.cached += 1
    if (Number.isFinite(call.dollars)) row.dollars += call.dollars
    if (Number.isFinite(call.saved)) row.saved += call.saved
    if (call.ms > 0 && !call.cached) { row.ms += call.ms; row.timed += 1 }
    row.tokens += (call.inputTokens || 0) + (call.outputTokens || 0)
  }
  return [...rows.values()]
    .map((row) => ({
      ...row,
      goodRate: row.calls ? row.good / row.calls : 0,
      averageMs: row.timed ? Math.round(row.ms / row.timed) : 0,
      // What a usable answer actually cost, which is the only honest unit
      // when a provider is cheap and wrong a third of the time.
      perGoodAnswer: row.good ? row.dollars / row.good : null,
    }))
    .sort((a, b) => b.calls - a.calls)
}
