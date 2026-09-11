import { lineReader, deltaFromLine, stopFromLine } from './protocol.js'
// A key travels only over TLS or to this machine. The rule lives in its own
// module so the platform client can reach it without pulling this file - and
// with it three chat protocols - into every first paint.
import { assertKeyTransport } from './transport.js'

export { assertKeyTransport }

/**
 * Three ways to reach a model, one function to call.
 *
 * Anthropic's Messages API, anything that speaks the OpenAI chat-completions
 * shape (OpenAI, Groq, OpenRouter, LM Studio, vLLM, LocalAI, Mistral) and a
 * local Ollama. All three are plain fetch calls from the browser with
 * streaming responses, so there is no SDK to ship and no server in between:
 * the key goes from this tab to the provider and nowhere else.
 */

export const PROVIDERS = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    // There is one Anthropic, at one address. Nothing may override it.
    byo: false,
    model: 'claude-opus-5',
    needsKey: true,
    hint: 'Claude, called directly from the browser. Nothing but the context block leaves this machine.',
    keyHint: 'sk-ant-...',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  openai: {
    id: 'openai',
    label: 'OpenAI-compatible',
    baseUrl: 'https://api.openai.com/v1',
    // Choosing the address is the entire point of this one.
    byo: true,
    model: '',
    needsKey: true,
    hint: 'Any endpoint that speaks /chat/completions: OpenAI, Groq, OpenRouter, Mistral, LM Studio, vLLM, LocalAI.',
    keyHint: 'sk-...',
    models: [],
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434',
    byo: true,
    model: 'llama3.1',
    needsKey: false,
    hint: 'Runs on your own machine; nothing leaves it. Start Ollama with OLLAMA_ORIGINS set to this site\'s origin so the browser may call it.',
    keyHint: '',
    models: [],
  },
}

/**
 * Where a request actually goes.
 *
 * Resolved here, at the moment of the call, rather than trusted from whatever
 * is sitting in settings - the same rule the router catalogue follows. A
 * named vendor's address comes from the table above and an override of it is
 * meaningless, so it is ignored.
 *
 * That only helps where the table has an answer. "OpenAI-compatible" and
 * Ollama exist precisely so someone can point them at their own endpoint, so
 * for those the address has to be allowed - and the defence that matters is
 * that it cannot arrive in a restored file at all. See core/settings-schema.js.
 */
export const endpointFor = (providerId, requested = '') => {
  const spec = PROVIDERS[providerId] || PROVIDERS.anthropic
  const wanted = String(requested || '').trim().replace(/\/+$/, '')
  if (!spec.byo || !wanted) return spec.baseUrl
  try {
    const url = new URL(wanted)
    return url.protocol === 'https:' || url.protocol === 'http:' ? wanted : spec.baseUrl
  } catch {
    return spec.baseUrl
  }
}

export const resolve = (settings = {}) => {
  const spec = PROVIDERS[settings.provider] || PROVIDERS.anthropic
  return {
    provider: spec.id,
    baseUrl: endpointFor(spec.id, settings.baseUrl),
    model: settings.model || spec.model,
    needsKey: spec.needsKey,
  }
}

/**
 * Stream one reply. `onDelta(text)` receives each fragment; the resolved
 * value is the whole text plus the stop reason. Throws a readable Error on
 * any failure, with the provider's own message when it gave one.
 */
export async function stream({ provider, baseUrl, model, apiKey, system, messages, signal, maxTokens = 4096 }, onDelta) {
  if (!model) throw new Error('Pick a model in Settings first.')
  assertKeyTransport(baseUrl, apiKey)
  const { url, headers, body } = request({ provider, baseUrl, model, apiKey, system, messages, maxTokens })
  let res
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error(unreachable(provider, baseUrl))
  }
  if (!res.ok) throw new Error(await describeFailure(res, provider))
  if (!res.body) throw new Error('The provider sent no response body.')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const lines = lineReader()
  let text = ''
  let stop = null
  const handle = (line) => {
    const delta = deltaFromLine(provider, line)
    if (delta) { text += delta; onDelta?.(delta, text) }
    stop = stopFromLine(provider, line) || stop
  }
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    for (const line of lines.push(decoder.decode(value, { stream: true }))) handle(line)
  }
  for (const line of lines.flush()) handle(line)
  return { text, stop }
}

/** Ask the provider which models it offers; empty when it cannot say. */
export async function listModels({ provider, baseUrl, apiKey }) {
  try {
    assertKeyTransport(baseUrl, apiKey)
    if (provider === 'ollama') {
      const res = await fetch(`${baseUrl}/api/tags`)
      const data = await res.json()
      return (data.models || []).map((m) => m.name).filter(Boolean)
    }
    if (provider === 'anthropic') {
      const res = await fetch(`${baseUrl}/v1/models`, { headers: anthropicHeaders(apiKey) })
      const data = await res.json()
      return (data.data || []).map((m) => m.id).filter(Boolean)
    }
    const res = await fetch(`${baseUrl}/models`, { headers: bearer(apiKey) })
    const data = await res.json()
    return (data.data || []).map((m) => m.id).filter(Boolean).sort()
  } catch {
    return []
  }
}

function request({ provider, baseUrl, model, apiKey, system, messages, maxTokens }) {
  if (provider === 'anthropic') {
    return {
      url: `${baseUrl}/v1/messages`,
      headers: anthropicHeaders(apiKey),
      body: { model, max_tokens: maxTokens, system, messages, stream: true },
    }
  }
  const chat = [{ role: 'system', content: system }, ...messages]
  if (provider === 'ollama') {
    return {
      url: `${baseUrl}/api/chat`,
      headers: { 'content-type': 'application/json' },
      body: { model, messages: chat, stream: true, options: { num_predict: maxTokens } },
    }
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers: { 'content-type': 'application/json', ...bearer(apiKey) },
    body: { model, messages: chat, stream: true, max_tokens: maxTokens },
  }
}

const anthropicHeaders = (apiKey) => ({
  'content-type': 'application/json',
  'x-api-key': apiKey || '',
  'anthropic-version': '2023-06-01',
  // The key is the user's own and stays in their browser; this header is how
  // the API is told that a direct browser call is intentional.
  'anthropic-dangerous-direct-browser-access': 'true',
})

const bearer = (apiKey) => (apiKey ? { authorization: `Bearer ${apiKey}` } : {})

async function describeFailure(res, provider) {
  let detail = ''
  try {
    const data = await res.json()
    detail = data?.error?.message || data?.error || data?.message || ''
    if (typeof detail !== 'string') detail = JSON.stringify(detail)
  } catch {
    // no JSON body
  }
  const who = PROVIDERS[provider]?.label || provider
  if (res.status === 401 || res.status === 403) return `${who} rejected the key (${res.status}). ${detail}`.trim()
  if (res.status === 404) return `${who} has no such endpoint or model (404). ${detail}`.trim()
  if (res.status === 429) return `${who} is rate limiting (429). Try again in a moment. ${detail}`.trim()
  return `${who} returned ${res.status}. ${detail}`.trim()
}

function unreachable(provider, baseUrl) {
  if (provider === 'ollama') {
    return `Could not reach Ollama at ${baseUrl}. Is it running, and started with OLLAMA_ORIGINS="${typeof location !== 'undefined' ? location.origin : '*'}" so this page may call it?`
  }
  return `Could not reach ${baseUrl}. Check the URL, your connection, and that the endpoint allows browser requests (CORS).`
}
