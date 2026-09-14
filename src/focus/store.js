/*
 * Focus, in the workspace.
 *
 * Every action here takes `now` rather than reading the clock itself, so the
 * tests drive time instead of waiting for it, and the engine in timer.js
 * stays pure arithmetic with the state handling in one place.
 */

import { getState, mutate } from '../core/store.js'
import { normaliseFocus, MAX_SESSIONS } from './schema.js'
import { advance, isComplete, pause, resume, start, toRecord } from './timer.js'

export const focusState = (state = getState()) => state.focus

const write = (next) => mutate((s) => ({ ...s, focus: { ...s.focus, ...next } }))

/** Newest first, capped, so localStorage cannot grow without bound. */
const withRecord = (sessions, record) =>
  (record ? [record, ...sessions].slice(0, MAX_SESSIONS) : sessions)

/** Begin a work session, optionally on a task. Replaces anything running. */
export function begin(entityId = null, { now = new Date() } = {}) {
  const { session, settings, sessions } = focusState()
  // Whatever was running is banked rather than thrown away - somebody who
  // switches task mid-pomodoro still did the minutes they did.
  const banked = withRecord(sessions, toRecord(session, { now, completed: false }))
  const next = start('work', { now, settings, entityId })
  write({ session: next, sessions: banked })
  return next
}

export function hold({ now = new Date() } = {}) {
  const { session } = focusState()
  if (!session) return null
  const next = pause(session, now)
  write({ session: next })
  return next
}

export function unhold({ now = new Date() } = {}) {
  const { session } = focusState()
  if (!session) return null
  const next = resume(session, now)
  write({ session: next })
  return next
}

/** Stop early. The minutes served are still recorded. */
export function abandon({ now = new Date() } = {}) {
  const { session, sessions } = focusState()
  if (!session) return null
  write({ session: null, sessions: withRecord(sessions, toRecord(session, { now, completed: false })) })
  return null
}

/**
 * The phase ran out.
 *
 * Called by the view when `isComplete` first reads true. It re-checks rather
 * than trusting the caller, because a view that fires this early would record
 * a full pomodoro for four minutes of work.
 */
export function finish({ now = new Date(), autoContinue = null } = {}) {
  const { session, settings, sessions } = focusState()
  if (!session || !isComplete(session, now)) return session
  const record = toRecord(session, { now, completed: true })
  const carryOn = autoContinue === null ? settings.autoContinue : autoContinue
  const next = carryOn ? advance(session, { now, settings, entityId: session.entityId }) : null
  write({ session: next, sessions: withRecord(sessions, record) })
  return next
}

/** Move to the next phase by hand, whether or not this one ran out. */
export function next({ now = new Date() } = {}) {
  const { session, settings, sessions } = focusState()
  if (!session) return null
  const done = isComplete(session, now)
  const record = toRecord(session, { now, completed: done })
  const following = advance(session, { now, settings, entityId: session.entityId })
  write({ session: following, sessions: withRecord(sessions, record) })
  return following
}

export function updateFocusSettings(patch) {
  mutate((s) => ({ ...s, focus: normaliseFocus({ ...s.focus, settings: { ...s.focus.settings, ...patch } }) }))
}

/** Throw away the session history. Only ever from a person asking. */
export const clearHistory = () => write({ sessions: [] })
