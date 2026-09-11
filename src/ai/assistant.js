import { buildContext, SYSTEM_PROMPT } from './context.js'
import { parseReply } from './protocol.js'
import { stream, resolve } from './providers.js'
import { getKey } from './keys.js'
import { recordUsage, getState } from '../core/store.js'
import { run as runGateway, NoRouteError, BudgetError } from './gateway.js'
import { plan } from './route.js'
import { recordCalls, routerPolicy, routerHealth, setRouterHealth } from './router-store.js'

/**
 * One turn of the assistant.
 *
 * The context is rebuilt from the live store on every turn, so a task closed
 * between two questions is closed in the second answer. The conversation
 * itself lives in the panel's React state and is gone when the panel closes;
 * nothing the model says is written anywhere unless the user applies it.
 */

/**
 * Can the assistant run at all?
 *
 * A chain counts. A workspace that has a chain and no single provider picked
 * in Settings is configured — refusing to let someone type because the *old*
 * field is blank would be the integration getting in its own way.
 */
export function isConfigured(settings, state = getState()) {
  const policy = routerPolicy(state)
  if (policy.chain.length) {
    const built = plan({ chain: policy.chain, keys: policy.keys, health: policy.health })
    if (built.runnable) return true
  }
  const target = resolve(settings)
  return Boolean(target.model) && (!target.needsKey || Boolean(getKey(target.provider)))
}

/**
 * @param {object} args
 * @param {string} args.question
 * @param {Array<{role:'user'|'assistant', content:string}>} args.history  earlier turns, oldest first
 * @param {object} args.entities   the store's entity map
 * @param {object} args.state      the whole store state (settings, custom metrics, mutes)
 * @param {object} [args.range]
 * @param {string[]} [args.focus]  entity ids that must be in the context
 * @param {(delta:string, soFar:string)=>void} [args.onDelta]
 * @param {AbortSignal} [args.signal]
 */
export async function ask({ question, history = [], entities, state, range, focus = [], onDelta, onAttempt, signal, now = new Date() }) {
  const settings = state?.settings?.assistant || {}

  recordUsage('action', 'ask')
  const context = buildContext(entities, question, { state, range, now, focus })
  const system = `${SYSTEM_PROMPT}\n\n<workspace>\n${context.text}\n</workspace>`
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ]

  const policy = routerPolicy(state)

  // The chain is the router's when one is configured, and the single provider
  // from Settings otherwise, so nothing about the old setup stops working.
  if (!policy.chain.length) return askDirect({ settings, system, messages, entities, context, signal, onDelta })

  let result
  try {
    result = await runGateway({
      question,
      system,
      messages,
      chain: policy.chain,
      keys: policy.keys,
      health: routerHealth(state),
      contextEntities: context.items || [],
      known: entities,
      budget: policy.budget,
      ledger: state?.router?.calls || [],
      useCache: policy.cache !== false,
      expectActions: true,
      onDelta,
      onAttempt,
      signal,
    })
  } catch (error) {
    // Even a total failure is worth recording: a provider that never answers
    // should show up in the comparison, not vanish from it.
    if (error?.calls?.length) recordCalls(error.calls)
    if (error?.health) setRouterHealth(error.health)
    throw error
  }

  recordCalls(result.calls)
  setRouterHealth(result.health)

  let text = result.text
  if (result.stop === 'refusal') text += '\n\nThe model declined to answer this one.'
  if (result.stop === 'max_tokens' || result.stop === 'length') text += '\n\n(Reply cut off at the length limit.)'
  const reply = parseReply(text, { known: entities })
  return {
    ...reply,
    raw: text,
    context,
    model: result.model,
    provider: result.provider,
    cached: result.cached,
    attempts: result.attempts,
    plan: result.plan,
  }
}

/** The original single-provider path, kept for a workspace with no chain. */
async function askDirect({ settings, system, messages, entities, context, signal, onDelta }) {
  const target = resolve(settings)
  const apiKey = target.needsKey ? getKey(target.provider) : ''
  if (target.needsKey && !apiKey) throw new Error('Add an API key in Settings to use the assistant.')

  const result = await stream({ ...target, apiKey, system, messages, signal }, onDelta)
  let text = result.text
  if (result.stop === 'refusal') text += '\n\nThe model declined to answer this one.'
  if (result.stop === 'max_tokens' || result.stop === 'length') text += '\n\n(Reply cut off at the length limit.)'
  const reply = parseReply(text, { known: entities })
  return { ...reply, raw: text, context, model: target.model, provider: target.provider }
}

export { NoRouteError, BudgetError }

/** A short probe to confirm the settings work. Resolves to the model's reply text. */
export async function testConnection(state) {
  const settings = state?.settings?.assistant || {}
  const target = resolve(settings)
  const apiKey = target.needsKey ? getKey(target.provider) : ''
  if (target.needsKey && !apiKey) throw new Error('No key saved for this provider.')
  const result = await stream({
    ...target,
    apiKey,
    system: 'Reply with the single word OK.',
    messages: [{ role: 'user', content: 'Ready?' }],
    maxTokens: 64,
  })
  return result.text.trim()
}
