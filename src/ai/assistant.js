import { buildContext, SYSTEM_PROMPT } from './context.js'
import { parseReply } from './protocol.js'
import { stream, resolve } from './providers.js'
import { getKey } from './keys.js'

/**
 * One turn of the assistant.
 *
 * The context is rebuilt from the live store on every turn, so a task closed
 * between two questions is closed in the second answer. The conversation
 * itself lives in the panel's React state and is gone when the panel closes;
 * nothing the model says is written anywhere unless the user applies it.
 */

export function isConfigured(settings) {
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
export async function ask({ question, history = [], entities, state, range, focus = [], onDelta, signal, now = new Date() }) {
  const settings = state?.settings?.assistant || {}
  const target = resolve(settings)
  const apiKey = target.needsKey ? getKey(target.provider) : ''
  if (target.needsKey && !apiKey) throw new Error('Add an API key in Settings to use the assistant.')

  const context = buildContext(entities, question, { state, range, now, focus })
  const system = `${SYSTEM_PROMPT}\n\n<workspace>\n${context.text}\n</workspace>`
  const messages = [
    ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: question },
  ]

  const result = await stream({ ...target, apiKey, system, messages, signal }, onDelta)
  let text = result.text
  if (result.stop === 'refusal') text += '\n\nThe model declined to answer this one.'
  if (result.stop === 'max_tokens' || result.stop === 'length') text += '\n\n(Reply cut off at the length limit.)'
  const reply = parseReply(text, { known: entities })
  return { ...reply, raw: text, context, model: target.model, provider: target.provider }
}

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
