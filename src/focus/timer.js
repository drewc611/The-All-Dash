/*
 * The Pomodoro engine.
 *
 * Pure arithmetic over a stored session: no timers live in here, no state is
 * held in a module, nothing ticks. The view samples this with whatever clock
 * it likes and gets the same answer, which is what makes the whole thing
 * testable without waiting twenty-five minutes.
 *
 * One decision drives the rest. A session stores *when it started*, not *how
 * much is left*. Every timer that counts down by accumulating ticks is wrong
 * in a background tab - browsers throttle a hidden tab's timers to roughly one
 * a minute, so a 25-minute pomodoro with a 1s interval that loses 24 ticks a
 * minute finishes somewhere north of an hour, and it does it silently. Wall
 * clock arithmetic cannot drift: the answer is a subtraction against
 * Date.now(), so a tab that was asleep for ten minutes wakes up already
 * knowing the session ended, and a reload restores the truth rather than an
 * approximation of it.
 *
 * Pausing is the same idea. A pause records the instant it began and, on
 * resume, adds the elapsed span to a running total that is subtracted out.
 * There is no separate "remaining when paused" number to keep in step.
 */

import { iso } from '../core/time.js'

/** Phases, in the order a full round runs them. */
export const PHASES = ['work', 'short', 'long']

export const DEFAULT_SETTINGS = Object.freeze({
  work: 25,
  short: 5,
  long: 15,
  /** Work sessions before the long break. The fourth one earns it. */
  roundsBeforeLong: 4,
  /** Start the next phase by itself, or wait to be told. */
  autoContinue: false,
  chime: true,
})

const MINUTE = 60000

const clampInt = (value, min, max, fallback) => {
  const n = Math.round(Number(value))
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/**
 * Settings a person or a file may have mangled.
 *
 * The bounds are not decoration: a zero-minute phase completes the instant it
 * starts, which in autoContinue would spin through rounds as fast as the
 * event loop allows.
 */
export function normaliseSettings(incoming) {
  const from = incoming && typeof incoming === 'object' ? incoming : {}
  return {
    work: clampInt(from.work, 1, 180, DEFAULT_SETTINGS.work),
    short: clampInt(from.short, 1, 60, DEFAULT_SETTINGS.short),
    long: clampInt(from.long, 1, 120, DEFAULT_SETTINGS.long),
    roundsBeforeLong: clampInt(from.roundsBeforeLong, 1, 12, DEFAULT_SETTINGS.roundsBeforeLong),
    autoContinue: typeof from.autoContinue === 'boolean' ? from.autoContinue : DEFAULT_SETTINGS.autoContinue,
    chime: typeof from.chime === 'boolean' ? from.chime : DEFAULT_SETTINGS.chime,
  }
}

/** How long a phase runs, in milliseconds. */
export const lengthOf = (phase, settings = DEFAULT_SETTINGS) =>
  (settings[PHASES.includes(phase) ? phase : 'work'] || DEFAULT_SETTINGS.work) * MINUTE

/**
 * Begin a phase.
 *
 * `entityId` is what makes a session more than a stopwatch: a finished work
 * session is recorded against the task it was for, so the hours land on the
 * record rather than in a separate log nothing else can see.
 */
export function start(phase, { now = new Date(), settings = DEFAULT_SETTINGS, entityId = null, round = 1 } = {}) {
  const kind = PHASES.includes(phase) ? phase : 'work'
  return {
    phase: kind,
    startedAt: iso(now),
    duration: lengthOf(kind, settings),
    /** Total time spent paused so far, subtracted from elapsed. */
    pausedMs: 0,
    /** When the current pause began, or null while running. */
    pausedAt: null,
    entityId: kind === 'work' ? entityId : null,
    round,
  }
}

/** Milliseconds of the session that have actually been served. */
export function elapsed(session, now = new Date()) {
  if (!session) return 0
  const started = Date.parse(session.startedAt)
  if (!Number.isFinite(started)) return 0
  const stop = session.pausedAt ? Date.parse(session.pausedAt) : now.getTime()
  const raw = (Number.isFinite(stop) ? stop : now.getTime()) - started - (session.pausedMs || 0)
  // A clock that moved backwards - an NTP correction, a manual change - must
  // not read as negative progress.
  return Math.max(0, raw)
}

/** Milliseconds left, floored at zero. */
export const remaining = (session, now = new Date()) =>
  (session ? Math.max(0, session.duration - elapsed(session, now)) : 0)

/** Has this phase run its course? */
export const isComplete = (session, now = new Date()) => Boolean(session) && remaining(session, now) === 0

export const isPaused = (session) => Boolean(session?.pausedAt)

/** 0 to 1, for a ring or a bar. */
export const progress = (session, now = new Date()) =>
  (session?.duration ? Math.min(1, elapsed(session, now) / session.duration) : 0)

export function pause(session, now = new Date()) {
  if (!session || session.pausedAt) return session
  return { ...session, pausedAt: iso(now) }
}

export function resume(session, now = new Date()) {
  if (!session?.pausedAt) return session
  const began = Date.parse(session.pausedAt)
  const held = Number.isFinite(began) ? Math.max(0, now.getTime() - began) : 0
  return { ...session, pausedAt: null, pausedMs: (session.pausedMs || 0) + held }
}

/**
 * What follows this phase.
 *
 * Work counts a round; the long break arrives after `roundsBeforeLong` of
 * them and resets the count. Breaks always return to work.
 */
export function nextPhase(session, settings = DEFAULT_SETTINGS) {
  if (!session) return { phase: 'work', round: 1 }
  if (session.phase !== 'work') return { phase: 'work', round: session.round }
  const done = session.round
  return done >= settings.roundsBeforeLong
    ? { phase: 'long', round: done }
    : { phase: 'short', round: done }
}

/** Starting a phase after a break increments the round; after a long break it restarts. */
export function advance(session, { now = new Date(), settings = DEFAULT_SETTINGS, entityId = null } = {}) {
  const next = nextPhase(session, settings)
  if (next.phase !== 'work') return start(next.phase, { now, settings, round: next.round })
  const round = session?.phase === 'long' ? 1 : (session?.phase === 'short' ? session.round + 1 : 1)
  return start('work', { now, settings, entityId, round })
}

/**
 * The record a finished session leaves behind.
 *
 * Breaks are not recorded. A log of when somebody had a cup of tea is not
 * information anybody asked this app to keep, and the point of the record is
 * time spent on a task.
 */
export function toRecord(session, { now = new Date(), completed = true } = {}) {
  if (!session || session.phase !== 'work') return null
  const served = Math.min(session.duration, elapsed(session, now))
  if (served < MINUTE) return null // a session abandoned in its first minute is noise
  return {
    startedAt: session.startedAt,
    endedAt: iso(now),
    minutes: Math.round(served / MINUTE),
    entityId: session.entityId || null,
    completed: Boolean(completed),
  }
}

/** mm:ss, and h:mm:ss once a phase runs past an hour. */
export function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  const pad = (n) => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
