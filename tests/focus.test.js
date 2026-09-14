import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SETTINGS, PHASES, advance, clock, elapsed, isComplete, isPaused,
  lengthOf, nextPhase, normaliseSettings, pause, progress, remaining, resume, start, toRecord,
} from '../src/focus/timer.js'
import { emptyFocus, normaliseFocus, minutesOn, MAX_SESSIONS } from '../src/focus/schema.js'

const MINUTE = 60000
const at = (base, minutes) => new Date(base.getTime() + minutes * MINUTE)
const T0 = new Date('2026-09-14T09:00:00.000Z')

/* ------------------------------------------------------------- the clock */

test('counts down from the wall clock, not from ticks', () => {
  // The whole reason this engine stores startedAt rather than a remaining
  // count: a tab throttled to one tick a minute must still be right.
  const s = start('work', { now: T0 })
  assert.equal(remaining(s, T0), 25 * MINUTE)
  assert.equal(remaining(s, at(T0, 10)), 15 * MINUTE)
  assert.equal(remaining(s, at(T0, 25)), 0)
})

test('a tab asleep past the end wakes up knowing it finished', () => {
  const s = start('work', { now: T0 })
  assert.equal(isComplete(s, at(T0, 90)), true)
  assert.equal(remaining(s, at(T0, 90)), 0, 'never counts past zero')
})

test('a clock that jumps backwards does not read as negative progress', () => {
  const s = start('work', { now: T0 })
  assert.equal(elapsed(s, at(T0, -5)), 0)
  assert.equal(remaining(s, at(T0, -5)), 25 * MINUTE)
})

test('progress stays inside 0..1', () => {
  const s = start('work', { now: T0 })
  assert.equal(progress(s, T0), 0)
  assert.equal(progress(s, at(T0, 12.5)), 0.5)
  assert.equal(progress(s, at(T0, 90)), 1)
})

test('a session with a corrupt start time does not throw', () => {
  const broken = { ...start('work', { now: T0 }), startedAt: 'not a date' }
  assert.equal(elapsed(broken, T0), 0)
  assert.equal(remaining(broken, T0), 25 * MINUTE)
})

/* ------------------------------------------------------------- pausing */

test('a pause holds the remaining time still', () => {
  let s = start('work', { now: T0 })
  s = pause(s, at(T0, 10))
  assert.equal(isPaused(s), true)
  // Five minutes pass with the timer paused. Still fifteen left.
  assert.equal(remaining(s, at(T0, 15)), 15 * MINUTE)
  assert.equal(remaining(s, at(T0, 60)), 15 * MINUTE)
})

test('resuming gives back exactly the time that was held', () => {
  let s = start('work', { now: T0 })
  s = pause(s, at(T0, 10))
  s = resume(s, at(T0, 40)) // held for 30 minutes
  assert.equal(isPaused(s), false)
  assert.equal(remaining(s, at(T0, 40)), 15 * MINUTE)
  assert.equal(remaining(s, at(T0, 55)), 0)
})

test('pausing twice and resuming twice accumulates', () => {
  let s = start('work', { now: T0 })
  s = resume(pause(s, at(T0, 5)), at(T0, 15)) // held 10
  s = resume(pause(s, at(T0, 20)), at(T0, 25)) // held 5
  // 25 minutes of work still owed, 15 minutes of it already served.
  assert.equal(remaining(s, at(T0, 25)), 15 * MINUTE)
  assert.equal(remaining(s, at(T0, 40)), 0)
})

test('pausing an already-paused session changes nothing', () => {
  const s = pause(start('work', { now: T0 }), at(T0, 5))
  assert.equal(pause(s, at(T0, 9)), s)
})

test('resuming a running session changes nothing', () => {
  const s = start('work', { now: T0 })
  assert.equal(resume(s, at(T0, 9)), s)
})

/* ----------------------------------------------------------- the rounds */

test('the long break arrives on the fourth work session', () => {
  const settings = DEFAULT_SETTINGS
  assert.deepEqual(nextPhase(start('work', { now: T0, round: 1 }), settings), { phase: 'short', round: 1 })
  assert.deepEqual(nextPhase(start('work', { now: T0, round: 3 }), settings), { phase: 'short', round: 3 })
  assert.deepEqual(nextPhase(start('work', { now: T0, round: 4 }), settings), { phase: 'long', round: 4 })
})

test('a break always returns to work', () => {
  assert.equal(nextPhase(start('short', { now: T0, round: 2 }), DEFAULT_SETTINGS).phase, 'work')
  assert.equal(nextPhase(start('long', { now: T0, round: 4 }), DEFAULT_SETTINGS).phase, 'work')
})

test('a full round trip counts 1,2,3,4 then starts over', () => {
  const seen = []
  let s = start('work', { now: T0 })
  // Nine steps: work,short ×3, work, long, work — the ninth is the one that
  // shows the count restarting, which is the whole assertion.
  for (let i = 0; i < 9; i += 1) {
    if (s.phase === 'work') seen.push(s.round)
    s = advance(s, { now: T0 })
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 1], 'the long break resets the count')
})

test('a short break steps the round, a long one restarts it', () => {
  const afterShort = advance(start('short', { now: T0, round: 2 }), { now: T0 })
  assert.deepEqual([afterShort.phase, afterShort.round], ['work', 3])
  const afterLong = advance(start('long', { now: T0, round: 4 }), { now: T0 })
  assert.deepEqual([afterLong.phase, afterLong.round], ['work', 1])
})

/* ------------------------------------------------------- the task link */

test('a work session carries its task, a break never does', () => {
  assert.equal(start('work', { now: T0, entityId: 'task_1' }).entityId, 'task_1')
  assert.equal(start('short', { now: T0, entityId: 'task_1' }).entityId, null)
  assert.equal(start('long', { now: T0, entityId: 'task_1' }).entityId, null)
})

test('a finished work session records against its task', () => {
  const s = start('work', { now: T0, entityId: 'task_1' })
  const record = toRecord(s, { now: at(T0, 25) })
  assert.equal(record.minutes, 25)
  assert.equal(record.entityId, 'task_1')
  assert.equal(record.completed, true)
})

test('breaks are not recorded', () => {
  // A log of when somebody had a cup of tea is not what this is for.
  assert.equal(toRecord(start('short', { now: T0 }), { now: at(T0, 5) }), null)
  assert.equal(toRecord(start('long', { now: T0 }), { now: at(T0, 15) }), null)
})

test('a session abandoned in its first minute is not recorded', () => {
  const s = start('work', { now: T0 })
  assert.equal(toRecord(s, { now: at(T0, 0.5), completed: false }), null)
  assert.ok(toRecord(s, { now: at(T0, 4), completed: false }))
})

test('an abandoned session records what was actually served', () => {
  const s = start('work', { now: T0, entityId: 'task_1' })
  const record = toRecord(s, { now: at(T0, 9), completed: false })
  assert.equal(record.minutes, 9)
  assert.equal(record.completed, false)
})

test('paused time does not count as time worked', () => {
  let s = start('work', { now: T0, entityId: 'task_1' })
  s = resume(pause(s, at(T0, 5)), at(T0, 35)) // half an hour away from the desk
  const record = toRecord(s, { now: at(T0, 40), completed: false })
  assert.equal(record.minutes, 10, 'ten minutes of work, not forty')
})

test('a record never claims more than the phase was long', () => {
  const s = start('work', { now: T0, entityId: 'task_1' })
  assert.equal(toRecord(s, { now: at(T0, 300) }).minutes, 25)
})

/* --------------------------------------------------------- the settings */

test('phase lengths come from settings', () => {
  const settings = normaliseSettings({ work: 50, short: 10, long: 30 })
  assert.equal(lengthOf('work', settings), 50 * MINUTE)
  assert.equal(lengthOf('short', settings), 10 * MINUTE)
  assert.equal(lengthOf('long', settings), 30 * MINUTE)
})

test('a zero-length phase is refused', () => {
  // With autoContinue on, a zero-minute phase completes the instant it starts
  // and spins through rounds as fast as the event loop allows.
  const settings = normaliseSettings({ work: 0, short: -5, long: 0 })
  assert.equal(settings.work, 1)
  assert.equal(settings.short, 1)
  assert.equal(settings.long, 1)
})

test('absurd lengths are clamped, not accepted', () => {
  const settings = normaliseSettings({ work: 100000, roundsBeforeLong: 999 })
  assert.equal(settings.work, 180)
  assert.equal(settings.roundsBeforeLong, 12)
})

test('rubbish settings fall back rather than throw', () => {
  assert.deepEqual(normaliseSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normaliseSettings('nope'), DEFAULT_SETTINGS)
  assert.deepEqual(normaliseSettings({ work: 'twenty' }).work, DEFAULT_SETTINGS.work)
})

test('an unknown phase falls back to work rather than zero', () => {
  assert.equal(lengthOf('nonsense', DEFAULT_SETTINGS), 25 * MINUTE)
  assert.equal(start('nonsense', { now: T0 }).phase, 'work')
  assert.ok(PHASES.includes('work'))
})

/* ------------------------------------------------------------ formatting */

test('formats mm:ss, and grows an hours field only when needed', () => {
  assert.equal(clock(25 * MINUTE), '25:00')
  assert.equal(clock(9000), '00:09')
  assert.equal(clock(0), '00:00')
  assert.equal(clock(-5000), '00:00')
  assert.equal(clock(65 * MINUTE), '1:05:00')
})

test('the last second reads 00:01, never 00:00 early', () => {
  // Ceil rather than floor: a timer that shows 00:00 for a whole second
  // before firing looks broken.
  assert.equal(clock(1), '00:01')
  assert.equal(clock(999), '00:01')
  assert.equal(clock(1000), '00:01')
})

/* --------------------------------------------------------- persistence */

test('a session restored after a reload is exactly as correct as one that never stopped', () => {
  // The point of storing startedAt rather than a remaining count: the reload
  // can happen an hour later and the answer is still right.
  const live = start('work', { now: T0, entityId: 'task_1' })
  const restored = normaliseFocus({ session: JSON.parse(JSON.stringify(live)) }).session
  assert.deepEqual(restored, live)
  assert.equal(remaining(restored, at(T0, 10)), remaining(live, at(T0, 10)))
  assert.equal(isComplete(restored, at(T0, 60)), true)
})

test('a paused session restores still paused, holding the same time', () => {
  const held = pause(start('work', { now: T0 }), at(T0, 10))
  const restored = normaliseFocus({ session: JSON.parse(JSON.stringify(held)) }).session
  assert.equal(isPaused(restored), true)
  assert.equal(remaining(restored, at(T0, 600)), 15 * MINUTE)
})

test('a corrupt stored session is dropped rather than restored broken', () => {
  for (const bad of [
    { phase: 'nonsense', startedAt: T0.toISOString(), duration: 1000 },
    { phase: 'work', startedAt: 'not a date', duration: 1000 },
    { phase: 'work', startedAt: T0.toISOString(), duration: 0 },
    { phase: 'work', startedAt: T0.toISOString(), duration: -1 },
    { phase: 'work' },
    'nope', 42, null,
  ]) {
    assert.equal(normaliseFocus({ session: bad }).session, null, `${JSON.stringify(bad)} should not restore`)
  }
})

test('a negative paused total cannot buy back time', () => {
  const forged = { ...start('work', { now: T0 }), pausedMs: -60 * MINUTE }
  const restored = normaliseFocus({ session: forged }).session
  assert.equal(restored.pausedMs, 0)
  assert.equal(remaining(restored, at(T0, 10)), 15 * MINUTE)
})

test('the session log is capped and keeps the newest', () => {
  const sessions = Array.from({ length: MAX_SESSIONS + 50 }, (_, i) => ({
    startedAt: at(T0, i * 60).toISOString(),
    endedAt: at(T0, i * 60 + 25).toISOString(),
    minutes: 25,
    entityId: `task_${i}`,
    completed: true,
  }))
  const focus = normaliseFocus({ sessions })
  assert.equal(focus.sessions.length, MAX_SESSIONS)
  assert.equal(focus.sessions[0].entityId, `task_${MAX_SESSIONS + 49}`, 'newest first')
})

test('unusable records are dropped from the log', () => {
  const focus = normaliseFocus({
    sessions: [
      { startedAt: T0.toISOString(), endedAt: at(T0, 25).toISOString(), minutes: 25, completed: true },
      { startedAt: 'nope', endedAt: at(T0, 25).toISOString(), minutes: 25 },
      { startedAt: T0.toISOString(), endedAt: at(T0, 25).toISOString(), minutes: 0 },
      null,
    ],
  })
  assert.equal(focus.sessions.length, 1)
})

test('minutes add up per task', () => {
  const focus = normaliseFocus({
    sessions: [
      { startedAt: T0.toISOString(), endedAt: at(T0, 25).toISOString(), minutes: 25, entityId: 'task_1', completed: true },
      { startedAt: at(T0, 30).toISOString(), endedAt: at(T0, 55).toISOString(), minutes: 25, entityId: 'task_1', completed: true },
      { startedAt: at(T0, 60).toISOString(), endedAt: at(T0, 70).toISOString(), minutes: 10, entityId: 'task_2', completed: false },
    ],
  })
  assert.equal(minutesOn(focus, 'task_1'), 50)
  assert.equal(minutesOn(focus, 'task_2'), 10)
  assert.equal(minutesOn(focus, 'task_missing'), 0)
})

test('an empty focus slice is valid', () => {
  const focus = normaliseFocus(null)
  assert.equal(focus.session, null)
  assert.deepEqual(focus.sessions, [])
  assert.deepEqual(focus.settings, DEFAULT_SETTINGS)
  assert.deepEqual(emptyFocus(), focus)
})
