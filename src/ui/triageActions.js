import { updateEntity, muteSignal, recordUsage } from '../core/store.js'
import { addDays } from '../core/time.js'

/**
 * What the buttons on a triage row do. Shared by the full view and the
 * compact widget so they never drift apart.
 */
export function runTriageAction(actionId, signal, { now = new Date() } = {}) {
  const e = signal.entity
  recordUsage('action', `triage:${actionId}`)
  if (actionId === 'mute') {
    muteSignal(signal.id, addDays(now, 7).toISOString())
    return `Muted "${signal.title}" for a week.`
  }
  if (!e) return null
  if (actionId === 'done') {
    updateEntity(e.id, { status: 'done' })
    return `Marked "${e.title}" done.`
  }
  if (actionId === 'push') {
    const from = e.due && new Date(e.due) > now ? new Date(e.due) : now
    updateEntity(e.id, { due: addDays(from, 7).toISOString(), status: e.status === 'done' ? 'open' : e.status })
    return `Moved "${e.title}" out a week.`
  }
  if (actionId === 'unblock') {
    updateEntity(e.id, { status: 'doing' })
    return `"${e.title}" is back in progress.`
  }
  if (actionId === 'assign') {
    const who = typeof prompt === 'function' ? prompt(`Who owns "${e.title}"?`) : null
    if (!who?.trim()) return null
    updateEntity(e.id, { people: [who.trim()] })
    return `Assigned "${e.title}" to ${who.trim()}.`
  }
  return null
}

/** A question the assistant can answer about one row. */
export const explainQuestion = (signal) =>
  `Why is "${signal.title}" flagged as ${signal.severity} in triage, and what is the smallest thing I can do about it today?`
