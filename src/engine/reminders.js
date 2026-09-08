import { q } from '../core/query.js'
import { addDays, relative, MS } from '../core/time.js'

/**
 * Reminders are derived, never stored.
 *
 * Anything with a due date or a start time produces one; the store only keeps
 * what the user did about it (snoozed until, dismissed). That way importing a
 * corrected calendar fixes the reminders too, with no reconciliation step.
 */

export const URGENCY = ['overdue', 'now', 'soon', 'today', 'upcoming']

export function buildReminders(entities, state, now = new Date()) {
  const marks = state?.reminders || {}
  const lead = (state?.settings?.reminderLeadMinutes ?? 15) * MS.minute
  const horizon = addDays(now, 7)
  const out = []

  const push = (entity, when, kind) => {
    const mark = marks[entity.id]
    if (mark?.dismissed) return
    const at = new Date(when)
    if (Number.isNaN(Number(at)) || at > horizon) return
    const snoozed = mark?.snoozedUntil ? new Date(mark.snoozedUntil) : null
    if (snoozed && snoozed > now) return
    const delta = at.getTime() - now.getTime()
    out.push({
      id: entity.id,
      entity,
      kind,
      at: at.toISOString(),
      delta,
      urgency: urgencyFor(delta, lead),
      label: relative(at, now),
      fireAt: at.getTime() - lead,
    })
  }

  for (const entity of q(entities).type('task', 'milestone').open().all()) {
    if (entity.due) push(entity, entity.due, 'due')
  }
  for (const entity of q(entities).type('event').all()) {
    if (entity.status === 'cancelled') continue
    if (entity.at) push(entity, entity.at, 'starts')
  }

  return out.sort((a, b) => a.delta - b.delta)
}

function urgencyFor(delta, lead) {
  if (delta < 0) return 'overdue'
  if (delta <= lead) return 'now'
  if (delta <= 2 * MS.hour) return 'soon'
  if (delta <= MS.day) return 'today'
  return 'upcoming'
}

/**
 * Fire OS notifications for reminders crossing their lead time. Called on a
 * timer from the app shell; keeps its own memory of what it has announced so a
 * re-render never double-notifies.
 */
const announced = new Set()

/** A reminder is "the same" only while it fires at the same instant, so a
    snooze or a moved due date produces a fresh notification. */
export const announceKey = (reminder) => `${reminder.id}:${reminder.fireAt}`

export function runNotifications(reminders, enabled) {
  if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const now = Date.now()
  for (const reminder of reminders) {
    const key = announceKey(reminder)
    if (announced.has(key)) continue
    if (reminder.fireAt > now || reminder.delta < -MS.day) continue
    announced.add(key)
    try {
      const n = new Notification(reminder.entity.title, {
        body: `${reminder.kind === 'due' ? 'Due' : 'Starts'} ${reminder.label}`,
        tag: reminder.id,
      })
      n.onclick = () => window.focus()
    } catch {
      // Some browsers throw when constructing outside a service worker; the
      // in-app reminder list is the fallback and is always present.
    }
  }
}

export async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.requestPermission()
}
