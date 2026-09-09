import { hashId } from '../core/id.js'
import { iso } from '../core/time.js'

/**
 * One record type for everything.
 *
 * A meeting note, a calendar invite, a spreadsheet row and a hand-typed
 * reminder all normalise to an Entity. Widgets query entities; they never know
 * which parser produced them. That one decision is why adding a new file format
 * costs a parser file and nothing else.
 *
 * @typedef {object} Entity
 * @property {string} id
 * @property {EntityType} type
 * @property {string} title
 * @property {string} [body]      supporting detail, plain text
 * @property {string} [at]        when it happened / is scheduled (ISO)
 * @property {string} [end]       for events (ISO)
 * @property {string} [due]       for tasks and milestones (ISO)
 * @property {Status} [status]
 * @property {number} [priority]  0 normal, 1 high, 2 urgent
 * @property {string[]} tags
 * @property {string[]} people
 * @property {number} [value]     for metrics
 * @property {string} [unit]      '$', '%', 'h', ''
 * @property {string} [series]    metric series name, e.g. "Revenue"
 * @property {object} [meta]      parser-specific extras, never required by UI
 * @property {Source} source
 * @property {number} confidence  0-1, how sure the parser is
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/** @typedef {'task'|'event'|'note'|'metric'|'milestone'|'risk'|'decision'|'person'|'doc'} EntityType */
/** @typedef {'open'|'doing'|'done'|'blocked'|'cancelled'} Status */

export const ENTITY_TYPES = [
  'task', 'event', 'note', 'metric', 'milestone', 'risk', 'decision', 'person', 'doc',
]

export const TYPE_LABEL = {
  task: 'Task',
  event: 'Event',
  note: 'Note',
  metric: 'Metric',
  milestone: 'Milestone',
  risk: 'Risk',
  decision: 'Decision',
  person: 'Person',
  doc: 'Document',
}

export const STATUSES = ['open', 'doing', 'done', 'blocked', 'cancelled']
export const OPEN_STATUSES = ['open', 'doing', 'blocked']

/** Fill in defaults and give the record a content-stable id. */
// An imported id such as "__proto__" would set the prototype of the entity
// map instead of adding a record; such ids get a fresh one.
const UNSAFE_ID = /^(__proto__|constructor|prototype)$/

export function makeEntity(input) {
  const now = iso(new Date())
  const type = ENTITY_TYPES.includes(input.type) ? input.type : 'note'
  const title = String(input.title ?? '').trim().slice(0, 400) || '(untitled)'
  const entity = {
    id: input.id && !UNSAFE_ID.test(input.id) ? input.id : hashId(type, type, title, input.at || input.due || '', input.series || '', input.source?.docId || ''),
    type,
    title,
    body: input.body ? String(input.body).slice(0, 8000) : '',
    at: input.at || null,
    end: input.end || null,
    due: input.due || null,
    status: input.status || (type === 'task' ? 'open' : null),
    priority: Number(input.priority) || 0,
    tags: dedupe(input.tags),
    people: dedupe(input.people),
    value: input.value === undefined || input.value === null ? null : Number(input.value),
    unit: input.unit || '',
    series: input.series || '',
    meta: input.meta || {},
    source: {
      docId: input.source?.docId || 'manual',
      name: input.source?.name || 'Added by hand',
      kind: input.source?.kind || 'manual',
      line: input.source?.line ?? null,
      url: input.source?.url || null,
    },
    confidence: input.confidence ?? 1,
    createdAt: input.createdAt || now,
    // A restored or re-imported record keeps its own timestamp; only a record
    // arriving without one is "updated now".
    updatedAt: input.updatedAt || now,
  }
  if (entity.type === 'metric' && !Number.isFinite(entity.value)) entity.value = 0
  return entity
}

function dedupe(list) {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const v = String(raw).trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.slice(0, 24)
}

/**
 * When the same document is imported twice, keep the newer body but preserve
 * anything the user changed by hand (status, priority, due).
 */
export function mergeEntity(existing, incoming) {
  if (!existing) return incoming
  const userTouched = existing.meta?.editedByUser
  const merged = {
    ...incoming,
    status: userTouched ? existing.status : incoming.status,
    priority: userTouched ? existing.priority : incoming.priority,
    due: userTouched ? existing.due : incoming.due,
    createdAt: existing.createdAt,
    meta: { ...incoming.meta, ...(userTouched ? { editedByUser: true } : {}) },
  }
  // updatedAt means "last real change". Re-importing the same content must
  // not make an old task count as finished today or restart a blocked timer.
  const same = CONTENT_KEYS.every((k) => JSON.stringify(existing[k] ?? null) === JSON.stringify(merged[k] ?? null))
  merged.updatedAt = same ? existing.updatedAt : incoming.updatedAt
  return merged
}

const CONTENT_KEYS = ['title', 'body', 'status', 'priority', 'due', 'at', 'end', 'value', 'people', 'tags']

/** A document is a first-class entity too, so the inbox is just a query. */
export function makeDoc({ id, name, kind, size, text, produced, version, flavor = null, url = null }) {
  return makeEntity({
    id,
    type: 'doc',
    title: name,
    body: (text || '').slice(0, 2000),
    at: iso(new Date()),
    tags: [kind],
    meta: { kind, size, produced, version, flavor, url },
    source: { docId: id, name, kind: 'import', url },
  })
}
