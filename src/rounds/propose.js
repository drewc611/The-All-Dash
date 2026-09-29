import { makeMove } from './moves.js'
import { getState } from '../core/store.js'
import { dayKey, startOfDay } from '../core/time.js'

/**
 * Where proposals come from.
 *
 * Deliberately not a model. A round with no ceiling spends nothing and calls
 * nothing - that rule already holds for findings and it holds harder here,
 * because a proposal is a change to your records and "the model suggested it"
 * is not a reason anybody can check. Every rule below is arithmetic over dates
 * and statuses the workspace already holds, so the justification is a fact
 * about the record rather than a sentence about a sentence.
 *
 * Each rule names the record it read as its own source. That looks circular
 * for a second and is not: the claim being made is "this record's own due date
 * is eleven days past and its status still says nobody has started", which the
 * record either supports or does not. Clicking the chip shows you the thing
 * the arithmetic was done on.
 *
 * Days are counted in local time, like every other date in this app. A task
 * due yesterday is due yesterday where the person is, and counting in UTC
 * makes it late a day early for anyone far enough west.
 */

/** A task is stale when nothing has touched it for this long. */
const STALE_DAYS = 10

/**
 * Whole days between two local calendar days.
 *
 * `startOfDay` is handed the value directly rather than `new Date(value)`,
 * and that is the entire correctness of this function. A due date is the bare
 * string "2026-09-18", which `new Date` reads as UTC midnight - the previous
 * evening anywhere west of Greenwich. Wrapping it first would make every task
 * one day later than it is in the Americas, and the app's own toDate exists to
 * stop exactly that, which startOfDay already calls.
 *
 * Rounded rather than floored because the two ends are local midnights and a
 * day that crosses a DST change is 23 or 25 hours long.
 */
export function daysBetween(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86400000)
}

const RULES = [
  {
    id: 'overdue-unstarted',
    /**
     * Past its date and nobody has picked it up. Raising the priority is the
     * smallest honest response: it does not claim to know why, it does not
     * touch the date, and it puts the thing where a person will see it.
     */
    propose(entity, now) {
      if (entity.type !== 'task' || entity.status !== 'open' || !entity.due) return null
      const late = daysBetween(entity.due, now)
      if (late < 1) return null
      const from = Number(entity.priority) || 0
      if (from >= 2) return null
      return makeMove({
        kind: 'priority',
        entityId: entity.id,
        from,
        to: from + 1,
        sources: [entity.id],
        why: `Due ${late} day${late === 1 ? '' : 's'} ago and still not started.`,
      })
    },
  },
  {
    id: 'doing-but-silent',
    /**
     * Marked as in progress and untouched for a week and a half. Proposing
     * "blocked" rather than "open" because the difference is the useful one:
     * something that was started and then stopped is a different problem from
     * something nobody began, and the board has a column for it.
     */
    propose(entity, now) {
      if (entity.type !== 'task' || entity.status !== 'doing') return null
      const touched = entity.updatedAt || entity.createdAt
      if (!touched) return null
      const quiet = daysBetween(touched, now)
      if (quiet < STALE_DAYS) return null
      return makeMove({
        kind: 'status',
        entityId: entity.id,
        from: 'doing',
        to: 'blocked',
        sources: [entity.id],
        why: `Marked as doing, untouched for ${quiet} days.`,
      })
    },
  },
]

export const RULE_IDS = RULES.map((r) => r.id)

/**
 * Every move the rules propose over a workspace, newest records last.
 *
 * `existing` is the moves already in the ledger. A rule that fired yesterday
 * and was declined does not get to ask again tomorrow: a queue that re-asks
 * the same question every morning trains you to clear it without reading, and
 * then the one proposal that mattered goes out with the rest. A move that was
 * applied is likewise not re-proposed, because the record now disagrees with
 * its own `from` and it would be refused anyway.
 */
export function proposeMoves({ now = new Date(), state = getState(), existing = [] } = {}) {
  const seen = new Set(existing.map((m) => `${m.kind}:${m.entityId}`))
  const out = []
  for (const entity of Object.values(state.entities || {})) {
    for (const rule of RULES) {
      const move = rule.propose(entity, now)
      if (!move) continue
      const key = `${move.kind}:${move.entityId}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...move, rule: rule.id })
    }
  }
  return out
}

/** A one-line summary for the brief that carried them. */
export const summariseMoves = (moves) =>
  !moves?.length ? 'No changes to propose.'
    : `${moves.length} change${moves.length === 1 ? '' : 's'} proposed, none applied.`

export { dayKey }
