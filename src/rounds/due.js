import { dayKey, startOfWeek, startOfDay, addDays, toDate } from '../core/time.js'

/**
 * When a round is next owed, and whether it is owed now.
 *
 * A round is a standing piece of work: a question asked of the workspace on a
 * cadence, answered from the records already here.
 *
 * Two decisions shape everything in this file.
 *
 * **The period is a local one.** A daily round is owed once per day where the
 * person is, not once per UTC day. Somebody in Auckland finishing at 22:00 and
 * opening the app at 09:00 the next morning has crossed a day; measuring in
 * UTC says they have not. Every key here is built from the local calendar, the
 * same rule the Focus analytics settled on.
 *
 * **A missed period is not a backlog.** Away for a week, a daily round is owed
 * once on your return, not seven times. Nobody wants seven briefs about a
 * Tuesday that is over, and a run costs money. This is the difference between
 * a cadence and a queue, and it is why `due` compares the current period
 * against the last run rather than counting the periods in between.
 */

export const CADENCES = ['daily', 'weekdays', 'weekly', 'monthly']

export const CADENCE_LABELS = {
  daily: 'Every day',
  weekdays: 'Weekdays',
  weekly: 'Every week',
  monthly: 'Every month',
}

const monthKey = (d) => {
  const x = startOfDay(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}

/** Saturday and Sunday, in the person's own week. */
export const isWeekend = (d) => [0, 6].includes(startOfDay(d).getDay())

/**
 * The period a moment falls in, for a given cadence.
 *
 * Two moments sharing a key are the same period, so the round has already run
 * for it. `weekdays` keys by day like `daily` does: the weekend is handled by
 * refusing to run at all, not by folding Saturday into Friday, because a
 * Saturday that folded backwards would make Monday look already done.
 */
export function periodKey(cadence, when) {
  const d = toDate(when)
  if (cadence === 'weekly') return dayKey(startOfWeek(d))
  if (cadence === 'monthly') return monthKey(d)
  return dayKey(d)
}

/**
 * Is this round owed right now?
 *
 * A round that has never run is owed, unless the cadence excludes today.
 * A disabled round is never owed - the switch means what it says.
 */
export function isDue(round, now = new Date()) {
  if (!round || round.enabled === false) return false
  if (!CADENCES.includes(round.cadence)) return false
  if (round.cadence === 'weekdays' && isWeekend(now)) return false
  if (!round.lastRunAt) return true
  return periodKey(round.cadence, round.lastRunAt) !== periodKey(round.cadence, now)
}

/**
 * The start of the next period this round could run in.
 *
 * Deliberately not a promise about when it *will* run: this app has no server
 * and a shut laptop runs nothing. It is the earliest moment the round becomes
 * owed, and the view says "next time you open the app after" rather than
 * dressing it up as a scheduled job.
 */
export function nextDueAt(round, now = new Date()) {
  if (!round || round.enabled === false || !CADENCES.includes(round.cadence)) return null
  if (isDue(round, now)) return startOfDay(now)

  const from = startOfDay(now)
  if (round.cadence === 'daily') return addDays(from, 1)
  if (round.cadence === 'weekdays') {
    let next = addDays(from, 1)
    while (isWeekend(next)) next = addDays(next, 1)
    return next
  }
  if (round.cadence === 'weekly') return addDays(startOfWeek(now), 7)
  // The first of next month, found by walking from this one rather than by
  // adding 31 days: months are not all the same length and setMonth(+1) on a
  // 31st lands in the month after next.
  const x = startOfDay(now)
  return new Date(x.getFullYear(), x.getMonth() + 1, 1)
}

/** Every round owed now, in the order they were created. */
export const dueNow = (rounds = [], now = new Date()) => rounds.filter((r) => isDue(r, now))
