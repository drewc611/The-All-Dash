/*
 * Running a plan.
 *
 * route.js decides, verify.js grades, cost.js prices, cache.js remembers.
 * This is the only piece that performs anything, and it is deliberately thin:
 * walk the attempts, grade each reply, stop at the first good one, and write
 * down what happened either way.
 *
 * The order matters. The cache is consulted before the budget, because a hit
 * costs nothing and refusing a free answer on budget grounds would be absurd.
 * The budget is checked before the call, not after.
 */

import { stream } from './providers.js'
import { grade, shouldFallBack } from './verify.js'
import { plan as buildPlan, recordOutcome } from './route.js'
import { estimate, checkBudget, ledgerEntry } from './cost.js'
import { cacheKey, groundingFingerprint, read as cacheRead, put as cachePut } from './cache.js'
import { getKey } from './keys.js'
import { provider as providerSpec } from './catalogue.js'

export class BudgetError extends Error {
  constructor(verdict) {
    super(verdict.reason)
    this.name = 'BudgetError'
    this.verdict = verdict
  }
}

export class NoRouteError extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'NoRouteError'
  }
}

/**
 * Ask, with fallbacks, grading, caching and a ceiling.
 *
 * Returns { text, provider, model, attempts, cached, verdict, calls } where
 * `calls` is the ledger rows to record — written by the caller so this stays
 * free of store writes and testable on its own.
 */
export async function run({
  question,
  system,
  messages,
  chain,
  keys = {},
  health = {},
  contextEntities = [],
  known = null,
  modes = ['text'],
  maxTokens = 4096,
  budget = null,
  ledger = [],
  useCache = true,
  expectActions = false,
  onDelta,
  onAttempt,
  signal,
  now = () => Date.now(),
}) {
  const calls = []
  let nextHealth = health

  const grounding = groundingFingerprint(contextEntities)
  const request = { system, messages, maxTokens }

  const built = buildPlan({
    chain,
    request,
    keys,
    health,
    modes,
    maxAttempts: budget?.maxAttempts ?? 3,
    offline: typeof navigator !== 'undefined' && navigator.onLine === false,
  })
  if (!built.runnable) throw new NoRouteError(built.reason)

  // A hit is free, so it is looked for before anything is refused on cost.
  if (useCache) {
    for (const attempt of built.attempts) {
      const key = cacheKey({ question, provider: attempt.provider, model: attempt.model, system, grounding })
      const hit = await cacheRead(key)
      if (!hit) continue
      onDelta?.(hit.text, hit.text)
      calls.push(ledgerEntry({
        provider: attempt.provider,
        model: attempt.model,
        inputTokens: hit.inputTokens,
        outputTokens: hit.outputTokens,
        ms: 0,
        verdict: 'ok',
        cached: true,
      }))
      return {
        text: hit.text,
        provider: attempt.provider,
        model: attempt.model,
        attempts: 0,
        cached: true,
        verdict: { code: 'ok', ok: true },
        calls,
        health: nextHealth,
        plan: built,
      }
    }
  }

  const verdicts = []
  let lastError = null

  for (let i = 0; i < built.attempts.length; i += 1) {
    const attempt = built.attempts[i]
    if (i > 0 && !shouldFallBack(verdicts)) break

    const pre = attempt.estimate
    if (budget?.limit) {
      const allowed = checkBudget({
        estimate: pre,
        limit: budget.limit,
        period: budget.period,
        calls: ledger,
        allowUnpriced: budget.allowUnpriced,
      })
      // A ceiling refuses; it does not quietly pick a cheaper model on your
      // behalf, because that changes the answer without telling you.
      if (!allowed.ok) throw new BudgetError(allowed)
    }

    const spec = providerSpec(attempt.provider)
    const apiKey = spec?.needsKey ? getKey(attempt.keyAlias || attempt.provider) : ''
    if (spec?.needsKey && !apiKey) {
      verdicts.push({ code: 'empty', retry: true, reason: 'the key for this provider is gone' })
      continue
    }

    onAttempt?.({ ...attempt, index: i, total: built.attempts.length })
    const startedAt = now()
    let result = null
    let failure = null

    try {
      result = await stream({
        provider: attempt.wire,
        baseUrl: attempt.baseUrl,
        model: attempt.model,
        apiKey,
        system,
        messages,
        signal,
        maxTokens,
      }, onDelta)
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      failure = error
    }

    const ms = now() - startedAt

    if (failure) {
      lastError = failure
      verdicts.push({ code: 'transport', retry: true, reason: failure.message })
      nextHealth = recordOutcome(nextHealth, attempt.provider, { ok: false })
      calls.push(ledgerEntry({
        provider: attempt.provider, model: attempt.model, ms,
        verdict: 'transport', attempt: i + 1, error: failure.message,
        inputTokens: pre.inputTokens,
      }))
      continue
    }

    const verdict = grade(result.text, { known, stop: result.stop, expectActions })
    verdicts.push(verdict)
    const outputTokens = Math.ceil(String(result.text || '').length / 4)

    calls.push(ledgerEntry({
      provider: attempt.provider,
      model: attempt.model,
      inputTokens: pre.inputTokens,
      outputTokens,
      ms,
      verdict: verdict.code,
      attempt: i + 1,
    }))

    if (verdict.ok) {
      nextHealth = recordOutcome(nextHealth, attempt.provider, { ok: true })
      if (useCache) {
        await cachePut(
          cacheKey({ question, provider: attempt.provider, model: attempt.model, system, grounding }),
          { text: result.text, provider: attempt.provider, model: attempt.model, inputTokens: pre.inputTokens, outputTokens, question },
        )
      }
      return {
        text: result.text,
        stop: result.stop,
        provider: attempt.provider,
        model: attempt.model,
        attempts: i + 1,
        cached: false,
        verdict,
        calls,
        health: nextHealth,
        plan: built,
      }
    }

    // A graded failure is still a failure of that provider for this request,
    // so it counts against its health exactly as a 500 would.
    nextHealth = recordOutcome(nextHealth, attempt.provider, { ok: false })
    lastError = new Error(verdict.reason || verdict.label)
  }

  const error = new Error(
    verdicts.length
      ? `Every provider failed. The last said: ${lastError?.message || verdicts.at(-1)?.reason || 'no reason given'}`
      : 'No provider was reachable.',
  )
  error.calls = calls
  error.health = nextHealth
  error.verdicts = verdicts
  throw error
}

/** What a run would do, without doing it: for the panel's "before you ask". */
export function preview({ chain, keys, health, system, messages, maxTokens = 4096, modes = ['text'] }) {
  return buildPlan({ chain, keys, health, modes, request: { system, messages, maxTokens } })
}

export { estimate }
