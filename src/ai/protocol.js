import { ENTITY_TYPES, STATUSES } from '../data/schema.js'

/**
 * The wire format between the assistant and the app, kept provider-neutral.
 *
 * Any chat model, hosted or local, can follow two conventions: cite an item
 * by writing its id in double brackets, and propose changes in a fenced
 * `actions` block holding a JSON array. The app turns citations into chips
 * that open the item, and turns actions into proposals the user applies or
 * skips. The model never writes to the store; it only ever asks.
 */

export const VIEWS = ['today', 'triage', 'timeline', 'analytics', 'library', 'settings']
export const PATCH_KEYS = ['status', 'priority', 'due', 'people', 'tags', 'title']

export const CITATION = /\[\[([a-z]+_[a-z0-9]+)\]\]/g
const ACTION_BLOCK = /```(?:actions|json)\s*\n([\s\S]*?)```/g

/** Split a reply into displayable segments, cited ids and validated actions. */
export function parseReply(raw, { known = null } = {}) {
  const text = String(raw || '')
  const actions = []
  let stripped = text
  for (const match of text.matchAll(ACTION_BLOCK)) {
    const parsed = safeJson(match[1])
    if (!Array.isArray(parsed)) continue
    const valid = parsed.map((a) => validateAction(a, known)).filter(Boolean)
    if (!valid.length) continue
    actions.push(...valid)
    stripped = stripped.replace(match[0], '')
  }
  const citations = []
  const segments = []
  let last = 0
  for (const match of stripped.matchAll(CITATION)) {
    const id = match[1]
    if (known && !known[id]) continue
    if (match.index > last) segments.push({ text: stripped.slice(last, match.index) })
    segments.push({ ref: id })
    if (!citations.includes(id)) citations.push(id)
    last = match.index + match[0].length
  }
  if (last < stripped.length) segments.push({ text: stripped.slice(last) })
  return { text: stripped.trim(), segments, citations, actions }
}

/** Plain text for speech and clipboard: citations and fences removed. */
export function plainText(raw) {
  return String(raw || '')
    .replace(ACTION_BLOCK, '')
    .replace(CITATION, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Where a streamed reply starts hiding: the opening fence of an action block. */
export function visiblePortion(partial) {
  const i = partial.search(/```(?:actions|json)/)
  return i === -1 ? partial : partial.slice(0, i)
}

export function validateAction(action, known) {
  if (!action || typeof action !== 'object') return null
  if (action.op === 'update') {
    if (typeof action.id !== 'string' || (known && !Object.hasOwn(known, action.id))) return null
    const patch = {}
    for (const key of PATCH_KEYS) {
      if (!(key in (action.patch || {}))) continue
      const value = normaliseField(key, action.patch[key])
      if (value !== undefined) patch[key] = value
    }
    if (!Object.keys(patch).length) return null
    return { op: 'update', id: action.id, patch, note: str(action.note) }
  }
  if (action.op === 'create') {
    const e = action.entity || {}
    if (!ENTITY_TYPES.includes(e.type) || e.type === 'doc' || !str(e.title)) return null
    const entity = { type: e.type, title: str(e.title).slice(0, 400) }
    for (const key of ['status', 'priority', 'due', 'people', 'tags', 'body', 'at']) {
      if (!(key in e)) continue
      const value = normaliseField(key, e[key])
      if (value !== undefined) entity[key] = value
    }
    return { op: 'create', entity, note: str(action.note) }
  }
  if (action.op === 'navigate') {
    return VIEWS.includes(action.view) ? { op: 'navigate', view: action.view, note: str(action.note) } : null
  }
  return null
}

function normaliseField(key, value) {
  if (key === 'status') return STATUSES.includes(value) ? value : undefined
  if (key === 'priority') {
    const n = Number(value)
    return Number.isInteger(n) && n >= 0 && n <= 2 ? n : undefined
  }
  if (key === 'due' || key === 'at') {
    if (value === null) return null
    const d = new Date(value)
    return Number.isNaN(Number(d)) ? undefined : d.toISOString()
  }
  if (key === 'people' || key === 'tags') {
    if (!Array.isArray(value)) return undefined
    return value.map((v) => String(v).trim()).filter(Boolean).slice(0, 24)
  }
  if (key === 'title' || key === 'body') return str(value) || undefined
  return undefined
}

const str = (v) => (typeof v === 'string' ? v.trim() : '')

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ------------------------------------------------------------- streaming

/**
 * Feed raw chunks in, get whole lines out. Every streaming format the app
 * speaks (Anthropic SSE, OpenAI SSE, Ollama NDJSON) is line-delimited, so a
 * single reader serves all three.
 */
export function lineReader() {
  let buffer = ''
  return {
    push(chunk) {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop()
      return lines
    },
    flush() {
      const rest = buffer
      buffer = ''
      return rest ? [rest] : []
    },
  }
}

/** The text a single line carries, or null. Errors surface as thrown Errors. */
export function deltaFromLine(provider, line) {
  const trimmed = line.trim()
  if (!trimmed) return null
  if (provider === 'ollama') {
    const data = safeJson(trimmed)
    if (!data) return null
    if (data.error) throw new Error(String(data.error))
    return data.message?.content || null
  }
  if (!trimmed.startsWith('data:')) return null
  const payload = trimmed.slice(5).trim()
  if (payload === '[DONE]') return null
  const data = safeJson(payload)
  if (!data) return null
  if (provider === 'anthropic') {
    if (data.type === 'error') throw new Error(data.error?.message || 'The API returned an error')
    if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') return data.delta.text || null
    return null
  }
  if (data.error) throw new Error(data.error.message || String(data.error))
  return data.choices?.[0]?.delta?.content || null
}

/** Stop reason, when a line carries one. */
export function stopFromLine(provider, line) {
  const trimmed = line.trim()
  if (provider === 'ollama') {
    const data = safeJson(trimmed)
    return data?.done ? data.done_reason || 'stop' : null
  }
  if (!trimmed.startsWith('data:')) return null
  const data = safeJson(trimmed.slice(5).trim())
  if (!data) return null
  if (provider === 'anthropic') return data.type === 'message_delta' ? data.delta?.stop_reason || null : null
  return data.choices?.[0]?.finish_reason || null
}
