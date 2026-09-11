/*
 * The router.
 *
 * Deciding is separated from doing, the same way the board rule engine is:
 * this module returns an ordered plan of attempts and the reason for each,
 * and something else performs them. That means the whole routing policy is a
 * pure function you can test, and - more usefully - that the app can show you
 * what it is *about* to do before it does it.
 *
 * Three things here are not in the gateways this was modelled on:
 *
 * 1. A failed attempt includes a graded failure, not only an HTTP error. See
 *    verify.js: a 200 that cites a task you do not have is a failure.
 * 2. The plan is visible up front, with the cost of each step, so "fall back
 *    to the expensive model" is a decision rather than a surprise on a bill.
 * 3. A provider that keeps failing is skipped for a cooldown instead of being
 *    retried into the ground on every request.
 */

import { provider as providerSpec, supports, endpointFor } from './catalogue.js'
import { estimate } from './cost.js'

export const DEFAULT_POLICY = {
  // Ordered. The first that can run, runs.
  chain: [],
  // Round-robin across several keys for the same provider, which is what
  // "load balancing" means when one person owns all the keys: it spreads rate
  // limits, and nothing else.
  spreadKeys: true,
  maxAttempts: 3,
  // After this many consecutive failures a provider is rested.
  breakAfter: 3,
  cooldownMs: 5 * 60_000,
}

/** Health is remembered per provider, not per model: a rate limit or an
    outage belongs to the account, and every model behind it is affected. */
export const emptyHealth = () => ({})

export function recordOutcome(health, providerId, { ok, at = Date.now() }) {
  const next = { ...health }
  const current = next[providerId] || { fails: 0, openedAt: 0, lastAt: 0 }
  next[providerId] = ok
    ? { fails: 0, openedAt: 0, lastAt: at }
    : { fails: current.fails + 1, openedAt: current.openedAt || 0, lastAt: at }
  return next
}

/** Is this provider rested right now, and until when? */
export function circuitOpen(health, providerId, { breakAfter, cooldownMs, now = Date.now() } = DEFAULT_POLICY) {
  const state = health?.[providerId]
  if (!state || state.fails < (breakAfter ?? DEFAULT_POLICY.breakAfter)) return null
  const until = state.lastAt + (cooldownMs ?? DEFAULT_POLICY.cooldownMs)
  return now < until ? { until, fails: state.fails } : null
}

/**
 * Build the plan.
 *
 * Every step carries why it was chosen and what it would cost, and every step
 * that was *not* chosen carries why not - because "it silently skipped my
 * expensive model" is the single most confusing thing a router can do.
 */
export function plan({
  chain = [],
  request = {},
  keys = {},
  health = {},
  modes = ['text'],
  now = Date.now(),
  maxAttempts = DEFAULT_POLICY.maxAttempts,
  breakAfter = DEFAULT_POLICY.breakAfter,
  cooldownMs = DEFAULT_POLICY.cooldownMs,
  spreadKeys = true,
  offline = false,
} = {}) {
  const attempts = []
  const skipped = []
  const used = new Map()

  for (const step of chain) {
    if (attempts.length >= maxAttempts) {
      skipped.push({ ...step, why: `past the ${maxAttempts}-attempt limit` })
      continue
    }
    const spec = providerSpec(step.provider)
    if (!spec) { skipped.push({ ...step, why: 'no such provider' }); continue }

    if (offline && !spec.local) { skipped.push({ ...step, why: 'the network is down and this provider is not local' }); continue }

    const available = keys[step.provider] || []
    if (spec.needsKey && !available.length) {
      skipped.push({ ...step, why: 'no API key for this provider' })
      continue
    }

    if (!supports(step.provider, step.model, modes)) {
      skipped.push({ ...step, why: `this model does not take ${modes.filter((mode) => mode !== 'text').join(' or ') || 'that input'}` })
      continue
    }

    const open = circuitOpen(health, step.provider, { breakAfter, cooldownMs, now })
    if (open) {
      skipped.push({ ...step, why: `rested after ${open.fails} failures in a row`, until: open.until })
      continue
    }

    const pre = estimate({ ...request, provider: step.provider, model: step.model })
    if (!pre.contextFits) {
      skipped.push({ ...step, why: `the request is larger than this model's ${pre.context?.toLocaleString()}-token window` })
      continue
    }

    // Rotate, so two calls in a row do not land on the same key.
    const turn = used.get(step.provider) || 0
    used.set(step.provider, turn + 1)
    const keyAlias = spreadKeys ? available[turn % available.length] : available[0]

    attempts.push({
      provider: step.provider,
      model: step.model,
      keyAlias: keyAlias || null,
      wire: spec.wire,
      // Never the step's own string: for a named vendor the catalogue wins,
      // so a restored chain cannot aim a key at somebody else's server.
      baseUrl: endpointFor(step.provider, step.baseUrl),
      estimate: pre,
      why: attempts.length === 0 ? 'first choice' : `fallback ${attempts.length}`,
    })
  }

  return {
    attempts,
    skipped,
    // What it costs if the first attempt works, and if every one has to run.
    best: attempts[0]?.estimate?.dollars ?? null,
    worst: attempts.reduce((total, step) => (
      total === null || step.estimate.dollars === null ? null : total + step.estimate.dollars
    ), 0),
    runnable: attempts.length > 0,
    reason: attempts.length ? '' : describeEmpty(skipped),
  }
}

function describeEmpty(skipped) {
  if (!skipped.length) return 'No providers are configured. Add one in Settings → Assistant.'
  const why = skipped[0].why
  return skipped.length === 1
    ? `The only provider in your chain was skipped: ${why}.`
    : `Every provider in your chain was skipped. The first, because ${why}.`
}

/**
 * A sensible chain from whatever the person has keys for.
 *
 * Cheap and fast first, capable second, local last - because the local model
 * is the only one that still answers when the network is gone, which makes it
 * the right floor rather than the right default.
 */
export function suggestChain(keys = {}, { prefer = 'balanced' } = {}) {
  const has = (id) => (keys[id] || []).length > 0 || id === 'ollama' || id === 'lmstudio'
  const order = prefer === 'cheap'
    ? [
      ['groq', 'llama-3.1-8b-instant'],
      ['cerebras', 'llama3.1-8b'],
      ['openai', 'gpt-4.1-mini'],
      ['anthropic', 'claude-haiku-4-5'],
      ['ollama', 'llama3.1'],
    ]
    : [
      ['anthropic', 'claude-sonnet-5'],
      ['openai', 'gpt-4.1'],
      ['groq', 'llama-3.3-70b-versatile'],
      ['mistral', 'mistral-large-latest'],
      ['ollama', 'llama3.1'],
    ]
  return order.filter(([id]) => has(id)).map(([provider, model]) => ({ provider, model }))
}

/** One line describing a plan, for the panel. */
export function describePlan(built) {
  if (!built?.runnable) return built?.reason || 'Nothing to run.'
  const [first, ...rest] = built.attempts
  const head = `${first.provider}/${first.model}`
  if (!rest.length) return `${head}, with nothing to fall back to.`
  return `${head}, falling back to ${rest.map((step) => `${step.provider}/${step.model}`).join(', then ')}.`
}
