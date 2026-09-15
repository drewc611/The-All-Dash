import test from 'node:test'
import assert from 'node:assert/strict'

import {
  withinRange,
  minutesPerDay,
  minutesPerHour,
  minutesPerTask,
  streak,
  summary,
  hoursAndMinutes,
} from '../src/focus/analytics.js'
import { toRecord, start } from '../src/focus/timer.js'
import { normaliseFocus } from '../src/focus/schema.js'
import { startOfDay, endOfDay, addDays, dayKey } from '../src/core/time.js'

/*
 * These run under TZ=UTC, America/Los_Angeles and Pacific/Auckland in CI, so
 * every fixture is built from LOCAL wall-clock parts rather than an ISO string
 * with a Z on it. A test written as "2026-09-14T22:00:00Z" asserts a different
 * local day in each of those three zones, which is how a timezone bug gets a
 * green tick in two of them.
 */
const at = (y, mo, d, h = 12, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0)

const record = (endedAt, minutes, { entityId = null, completed = true, startedAt } = {}) => ({
  startedAt: (startedAt || new Date(endedAt.getTime() - minutes * 60000)).toISOString(),
  endedAt: endedAt.toISOString(),
  minutes,
  entityId,
  completed,
})

const rangeOf = (from, to) => ({ from: startOfDay(from), to: endOfDay(to) })

/* ------------------------------------------------------------- the window */

test('a session belongs to the window by when it ended', () => {
  const sessions = [
    record(at(2026, 9, 10), 25),
    record(at(2026, 9, 14), 25),
    record(at(2026, 9, 20), 25),
  ]
  const kept = withinRange(sessions, rangeOf(at(2026, 9, 12), at(2026, 9, 16)))
  assert.equal(kept.length, 1)
  assert.equal(kept[0].minutes, 25)
})

test('the window includes both of its edge days in full', () => {
  // The bug this pins: comparing against a raw `from` rather than its start of
  // day silently drops the morning of the first day in the range.
  const sessions = [
    record(at(2026, 9, 12, 0, 1), 25),
    record(at(2026, 9, 16, 23, 59), 25),
  ]
  assert.equal(withinRange(sessions, rangeOf(at(2026, 9, 12), at(2026, 9, 16))).length, 2)
})

test('no range means no filtering, and the input is never mutated', () => {
  const sessions = [record(at(2026, 9, 10), 25)]
  const out = withinRange(sessions, null)
  assert.equal(out.length, 1)
  assert.notEqual(out, sessions)
})

/* ---------------------------------------------------------------- per day */

test('every day in the window gets a bucket, including the empty ones', () => {
  const sessions = [record(at(2026, 9, 14), 50)]
  const points = minutesPerDay(sessions, rangeOf(at(2026, 9, 12), at(2026, 9, 16)))
  assert.equal(points.length, 5, 'a chart that skips your bad days flatters you')
  assert.deepEqual(points.map((p) => p.value), [0, 0, 50, 0, 0])
})

test('sessions on the same day add up', () => {
  const sessions = [record(at(2026, 9, 14, 9), 25), record(at(2026, 9, 14, 15), 30)]
  const points = minutesPerDay(sessions, rangeOf(at(2026, 9, 14), at(2026, 9, 14)))
  assert.deepEqual(points, [{ key: dayKey(at(2026, 9, 14)), value: 55 }])
})

test('a session is bucketed by its LOCAL day, in every timezone', () => {
  // 23:30 local is today wherever you are running this. Under UTC bucketing it
  // is tomorrow for anyone behind Greenwich and yesterday for anyone ahead.
  const late = at(2026, 9, 14, 23, 30)
  const points = minutesPerDay([record(late, 20)], rangeOf(at(2026, 9, 14), at(2026, 9, 14)))
  assert.equal(points.length, 1)
  assert.equal(points[0].key, dayKey(late))
  assert.equal(points[0].value, 20)
})

test('a very wide window narrows to the days that hold sessions', () => {
  const sessions = [record(at(2026, 9, 14), 25)]
  const wide = rangeOf(new Date(2000, 0, 1), addDays(new Date(2026, 8, 14), 365))
  const points = minutesPerDay(sessions, wide)
  assert.ok(points.length > 0 && points.length < 30, `expected a narrow series, got ${points.length}`)
  assert.equal(points.reduce((t, p) => t + p.value, 0), 25)
})

test('a wide window with no sessions is empty rather than ten thousand zeroes', () => {
  const wide = rangeOf(new Date(2000, 0, 1), new Date(2026, 8, 14))
  assert.deepEqual(minutesPerDay([], wide), [])
})

/* --------------------------------------------------------------- per hour */

test('all twenty-four hours are present even when one is used', () => {
  const hours = minutesPerHour([record(at(2026, 9, 14, 9, 25), 25)], null)
  assert.equal(hours.length, 24)
  assert.equal(hours.filter((h) => h.value > 0).length, 1)
})

test('a session is credited to the hour it started, not the one it ended in', () => {
  // Started 09:50, ran 25 minutes, ended 10:15. The question is when you sat
  // down, so this is a 9am session.
  const started = at(2026, 9, 14, 9, 50)
  const ended = at(2026, 9, 14, 10, 15)
  const hours = minutesPerHour([record(ended, 25, { startedAt: started })], null)
  assert.equal(hours[9].value, 25)
  assert.equal(hours[10].value, 0)
})

test('a session with an unparseable start is skipped rather than landing in hour 0', () => {
  const broken = { ...record(at(2026, 9, 14), 25), startedAt: 'not a date' }
  const hours = minutesPerHour([broken], null)
  assert.equal(hours.reduce((t, h) => t + h.value, 0), 0)
})

/* --------------------------------------------------------------- per task */

const titleOf = (id) => ({ t1: 'Write the release notes', t2: 'Fix the scrim' }[id])

test('tasks are ranked by minutes, highest first', () => {
  const sessions = [
    record(at(2026, 9, 14), 25, { entityId: 't1' }),
    record(at(2026, 9, 14), 50, { entityId: 't2' }),
    record(at(2026, 9, 13), 10, { entityId: 't1' }),
  ]
  const rows = minutesPerTask(sessions, null, { titleOf })
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ['Fix the scrim', 50],
    ['Write the release notes', 35],
  ])
})

test('unlinked time is shown as its own row, never dropped', () => {
  // Dropping it makes the rows sum to less than the total on the card beside
  // them, and two numbers that disagree cost you trust in both.
  const sessions = [
    record(at(2026, 9, 14), 25, { entityId: 't1' }),
    record(at(2026, 9, 14), 40),
  ]
  const rows = minutesPerTask(sessions, null, { titleOf })
  const untracked = rows.find((r) => r.untracked)
  assert.ok(untracked, 'unlinked sessions vanished')
  assert.equal(untracked.value, 40)
  assert.equal(rows.reduce((t, r) => t + r.value, 0), 65)
})

test('the rows always sum to the total minutes, however many tasks there are', () => {
  const sessions = Array.from({ length: 20 }, (_, i) =>
    record(at(2026, 9, 14), i + 1, { entityId: `task-${i}` })
  )
  sessions.push(record(at(2026, 9, 14), 7))
  const total = sessions.reduce((t, s) => t + s.minutes, 0)
  const rows = minutesPerTask(sessions, null, { titleOf: (id) => id, limit: 5 })
  assert.equal(rows.reduce((t, r) => t + r.value, 0), total)
  assert.ok(rows.some((r) => /more tasks/.test(r.label)), 'the tail was dropped instead of rolled up')
})

test('a session pointing at a deleted task still shows its minutes', () => {
  const rows = minutesPerTask([record(at(2026, 9, 14), 25, { entityId: 'gone' })], null, { titleOf })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].value, 25)
  assert.match(rows[0].label, /no longer here/)
})

/* ---------------------------------------------------------------- streaks */

test('consecutive days count, and the run stops at the first gap', () => {
  const now = at(2026, 9, 14)
  const sessions = [
    record(at(2026, 9, 14), 25),
    record(at(2026, 9, 13), 25),
    record(at(2026, 9, 12), 25),
    record(at(2026, 9, 10), 25), // the gap on the 11th ends it
  ]
  assert.equal(streak(sessions, { now }), 3)
})

test('a day not worked yet does not break yesterday-s streak', () => {
  // Checking at 9am before you have started should not tell you the streak is
  // gone; it is only gone once a whole day passes with nothing in it.
  const now = at(2026, 9, 14, 9)
  const sessions = [record(at(2026, 9, 13), 25), record(at(2026, 9, 12), 25)]
  assert.equal(streak(sessions, { now }), 2)
})

test('two clear days is no streak', () => {
  assert.equal(streak([record(at(2026, 9, 11), 25)], { now: at(2026, 9, 14) }), 0)
})

test('no sessions is no streak', () => {
  assert.equal(streak([], { now: at(2026, 9, 14) }), 0)
})

/* ---------------------------------------------------------------- summary */

test('the summary counts what happened in the window and nothing outside it', () => {
  const sessions = [
    record(at(2026, 9, 14), 25, { completed: true }),
    record(at(2026, 9, 14), 12, { completed: false }),
    record(at(2026, 9, 1), 25, { completed: true }),
  ]
  const s = summary(sessions, rangeOf(at(2026, 9, 12), at(2026, 9, 16)), { now: at(2026, 9, 14) })
  assert.equal(s.sessions, 2)
  assert.equal(s.minutes, 37)
  assert.equal(s.completed, 1)
  assert.equal(s.abandoned, 1)
  assert.equal(s.completionRate, 0.5)
})

test('no sessions means no completion rate, not a zero percent', () => {
  // "You finished 0% of your pomodoros" and "you have not run one" are
  // different facts, and only one of them is a judgement.
  const s = summary([], rangeOf(at(2026, 9, 12), at(2026, 9, 16)), { now: at(2026, 9, 14) })
  assert.equal(s.completionRate, null)
  assert.equal(s.minutes, 0)
  assert.equal(s.averageMinutes, 0)
  assert.equal(s.bestDay, null)
})

test('the average is over days worked, not over days in the window', () => {
  // 60 minutes across two days inside a 30-day window is an hour a day on the
  // days you worked, not two minutes a day.
  const sessions = [record(at(2026, 9, 14), 30), record(at(2026, 9, 13), 30)]
  const s = summary(sessions, rangeOf(addDays(at(2026, 9, 14), -29), at(2026, 9, 14)), { now: at(2026, 9, 14) })
  assert.equal(s.activeDays, 2)
  assert.equal(s.averageMinutes, 30)
})

test('the best day is the biggest one in the window', () => {
  const sessions = [
    record(at(2026, 9, 14), 20),
    record(at(2026, 9, 13), 75),
    record(at(2026, 9, 12), 40),
  ]
  const s = summary(sessions, rangeOf(at(2026, 9, 12), at(2026, 9, 14)), { now: at(2026, 9, 14) })
  assert.equal(s.bestDay.value, 75)
  assert.equal(s.bestDay.key, dayKey(at(2026, 9, 13)))
})

/* ----------------------------------------------------------- the end to end */

test('what the timer records is what the charts read', () => {
  // The two modules are only connected by the record shape, so this asserts
  // the seam rather than trusting two sets of fixtures to agree.
  const settings = { work: 25, short: 5, long: 15, roundsBeforeLong: 4, autoContinue: false, chime: true }
  const began = at(2026, 9, 14, 9, 0)
  const session = start('work', { now: began, settings, entityId: 't1' })
  const rec = toRecord(session, { now: at(2026, 9, 14, 9, 25), completed: true })
  assert.ok(rec, 'the timer recorded nothing for a full work session')

  const { sessions } = normaliseFocus({ sessions: [rec] })
  assert.equal(sessions.length, 1, 'the schema rejected a record its own timer produced')

  const day = minutesPerDay(sessions, rangeOf(at(2026, 9, 14), at(2026, 9, 14)))
  assert.equal(day[0].value, 25)
  assert.equal(minutesPerHour(sessions, null)[9].value, 25)
  assert.equal(minutesPerTask(sessions, null, { titleOf })[0].label, 'Write the release notes')
  assert.equal(summary(sessions, null, { now: at(2026, 9, 14) }).minutes, 25)
})

test('a break is never charted, because the timer never records one', () => {
  const settings = { work: 25, short: 5, long: 15, roundsBeforeLong: 4, autoContinue: false, chime: true }
  const brk = start('short', { now: at(2026, 9, 14, 9, 25), settings, entityId: 't1' })
  assert.equal(toRecord(brk, { now: at(2026, 9, 14, 9, 30), completed: true }), null)
})

/* ------------------------------------------------------------- formatting */

test('minutes read as a person says them', () => {
  assert.equal(hoursAndMinutes(0), '0m')
  assert.equal(hoursAndMinutes(45), '45m')
  assert.equal(hoursAndMinutes(60), '1h')
  assert.equal(hoursAndMinutes(155), '2h 35m')
  assert.equal(hoursAndMinutes(-5), '0m')
  assert.equal(hoursAndMinutes(undefined), '0m')
})

/* ------------------------------------------------------- the flag gate */

/*
 * The widgets themselves are JSX and cannot be imported under `node --test`,
 * so these read the source. That is weaker than rendering them and it is the
 * part that CI can actually run: the Playwright walk-through proves the
 * behaviour, and this stops the declaration being dropped in an edit six
 * months from now without anyone opening a browser.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

test('every Focus widget is gated on the focus flag', () => {
  const src = read('src/ui/widgets/focus.jsx')
  // Anchored to the start of a line so the prose in this file's own header
  // comment, which names the field, is not counted as a declaration.
  const ids = [...src.matchAll(/^  id: '([a-z-]+)',$/gm)].map((m) => m[1])
  assert.ok(ids.length >= 3, `expected the Focus widgets, found ${ids.join(', ')}`)
  assert.equal(
    [...src.matchAll(/^  flag: 'focus',$/gm)].length,
    ids.length,
    'a Focus widget without the flag renders charts of a feature this build does not have'
  )
})

test('the board honours a widget flag in both the picker and the render path', () => {
  // Two sites, and hiding it in only one is the worse half of the bug: the
  // picker would offer a widget that renders nothing.
  const board = read('src/ui/Board.jsx')
  assert.match(board, /useFlags/, 'Board reads no flags at all')
  assert.match(board, /widget\?\.flag && !isOn\(widget\.flag\)/, 'saved boards still render flagged-off widgets')
  assert.match(board, /!w\.flag \|\| isOn\(w\.flag\)/, 'the picker still offers flagged-off widgets')
})

test('a flagged-off widget is hidden, not deleted', () => {
  // Turning the flag back on has to bring the board back as it was, or the
  // switch costs you your layout and nobody flips it twice.
  const board = read('src/ui/Board.jsx')
  assert.doesNotMatch(
    board,
    /widget\?\.flag[^\n]*removeWidget/,
    'the flag gate removes widgets from the saved layout'
  )
})

test('the registry documents the flag field it now honours', () => {
  assert.match(read('src/core/registry.js'), /\[spec\.flag\]/)
})
