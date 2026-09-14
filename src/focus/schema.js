/*
 * The focus slice, as it survives a reload.
 *
 * A running session is persisted, not held in a component. Closing the tab
 * mid-pomodoro and coming back to find the timer reset would make the feature
 * useless for the one thing it is for, and because the session stores when it
 * started rather than what is left, a restored session is exactly as correct
 * as one that never stopped - even if the reload happened an hour later.
 *
 * The session log is capped. An uncapped array in localStorage is a slow leak
 * that nobody notices until the quota throws on an unrelated save, and the
 * hundredth-most-recent pomodoro is not information anybody is going to ask
 * for. Anything worth keeping longer is already on the task the session was
 * recorded against.
 */

import { normaliseSettings, PHASES } from './timer.js'

/** Sessions kept before the oldest falls off. Roughly three months of work. */
export const MAX_SESSIONS = 500

export const emptyFocus = () => ({
  session: null,
  settings: normaliseSettings(null),
  sessions: [],
})

const isIso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** A stored session, or null if it is not one. */
function normaliseSession(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!PHASES.includes(raw.phase)) return null
  if (!isIso(raw.startedAt)) return null
  const duration = Number(raw.duration)
  if (!Number.isFinite(duration) || duration <= 0) return null
  const pausedMs = Number(raw.pausedMs)
  return {
    phase: raw.phase,
    startedAt: raw.startedAt,
    duration,
    pausedMs: Number.isFinite(pausedMs) && pausedMs >= 0 ? pausedMs : 0,
    pausedAt: isIso(raw.pausedAt) ? raw.pausedAt : null,
    entityId: typeof raw.entityId === 'string' && raw.entityId ? raw.entityId : null,
    round: Number.isFinite(Number(raw.round)) ? Math.max(1, Math.round(Number(raw.round))) : 1,
  }
}

function normaliseRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  if (!isIso(raw.startedAt) || !isIso(raw.endedAt)) return null
  const minutes = Number(raw.minutes)
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return {
    startedAt: raw.startedAt,
    endedAt: raw.endedAt,
    minutes: Math.round(minutes),
    entityId: typeof raw.entityId === 'string' && raw.entityId ? raw.entityId : null,
    completed: Boolean(raw.completed),
  }
}

export function normaliseFocus(incoming) {
  const from = incoming && typeof incoming === 'object' ? incoming : {}
  const sessions = Array.isArray(from.sessions) ? from.sessions.map(normaliseRecord).filter(Boolean) : []
  // Newest first, so the cap drops the oldest rather than whatever happened
  // to be at the end of an array somebody hand-edited.
  sessions.sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt))
  return {
    session: normaliseSession(from.session),
    settings: normaliseSettings(from.settings),
    sessions: sessions.slice(0, MAX_SESSIONS),
  }
}

/** Minutes recorded against one entity. What a task shows for time spent. */
export const minutesOn = (focus, entityId) =>
  (focus?.sessions || []).reduce((total, s) => (s.entityId === entityId ? total + s.minutes : total), 0)

/** Minutes per day-key, for a chart. */
export function minutesByDay(focus, { dayKeyOf }) {
  const out = new Map()
  for (const s of focus?.sessions || []) {
    const key = dayKeyOf(new Date(s.endedAt))
    out.set(key, (out.get(key) || 0) + s.minutes)
  }
  return out
}
