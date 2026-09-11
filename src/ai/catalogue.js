/*
 * The provider catalogue.
 *
 * "Support twelve providers" sounds like twelve integrations. It is not.
 * Groq, Mistral, Cerebras, Together, Fireworks, DeepSeek, xAI, OpenRouter,
 * Perplexity, Azure, vLLM and LM Studio all speak /chat/completions, so they
 * share one wire implementation and differ by a base URL and a price list.
 * Saying so is more useful than pretending each one was hard.
 *
 * Three wire formats actually exist here: openai, anthropic and ollama.
 * Everything else is configuration.
 *
 * Prices are dollars per million tokens and are stamped with the date they
 * were taken. They go stale - vendors change them - so every one of them is
 * editable in Settings, and the app shows the stamp rather than pretending a
 * hard-coded number is current truth.
 */

export const PRICED_AT = '2026-09-11'

/** Modalities a model will accept, so the router never sends an image to a
    text-only endpoint and calls the resulting 400 a provider outage. */
export const MODES = ['text', 'image', 'audio']

const m = (id, label, inPrice, outPrice, context, modes = ['text']) =>
  ({ id, label, in: inPrice, out: outPrice, context, modes })

export const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    needsKey: true,
    keyHint: 'sk-ant-…',
    models: [
      m('claude-opus-5', 'Opus 5', 15, 75, 200_000, ['text', 'image']),
      m('claude-sonnet-5', 'Sonnet 5', 3, 15, 200_000, ['text', 'image']),
      m('claude-haiku-4-5', 'Haiku 4.5', 0.8, 4, 200_000, ['text', 'image']),
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keyHint: 'sk-…',
    models: [
      m('gpt-4.1', 'GPT-4.1', 2, 8, 1_000_000, ['text', 'image']),
      m('gpt-4.1-mini', 'GPT-4.1 mini', 0.4, 1.6, 1_000_000, ['text', 'image']),
      m('o4-mini', 'o4-mini', 1.1, 4.4, 200_000, ['text', 'image']),
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    wire: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keyHint: 'gsk_…',
    note: 'The fastest tokens per second of anything on this list, by a wide margin.',
    models: [
      m('llama-3.3-70b-versatile', 'Llama 3.3 70B', 0.59, 0.79, 128_000),
      m('llama-3.1-8b-instant', 'Llama 3.1 8B', 0.05, 0.08, 128_000),
    ],
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    wire: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    needsKey: true,
    models: [
      m('llama3.1-8b', 'Llama 3.1 8B', 0.1, 0.1, 128_000),
      m('llama-3.3-70b', 'Llama 3.3 70B', 0.85, 1.2, 128_000),
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    wire: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    models: [
      m('mistral-large-latest', 'Mistral Large', 2, 6, 128_000),
      m('mistral-small-latest', 'Mistral Small', 0.2, 0.6, 128_000),
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    wire: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    models: [m('deepseek-chat', 'DeepSeek Chat', 0.27, 1.1, 64_000)],
  },
  {
    id: 'together',
    label: 'Together',
    wire: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    needsKey: true,
    models: [m('meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Llama 3.3 70B Turbo', 0.88, 0.88, 128_000)],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    wire: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    note: 'A gateway in front of a gateway. Useful as a last resort in a chain, because its own fallbacks are different from yours.',
    models: [],
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    wire: 'openai',
    baseUrl: '',
    needsKey: true,
    note: 'Set the base URL to your own deployment endpoint; the model name is the deployment name.',
    models: [],
  },
  {
    id: 'ollama',
    label: 'Ollama',
    wire: 'ollama',
    baseUrl: 'http://localhost:11434',
    needsKey: false,
    local: true,
    note: 'On your machine. Free, private, and the only entry here that still answers with the network off.',
    models: [m('llama3.1', 'Llama 3.1', 0, 0, 128_000), m('qwen2.5', 'Qwen 2.5', 0, 0, 32_000)],
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    wire: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    local: true,
    models: [],
  },
  {
    id: 'custom',
    label: 'Anything OpenAI-compatible',
    wire: 'openai',
    baseUrl: '',
    needsKey: true,
    note: 'vLLM, LocalAI, Fireworks, xAI, Perplexity, a colleague’s box. If it answers /chat/completions, it works here.',
    models: [],
  },
]

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]))

export const provider = (id) => BY_ID.get(id) || null
export const wireOf = (id) => BY_ID.get(id)?.wire || 'openai'
export const isLocal = (id) => !!BY_ID.get(id)?.local

/** A model's entry, wherever it lives. Returns null for a model nobody has
    priced, which the cost estimator has to handle rather than guess. */
export function model(providerId, modelId) {
  const spec = BY_ID.get(providerId)
  if (!spec) return null
  return spec.models.find((entry) => entry.id === modelId) || null
}

/** Every model, flattened, for a picker. */
export function allModels() {
  return PROVIDERS.flatMap((p) => p.models.map((entry) => ({ ...entry, provider: p.id, providerLabel: p.label })))
}

/** Can this model take what we want to send it? */
export function supports(providerId, modelId, modes = ['text']) {
  const entry = model(providerId, modelId)
  // An unlisted model is assumed to be text-only rather than assumed capable:
  // a wrong 400 is worse than a needless fallback.
  const able = entry?.modes || ['text']
  return modes.every((mode) => able.includes(mode))
}

/** Cheapest first, among models that can do the job. */
export function cheapest(modes = ['text']) {
  return allModels()
    .filter((entry) => modes.every((mode) => entry.modes.includes(mode)))
    .sort((a, b) => (a.in + a.out) - (b.in + b.out))
}
