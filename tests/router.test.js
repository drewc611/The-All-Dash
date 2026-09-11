import test from 'node:test'
import assert from 'node:assert/strict'

import { PROVIDERS, provider, model, allModels, supports, cheapest, wireOf, isLocal, endpointFor, usesCustomEndpoint } from '../src/ai/catalogue.js'
import { estimateTokens, countMessages, priceOf, estimate, formatCost, windowStart, spentSince, checkBudget, ledgerEntry, summarise } from '../src/ai/cost.js'
import { grade, shouldFallBack, GRADES } from '../src/ai/verify.js'
import { plan, recordOutcome, circuitOpen, emptyHealth, suggestChain, describePlan, DEFAULT_POLICY } from '../src/ai/route.js'
import { normaliseQuestion, hash, groundingFingerprint, cacheKey } from '../src/ai/cache.js'
import { normaliseRouter } from '../src/ai/router-schema.js'

/* --------------------------------------------------------------- catalogue */

test('most providers are one wire format, not one integration each', () => {
  const openai = PROVIDERS.filter((p) => p.wire === 'openai')
  assert.ok(openai.length >= 8, 'the OpenAI shape carries most of the list')
  assert.equal(wireOf('anthropic'), 'anthropic')
  assert.equal(wireOf('ollama'), 'ollama')
  assert.equal(wireOf('groq'), 'openai')
  // An unknown id must not crash a caller; it falls back to the common shape.
  assert.equal(wireOf('nonsense'), 'openai')
})

test('every catalogue entry is complete enough to route to', () => {
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.label, `${p.id} needs a label`)
    assert.ok(['openai', 'anthropic', 'ollama'].includes(p.wire), `${p.id} wire`)
    assert.equal(typeof p.needsKey, 'boolean', `${p.id} needsKey`)
    for (const entry of p.models) {
      assert.ok(entry.id && entry.label, `${p.id}/${entry.id} label`)
      assert.ok(Number.isFinite(entry.in) && entry.in >= 0, `${p.id}/${entry.id} input price`)
      assert.ok(Number.isFinite(entry.out) && entry.out >= 0, `${p.id}/${entry.id} output price`)
      assert.ok(entry.context > 0, `${p.id}/${entry.id} context`)
      assert.ok(entry.modes.includes('text'), `${p.id}/${entry.id} must do text`)
    }
  }
})

test('local providers are marked, because they are the ones that work offline', () => {
  assert.equal(isLocal('ollama'), true)
  assert.equal(isLocal('lmstudio'), true)
  assert.equal(isLocal('anthropic'), false)
})

test('a model nobody priced is null, not a guess', () => {
  assert.equal(model('anthropic', 'claude-sonnet-5').in, 3)
  assert.equal(model('anthropic', 'no-such-model'), null)
  assert.equal(model('no-such-provider', 'x'), null)
})

test('capability is assumed absent rather than present', () => {
  assert.equal(supports('anthropic', 'claude-sonnet-5', ['text', 'image']), true)
  assert.equal(supports('groq', 'llama-3.3-70b-versatile', ['text']), true)
  assert.equal(supports('groq', 'llama-3.3-70b-versatile', ['image']), false)
  // An unlisted model gets text only: a needless fallback beats a wrong 400.
  assert.equal(supports('custom', 'whatever', ['text']), true)
  assert.equal(supports('custom', 'whatever', ['image']), false)
})

test('the cheapest capable model is findable', () => {
  const list = cheapest(['text'])
  assert.ok(list.length > 3)
  for (let i = 1; i < list.length; i += 1) {
    assert.ok((list[i - 1].in + list[i - 1].out) <= (list[i].in + list[i].out), 'sorted by price')
  }
  assert.ok(cheapest(['image']).every((entry) => entry.modes.includes('image')))
  assert.ok(allModels().length >= PROVIDERS.reduce((n, p) => n + p.models.length, 0))
})

test('a named vendor ignores any endpoint a chain step asks for', () => {
  // This is the control that stops a restored workspace aiming an API key at
  // somebody else's server: for a vendor with a fixed address, the catalogue
  // wins outright and the step's own string is never used.
  assert.equal(endpointFor('anthropic', 'https://collect.evil.tld'), provider('anthropic').baseUrl)
  assert.equal(endpointFor('openai', 'https://collect.evil.tld'), provider('openai').baseUrl)
  assert.equal(endpointFor('groq', 'http://127.0.0.1:9/v1'), provider('groq').baseUrl)
  assert.equal(usesCustomEndpoint('anthropic'), false)
})

test('a bring-your-own provider keeps the endpoint, because that is the feature', () => {
  assert.equal(usesCustomEndpoint('custom'), true)
  assert.equal(usesCustomEndpoint('azure'), true)
  assert.equal(endpointFor('custom', 'https://my-vllm.internal/v1'), 'https://my-vllm.internal/v1')
  assert.equal(endpointFor('ollama', 'http://localhost:11434'), 'http://localhost:11434')
  // A trailing slash is noise, and a scheme that is not http(s) is refused.
  assert.equal(endpointFor('custom', 'https://x.example/v1/'), 'https://x.example/v1')
  assert.equal(endpointFor('custom', 'javascript:alert(1)'), provider('custom').baseUrl)
  assert.equal(endpointFor('custom', 'not a url'), provider('custom').baseUrl)
  assert.equal(endpointFor('nope', 'https://x.example'), '')
})

test('a restored workspace cannot carry an endpoint at all', () => {
  const hostile = {
    chain: [
      { provider: 'anthropic', model: 'claude-sonnet-5', baseUrl: 'https://collect.evil.tld' },
      { provider: 'custom', model: 'gpt-4', baseUrl: 'https://collect.evil.tld/v1' },
    ],
  }

  // Trusted (the app's own storage): a bring-your-own override survives.
  const trusted = normaliseRouter(hostile)
  assert.equal(trusted.chain[0].baseUrl, '', 'a named vendor never keeps one')
  assert.equal(trusted.chain[1].baseUrl, 'https://collect.evil.tld/v1')

  // From a file: neither survives, so a key cannot be redirected by import.
  const imported = normaliseRouter(hostile, { trusted: false })
  assert.equal(imported.chain[0].baseUrl, '')
  assert.equal(imported.chain[1].baseUrl, '')
})

test('the plan sends a key only to the catalogue address for a named vendor', () => {
  const built = plan({
    chain: [{ provider: 'anthropic', model: 'claude-sonnet-5', baseUrl: 'https://collect.evil.tld' }],
    keys: { anthropic: ['main'] },
  })
  assert.equal(built.attempts.length, 1)
  assert.equal(built.attempts[0].baseUrl, provider('anthropic').baseUrl)
  assert.ok(!built.attempts[0].baseUrl.includes('evil'))
})

/* -------------------------------------------------------------------- cost */

test('token estimates err high, which is the right direction for a ceiling', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens(null), 0)
  assert.ok(estimateTokens('hello') >= 1)
  // ~4 chars per token, floored at one per word.
  const prose = 'the quick brown fox jumps over the lazy dog'
  assert.ok(estimateTokens(prose) >= 9, 'never below the word count')
  assert.ok(estimateTokens('a '.repeat(50)) >= 50, 'short words do not read as few tokens')
})

test('messages carry per-message overhead', () => {
  const one = countMessages([{ content: 'hello' }])
  const two = countMessages([{ content: 'hello' }, { content: 'hello' }])
  assert.ok(two > one * 1.5)
  assert.equal(countMessages([]), 0)
  assert.ok(countMessages(['a plain string']) > 0)
})

test('price is per million tokens on both sides', () => {
  const dollars = priceOf({ provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1_000_000, outputTokens: 1_000_000 })
  assert.equal(dollars, 18, '3 in + 15 out')
  assert.equal(priceOf({ provider: 'ollama', model: 'llama3.1', inputTokens: 9_999_999, outputTokens: 9_999_999 }), 0, 'local is free')
  assert.equal(priceOf({ provider: 'custom', model: 'unpriced', inputTokens: 100 }), null)
})

test('the estimate uses the output cap, because a ceiling checks the worst case', () => {
  const pre = estimate({ provider: 'anthropic', model: 'claude-opus-5', system: 'sys', messages: [{ content: 'hi' }], maxTokens: 1000 })
  assert.equal(pre.outputTokens, 1000)
  assert.ok(pre.dollars > 0)
  assert.equal(pre.known, true)
  assert.equal(pre.free, false)
  assert.equal(pre.contextFits, true)
})

test('a free model is free, which is different from unpriced', () => {
  const local = estimate({ provider: 'ollama', model: 'llama3.1', messages: [{ content: 'hi' }] })
  assert.equal(local.free, true)
  assert.equal(local.known, true)

  const unknown = estimate({ provider: 'custom', model: 'mystery', messages: [{ content: 'hi' }] })
  assert.equal(unknown.known, false)
  assert.equal(unknown.free, false)
  assert.equal(unknown.dollars, null)
})

test('an over-long request is caught before it is sent', () => {
  const huge = estimate({ provider: 'deepseek', model: 'deepseek-chat', messages: [{ content: 'x'.repeat(400_000) }] })
  assert.equal(huge.contextFits, false, '64k window, 100k tokens')
})

test('cost formatting never shows a real charge as free', () => {
  assert.equal(formatCost(0), 'free')
  assert.equal(formatCost(null), 'unknown')
  assert.equal(formatCost(undefined), 'unknown')
  assert.equal(formatCost(NaN), 'unknown')
  assert.equal(formatCost(0.0004), '$0.0004')
  assert.equal(formatCost(0.25), '$0.250')
  assert.equal(formatCost(12.5), '$12.50')
})

test('budget windows start at local midnight, where a person thinks they do', () => {
  // A "day" is the user's day, so the boundary is local midnight — which in
  // UTC+14 is the previous calendar date in UTC. Asserting on the UTC string
  // would only be testing the tester's timezone.
  const now = new Date('2026-09-11T15:30:00')

  const day = new Date(windowStart('day', now))
  assert.equal(day.getHours(), 0)
  assert.equal(day.getMinutes(), 0)
  assert.equal(day.getDate(), now.getDate())

  const week = new Date(windowStart('week', now))
  assert.equal(week.getDay(), 1, 'Monday, matching the rest of the app')
  assert.equal(week.getHours(), 0)
  assert.ok(week <= now && now - week < 7 * 86_400_000)

  const month = new Date(windowStart('month', now))
  assert.equal(month.getDate(), 1)
  assert.equal(month.getMonth(), now.getMonth())
  assert.equal(month.getHours(), 0)
})

test('the ceiling refuses rather than warns', () => {
  // Placed relative to the window rather than at a fixed UTC instant: a day
  // budget is deliberately the user's local day, so a hardcoded timestamp
  // only lands inside it in the timezone it was written in.
  const now = new Date('2026-09-11T12:00:00Z')
  const since = Date.parse(windowStart('day', now))
  const calls = [{ at: new Date(since + 60_000).toISOString(), dollars: 0.9 }]

  const verdict = checkBudget({ estimate: { known: true, dollars: 0.5 }, limit: 1, period: 'day', calls, now })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'over')
  assert.equal(verdict.spent, 0.9)
  assert.match(verdict.reason, /ceiling/)
})

test('yesterday\'s spend does not count against today\'s ceiling', () => {
  const now = new Date('2026-09-11T12:00:00Z')
  const since = Date.parse(windowStart('day', now))
  // One minute before the window opened.
  const calls = [{ at: new Date(since - 60_000).toISOString(), dollars: 99 }]

  const verdict = checkBudget({ estimate: { known: true, dollars: 0.5 }, limit: 1, period: 'day', calls, now })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.spent, 0)
})

test('spending under the ceiling proceeds, and says what is left', () => {
  const verdict = checkBudget({ estimate: { known: true, dollars: 0.1 }, limit: 1, calls: [], now: new Date() })
  assert.equal(verdict.ok, true)
  assert.ok(Math.abs(verdict.remaining - 0.9) < 1e-9)
})

test('no ceiling means no opinion', () => {
  assert.equal(checkBudget({ estimate: { known: true, dollars: 999 }, limit: 0 }).ok, true)
  assert.equal(checkBudget({ estimate: { known: true, dollars: 999 } }).ok, true)
})

test('an unpriced model under a ceiling is surfaced, not silently allowed', () => {
  const blocked = checkBudget({ estimate: { known: false, dollars: null }, limit: 5, calls: [] })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'unknown')

  const allowed = checkBudget({ estimate: { known: false, dollars: null }, limit: 5, calls: [], allowUnpriced: true })
  assert.equal(allowed.ok, true)
})

test('only spend inside the window counts', () => {
  const calls = [
    { at: '2026-09-01T00:00:00.000Z', dollars: 100 },
    { at: '2026-09-11T10:00:00.000Z', dollars: 2 },
    { at: '2026-09-11T11:00:00.000Z', dollars: 3 },
    { at: '2026-09-11T12:00:00.000Z', dollars: null },
  ]
  assert.equal(spentSince(calls, '2026-09-11T00:00:00.000Z'), 5, 'and an unpriced call adds nothing rather than NaN')
})

test('a cache hit records what it saved, in the same units as the spend', () => {
  const real = ledgerEntry({ provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1_000_000, outputTokens: 0 })
  assert.equal(real.dollars, 3)
  assert.equal(real.saved, 0)

  const hit = ledgerEntry({ provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 1_000_000, outputTokens: 0, cached: true })
  assert.equal(hit.dollars, 0)
  assert.equal(hit.saved, 3)
})

test('the per-provider report costs a usable answer, not a call', () => {
  const rows = summarise([
    ledgerEntry({ provider: 'groq', model: 'llama-3.1-8b-instant', inputTokens: 1_000_000, outputTokens: 1_000_000, ms: 100, verdict: 'ok' }),
    ledgerEntry({ provider: 'groq', model: 'llama-3.1-8b-instant', inputTokens: 1_000_000, outputTokens: 1_000_000, ms: 100, verdict: 'unresolved-citation' }),
    ledgerEntry({ provider: 'anthropic', model: 'claude-sonnet-5', inputTokens: 100_000, outputTokens: 10_000, ms: 900, verdict: 'ok' }),
  ])
  const groq = rows.find((r) => r.provider === 'groq')
  assert.equal(groq.calls, 2)
  assert.equal(groq.good, 1)
  assert.equal(groq.goodRate, 0.5)
  assert.equal(groq.averageMs, 100)
  // Both calls were paid for; only one produced an answer.
  assert.ok(Math.abs(groq.perGoodAnswer - groq.dollars) < 1e-9)
  assert.ok(groq.perGoodAnswer > groq.dollars / 2)
})

/* ------------------------------------------------------------------ verify */

test('a 200 with nothing in it is a failure', () => {
  const v = grade('')
  assert.equal(v.code, 'empty')
  assert.equal(v.ok, false)
  assert.equal(v.retry, true)
  assert.equal(grade('   ').code, 'empty')
})

test('hitting the token cap is a failure, not an answer', () => {
  const v = grade('The three things you need to do are, first', { stop: 'length' })
  assert.equal(v.code, 'truncated')
  assert.equal(grade('fine', { stop: 'max_tokens' }).code, 'truncated')
  assert.equal(grade('fine', { stop: 'end_turn' }).code, 'ok')
})

test('an answer citing something that does not exist is a failure', () => {
  const known = { ent_abc123: { id: 'ent_abc123' } }
  const good = grade('Your task [[ent_abc123]] is overdue.', { known })
  assert.equal(good.code, 'ok')
  assert.deepEqual(good.citations, ['ent_abc123'])

  const bad = grade('Your task [[ent_zzz999]] is overdue.', { known })
  assert.equal(bad.code, 'unresolved-citation')
  assert.equal(bad.retry, true)
  assert.deepEqual(bad.missing, ['ent_zzz999'])
})

test('without the workspace the citation check is skipped, not guessed', () => {
  assert.equal(grade('Cites [[ent_zzz999]] freely.').code, 'ok')
})

test('truncation is reported before a citation cut in half', () => {
  const known = { ent_abc123: {} }
  const v = grade('Have a look at [[ent_zz', { known, stop: 'length' })
  assert.equal(v.code, 'truncated', 'the real fault is the cap, not the citation')
})

test('a short refusal is a failure; a long answer that mentions limits is not', () => {
  assert.equal(grade("I'm sorry, but I can't help with that.").code, 'refusal')
  assert.equal(grade('As an AI I cannot do that.').code, 'refusal')
  const essay = `Here is the plan. ${'There are limits to what I can promise here. '.repeat(20)}`
  assert.equal(grade(essay).code, 'ok', 'length is what separates a refusal from a caveat')
})

test('malformed proposals fail only when proposals were claimed', () => {
  const known = { ent_abc123: {} }
  const broken = 'Doing it now.\n\n```actions\n[{"op":"update","id":"ent_nope","patch":{"status":"done"}}]\n```'
  assert.equal(grade(broken, { known, expectActions: true }).code, 'bad-action')
  // A plain answer with no actions is most answers.
  assert.equal(grade('Three things are overdue.', { known, expectActions: true }).code, 'ok')
})

test('every grade declares whether it is worth retrying', () => {
  for (const [code, spec] of Object.entries(GRADES)) {
    assert.equal(typeof spec.retry, 'boolean', code)
    assert.ok(spec.label, code)
  }
  assert.equal(GRADES.ok.retry, false)
})

test('falling back stops at the retry limit, and stops early on two refusals', () => {
  const retryable = { code: 'truncated', retry: true }
  assert.equal(shouldFallBack([]), true)
  assert.equal(shouldFallBack([retryable]), true)
  assert.equal(shouldFallBack([retryable, retryable]), true)
  assert.equal(shouldFallBack([retryable, retryable, retryable]), false, 'past maxRetries')
  assert.equal(shouldFallBack([{ code: 'ok', retry: false }]), false)

  const refusal = { code: 'refusal', retry: true }
  assert.equal(shouldFallBack([refusal]), true, 'one model declining might be that model')
  assert.equal(shouldFallBack([refusal, refusal]), false, 'two is a fact about the request')
})

/* ------------------------------------------------------------------- route */

const KEYS = { anthropic: ['main'], openai: ['work', 'personal'], groq: ['main'] }

test('the plan is ordered, and every step says why it is there', () => {
  const built = plan({
    chain: [
      { provider: 'groq', model: 'llama-3.1-8b-instant' },
      { provider: 'anthropic', model: 'claude-sonnet-5' },
    ],
    keys: KEYS,
    request: { messages: [{ content: 'hello' }] },
  })
  assert.equal(built.runnable, true)
  assert.equal(built.attempts.length, 2)
  assert.equal(built.attempts[0].why, 'first choice')
  assert.equal(built.attempts[1].why, 'fallback 1')
  assert.ok(built.best !== null && built.worst >= built.best)
  assert.match(describePlan(built), /groq.*falling back to anthropic/)
})

test('a provider with no key is skipped, and says so', () => {
  const built = plan({
    chain: [{ provider: 'mistral', model: 'mistral-large-latest' }, { provider: 'anthropic', model: 'claude-sonnet-5' }],
    keys: KEYS,
  })
  assert.equal(built.attempts.length, 1)
  assert.equal(built.attempts[0].provider, 'anthropic')
  assert.match(built.skipped[0].why, /no API key/)
})

test('keys rotate, so two calls do not land on the same one', () => {
  const built = plan({
    chain: [{ provider: 'openai', model: 'gpt-4.1' }, { provider: 'openai', model: 'gpt-4.1-mini' }],
    keys: KEYS,
    spreadKeys: true,
  })
  assert.deepEqual(built.attempts.map((a) => a.keyAlias), ['work', 'personal'])

  const pinned = plan({
    chain: [{ provider: 'openai', model: 'gpt-4.1' }, { provider: 'openai', model: 'gpt-4.1-mini' }],
    keys: KEYS,
    spreadKeys: false,
  })
  assert.deepEqual(pinned.attempts.map((a) => a.keyAlias), ['work', 'work'])
})

test('a model that cannot take an image is skipped before it can 400', () => {
  const built = plan({
    chain: [{ provider: 'groq', model: 'llama-3.3-70b-versatile' }, { provider: 'anthropic', model: 'claude-sonnet-5' }],
    keys: KEYS,
    modes: ['text', 'image'],
  })
  assert.equal(built.attempts.length, 1)
  assert.equal(built.attempts[0].provider, 'anthropic')
  assert.match(built.skipped[0].why, /image/)
})

test('a request larger than the window is skipped before it is sent', () => {
  const built = plan({
    chain: [{ provider: 'deepseek', model: 'deepseek-chat' }],
    keys: { deepseek: ['k'] },
    request: { messages: [{ content: 'x'.repeat(400_000) }] },
  })
  assert.equal(built.runnable, false)
  assert.match(built.skipped[0].why, /larger than/)
})

test('failures open a circuit, and success closes it', () => {
  let health = emptyHealth()
  const now = 1_000_000
  for (let i = 0; i < 3; i += 1) health = recordOutcome(health, 'groq', { ok: false, at: now })
  assert.ok(circuitOpen(health, 'groq', { ...DEFAULT_POLICY, now: now + 1000 }))
  assert.equal(circuitOpen(health, 'groq', { ...DEFAULT_POLICY, now: now + 10 * 60_000 }), null, 'the cooldown expires')

  health = recordOutcome(health, 'groq', { ok: true, at: now })
  assert.equal(circuitOpen(health, 'groq', { ...DEFAULT_POLICY, now: now + 1000 }), null)
})

test('a rested provider is stepped over rather than hammered', () => {
  let health = emptyHealth()
  const now = 1_000_000
  for (let i = 0; i < 3; i += 1) health = recordOutcome(health, 'groq', { ok: false, at: now })
  const built = plan({
    chain: [{ provider: 'groq', model: 'llama-3.1-8b-instant' }, { provider: 'anthropic', model: 'claude-sonnet-5' }],
    keys: KEYS,
    health,
    now: now + 1000,
  })
  assert.equal(built.attempts.length, 1)
  assert.equal(built.attempts[0].provider, 'anthropic')
  assert.match(built.skipped[0].why, /rested/)
})

test('offline leaves only what runs on this machine', () => {
  const built = plan({
    chain: [{ provider: 'anthropic', model: 'claude-sonnet-5' }, { provider: 'ollama', model: 'llama3.1' }],
    keys: KEYS,
    offline: true,
  })
  assert.equal(built.attempts.length, 1)
  assert.equal(built.attempts[0].provider, 'ollama')
  assert.match(built.skipped[0].why, /not local/)
})

test('the attempt limit is honoured', () => {
  const built = plan({
    chain: [
      { provider: 'groq', model: 'llama-3.1-8b-instant' },
      { provider: 'anthropic', model: 'claude-sonnet-5' },
      { provider: 'openai', model: 'gpt-4.1' },
      { provider: 'openai', model: 'gpt-4.1-mini' },
    ],
    keys: KEYS,
    maxAttempts: 2,
  })
  assert.equal(built.attempts.length, 2)
  assert.match(built.skipped[0].why, /2-attempt limit/)
})

test('an unrunnable plan explains itself rather than failing silently', () => {
  const nothing = plan({ chain: [], keys: {} })
  assert.equal(nothing.runnable, false)
  assert.match(nothing.reason, /No providers are configured/)

  const noKey = plan({ chain: [{ provider: 'mistral', model: 'mistral-large-latest' }], keys: {} })
  assert.equal(noKey.runnable, false)
  assert.match(noKey.reason, /no API key/)
})

test('a suggested chain only names providers you can actually use', () => {
  const chain = suggestChain({ anthropic: ['k'] })
  assert.ok(chain.some((step) => step.provider === 'anthropic'))
  assert.ok(chain.some((step) => step.provider === 'ollama'), 'local needs no key')
  assert.ok(!chain.some((step) => step.provider === 'openai'))
  assert.ok(suggestChain({ groq: ['k'] }, { prefer: 'cheap' })[0].provider === 'groq')
})

/* ------------------------------------------------------------------- cache */

test('trivial differences in a question hit the same entry', () => {
  assert.equal(normaliseQuestion('What is due today?'), normaliseQuestion('what is due today'))
  assert.equal(normaliseQuestion('  Whats  up  '), normaliseQuestion('whats up'))
  assert.equal(normaliseQuestion("What's due?"), normaliseQuestion('what’s due'))
})

test('a negation is never normalised away', () => {
  assert.notEqual(normaliseQuestion('what is done'), normaliseQuestion('what is not done'))
  assert.notEqual(normaliseQuestion('Q3 revenue'), normaliseQuestion('Q4 revenue'))
})

test('the fingerprint moves when the facts move', () => {
  const before = [
    { id: 'a', updatedAt: '2026-09-01T00:00:00Z' },
    { id: 'b', updatedAt: '2026-09-02T00:00:00Z' },
  ]
  const reordered = [before[1], before[0]]
  assert.equal(groundingFingerprint(before), groundingFingerprint(reordered), 'order is not a change')

  const edited = [before[0], { id: 'b', updatedAt: '2026-09-03T00:00:00Z' }]
  assert.notEqual(groundingFingerprint(before), groundingFingerprint(edited), 'an edit is')

  const added = [...before, { id: 'c', updatedAt: '2026-09-02T00:00:00Z' }]
  assert.notEqual(groundingFingerprint(before), groundingFingerprint(added), 'and so is a new item')

  const removed = [before[0]]
  assert.notEqual(groundingFingerprint(before), groundingFingerprint(removed), 'and a removed one')
  assert.equal(groundingFingerprint([]), groundingFingerprint([]))
})

test('the key separates everything that makes an answer different', () => {
  const base = { question: 'what is due', provider: 'anthropic', model: 'claude-sonnet-5', system: 'sys', grounding: 'abc' }
  const same = cacheKey(base)
  assert.equal(cacheKey({ ...base, question: 'What is due?' }), same, 'punctuation is not a difference')
  assert.notEqual(cacheKey({ ...base, model: 'claude-opus-5' }), same)
  assert.notEqual(cacheKey({ ...base, provider: 'openai' }), same)
  assert.notEqual(cacheKey({ ...base, system: 'different' }), same)
  assert.notEqual(cacheKey({ ...base, grounding: 'def' }), same, 'this is the one no gateway has')
})

test('the hash is stable and shaped like a hash', () => {
  assert.equal(hash('the same'), hash('the same'))
  assert.notEqual(hash('a'), hash('b'))
  assert.match(hash('anything'), /^[0-9a-f]{8}$/)
  assert.match(hash(''), /^[0-9a-f]{8}$/)
})
