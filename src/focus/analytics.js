/*
 * Focus sessions, turned into the shapes a chart takes.
 *
 * Everything here buckets on LOCAL days and LOCAL hours, never UTC. A session
 * is something a person did at a time they lived through: bucketing a 9pm
 * session in California by UTC puts it on tomorrow's bar and shifts "when do
 * I actually focus" eight hours to the right for everybody west of Greenwich.
 * `dayKey` and `getHours` are local by construction, which is the whole
 * reason they are used rather than slicing the ISO string.
 *
 * All of it is pure arithmetic over the session log. Nothing here reads the
 * store, holds a timer or touches the DOM, so it is testable without a
 * browser and the widgets stay thin.
 */

import { dayKey, startOfDay, endOfDay, addDays, toDate, MS } from '../core/time.js'

/** A day window is [from, to]; a session belongs to it by when it ENDED. */
export function withinRange(sessions, range) {
  if (!range?.from || !range?.to) return [...(sessions || [])]
  const from = startOfDay(range.from).getTime()
  const to = endOfDay(range.to).getTime()
  return (sessions || []).filter((s) => {
    const t = Date.parse(s.endedAt)
    return Number.isFinite(t) && t >= from && t <= to
  })
}

/**
 * Minutes per local day, as `{ key, value }` points a BarChart takes.
 *
 * Every day in the window gets a bucket, including the empty ones — a bar
 * chart that silently skips the days you did nothing is the chart that makes
 * a bad week look like a good one. A very wide window ("All time") is narrowed
 * to the days that actually hold sessions, with a week of margin, so the
 * series never runs to thousands of points.
 */
export function minutesPerDay(sessions, range, { maxBuckets = 400 } = {}) {
  const rows = withinRange(sessions, range)
  let start = startOfDay(range?.from || new Date())
  let end = startOfDay(range?.to || new Date())

  if ((end - start) / MS.day > maxBuckets) {
    let lo = Infinity
    let hi = -Infinity
    for (const s of rows) {
      const t = Date.parse(s.endedAt)
      if (!Number.isFinite(t)) continue
      if (t < lo) lo = t
      if (t > hi) hi = t
    }
    if (!Number.isFinite(lo)) return []
    start = startOfDay(new Date(Math.max(start.getTime(), lo - 7 * MS.day)))
    end = startOfDay(new Date(Math.min(end.getTime(), hi)))
  }

  const buckets = new Map()
  for (let d = start; d <= end; d = addDays(d, 1)) buckets.set(dayKey(d), 0)
  for (const s of rows) {
    const key = dayKey(toDate(s.endedAt))
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + s.minutes)
  }
  return [...buckets.entries()].map(([key, value]) => ({ key, value }))
}

/**
 * Minutes by local hour of day, 0..23, always all twenty-four.
 *
 * A session is credited to the hour it STARTED. Splitting a 25-minute session
 * across two hours would be more precise and less useful: the question this
 * answers is "when do I sit down to work", and that has one answer per session.
 */
export function minutesPerHour(sessions, range) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), hour, value: 0 }))
  for (const s of withinRange(sessions, range)) {
    const at = toDate(s.startedAt)
    if (Number.isNaN(at.getTime())) continue
    hours[at.getHours()].value += s.minutes
  }
  return hours
}

/**
 * Minutes per task, ranked, with unlinked sessions kept as one row.
 *
 * Unlinked time is shown rather than dropped. Dropping it makes the rows sum
 * to less than the total on the card beside them, and the first thing anyone
 * does with two numbers that disagree is stop trusting both.
 */
export function minutesPerTask(sessions, range, { titleOf, limit = 8 } = {}) {
  const totals = new Map()
  let untracked = 0
  for (const s of withinRange(sessions, range)) {
    if (!s.entityId) { untracked += s.minutes; continue }
    totals.set(s.entityId, (totals.get(s.entityId) || 0) + s.minutes)
  }

  const rows = [...totals.entries()]
    .map(([id, value]) => ({ id, label: titleOf?.(id) || 'A task that is no longer here', value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

  const top = rows.slice(0, limit)
  const rest = rows.slice(limit).reduce((sum, r) => sum + r.value, 0)
  if (rest > 0) top.push({ id: null, label: `${rows.length - limit} more tasks`, value: rest })
  if (untracked > 0) top.push({ id: null, label: 'Not linked to a task', value: untracked, untracked: true })
  return top
}

/** The current run of consecutive local days with at least one session. */
export function streak(sessions, { now = new Date() } = {}) {
  const days = new Set((sessions || []).map((s) => dayKey(toDate(s.endedAt))))
  if (!days.size) return 0
  // Today not being done yet is not a broken streak, so start counting at
  // today when today has a session and at yesterday when it does not.
  let cursor = startOfDay(now)
  if (!days.has(dayKey(cursor))) {
    cursor = addDays(cursor, -1)
    if (!days.has(dayKey(cursor))) return 0
  }
  let run = 0
  while (days.has(dayKey(cursor))) {
    run += 1
    cursor = addDays(cursor, -1)
  }
  return run
}

/**
 * The numbers above the chart.
 *
 * `completionRate` is null rather than 0 when there are no sessions, because
 * "you finished 0% of your pomodoros" and "you have not run one" are different
 * facts and only one of them is a judgement.
 */
export function summary(sessions, range, { now = new Date() } = {}) {
  const rows = withinRange(sessions, range)
  const minutes = rows.reduce((t, s) => t + s.minutes, 0)
  const completed = rows.filter((s) => s.completed).length
  const perDay = minutesPerDay(sessions, range)
  const active = perDay.filter((p) => p.value > 0)
  const best = active.reduce((top, p) => (!top || p.value > top.value ? p : top), null)

  return {
    minutes,
    sessions: rows.length,
    completed,
    abandoned: rows.length - completed,
    completionRate: rows.length ? completed / rows.length : null,
    // Averaged over the days you actually worked, not over the window. A
    // 30-day average that counts three weeks of annual leave as zeroes is
    // arithmetic nobody asked for.
    averageMinutes: active.length ? Math.round(minutes / active.length) : 0,
    activeDays: active.length,
    bestDay: best,
    streak: streak(sessions, { now }),
  }
}

/** "2h 35m", or "0m" — the unit a person uses for an afternoon. */
export function hoursAndMinutes(totalMinutes) {
  const total = Math.max(0, Math.round(Number(totalMinutes) || 0))
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (!hours) return `${minutes}m`
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}
