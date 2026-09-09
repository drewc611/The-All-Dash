import { addEntity, updateEntity, getState } from '../core/store.js'
import { formatDate } from '../core/time.js'
import { TYPE_LABEL } from '../data/schema.js'

/**
 * Proposals become changes only here, and only when a person clicks.
 *
 * Each proposal is described before it is applied (so the review card can
 * show the exact diff) and reported after (so the toast can say what happened).
 */

export function describeProposal(action, entities = getState().entities) {
  if (action.op === 'update') {
    const target = Object.hasOwn(entities, action.id) ? entities[action.id] : undefined
    const name = target ? `"${target.title}"` : action.id
    const changes = Object.entries(action.patch).map(([key, value]) => {
      const before = target ? target[key] : undefined
      return `${key}: ${show(key, before)} → ${show(key, value)}`
    })
    return { title: `Update ${name}`, detail: changes.join(' · '), missing: !target }
  }
  if (action.op === 'create') {
    const e = action.entity
    const bits = [e.due ? `due ${formatDate(e.due)}` : null, e.people?.length ? e.people.join(', ') : null, e.tags?.length ? e.tags.map((t) => `#${t}`).join(' ') : null].filter(Boolean)
    return { title: `New ${TYPE_LABEL[e.type]?.toLowerCase() || e.type}: "${e.title}"`, detail: bits.join(' · ') }
  }
  if (action.op === 'navigate') return { title: `Open ${action.view}`, detail: '' }
  return { title: 'Unknown action', detail: '' }
}

/** Apply one proposal. Returns a sentence for the toast, or throws. */
export function applyProposal(action, { navigate } = {}) {
  if (action.op === 'update') {
    if (!Object.hasOwn(getState().entities, action.id)) throw new Error('That item no longer exists.')
    updateEntity(action.id, action.patch)
    return `Updated "${getState().entities[action.id].title}".`
  }
  if (action.op === 'create') {
    const created = addEntity({ ...action.entity, source: { kind: 'manual', name: 'Assistant' }, meta: { editedByUser: true } })
    return `Added "${created.title}".`
  }
  if (action.op === 'navigate') {
    navigate?.(action.view)
    return `Opened ${action.view}.`
  }
  throw new Error('Unknown action')
}

function show(key, value) {
  if (value === null || value === undefined || value === '') return 'none'
  if (key === 'due') return formatDate(value)
  if (key === 'priority') return ['normal', 'high', 'urgent'][value] || String(value)
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none'
  return String(value)
}
