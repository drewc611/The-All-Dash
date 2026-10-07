import { q } from '../core/query.js'
import { startOfDay, endOfDay, toDate } from '../core/time.js'
import { buildTriage } from '../engine/triage.js'
import { FIELDS, FIELD_INDEX, VIEW_GROUPS, viewGroup } from './catalogue.js'

/**
 * The state of the workspace, reduced to the handful of facts the layout model
 * reads. Nothing here is a feature the model invented: each is a count or a
 * bucket a person could check by looking, which is what lets the proposal say
 * what it was shown rather than gesture at "your context".
 *
 * Time is a parameter. Everything here that depends on today takes `now`, so a
 * test can ask what a Monday morning looks like on any machine in any zone.
 */

/** 0 / 1-2 / 3-5 / 6+, the bucketing most counts share. */
export const countBucket = (n) => (n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : 3)

const hourBand = (hour) =>
  hour >= 22 || hour < 5 ? 0 : hour < 8 ? 1 : hour < 12 ? 2 : hour < 14 ? 3 : hour < 18 ? 4 : 5

/** Monday is 0, which is how a week reads and how the weekday field is laid out. */
const weekday = (date) => (date.getDay() + 6) % 7

const focusBucket = (minutes) => (minutes <= 0 ? 0 : minutes < 25 ? 1 : minutes < 90 ? 2 : 3)
const sizeBucket = (n) => (n < 5 ? 0 : n < 50 ? 1 : n < 300 ? 2 : 3)
const urgentBucket = (n) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3)
const tenureBucket = (sessions) => (sessions <= 2 ? 0 : sessions <= 10 ? 1 : sessions <= 50 ? 2 : 3)

/**
 * The two view groups a person opens most, from the usage counters. Today is
 * left out: the board being arranged lives there, so opening it says nothing
 * about what else they reach for. Ties go to the earlier group so the result
 * does not depend on object key order.
 */
export function topViews(usageViews = {}) {
  const totals = new Map()
  for (const [id, n] of Object.entries(usageViews || {})) {
    const group = viewGroup(id)
    if (!group || !Number.isFinite(n) || n <= 0) continue
    totals.set(group, (totals.get(group) || 0) + n)
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || VIEW_GROUPS.indexOf(a[0]) - VIEW_GROUPS.indexOf(b[0]))
  const index = (entry) => (entry ? VIEW_GROUPS.indexOf(entry[0]) : 0)
  return [index(ranked[0]), index(ranked[1])]
}

/**
 * @param {object} state  the app state
 * @param {Date} [now]
 * @returns {number[]} one value per field in catalogue FIELDS order
 */
export function situationOf(state, now = new Date()) {
  const entities = state?.entities || {}
  const rows = Object.values(entities)
  const today0 = startOfDay(now)
  const today1 = endOfDay(now)

  // "Late" means due before today began. A bare day key is local midnight, so a
  // task due today sits exactly on the boundary, and `due()` is inclusive at
  // both ends; stepping the edge back a millisecond keeps today's work out of
  // the late pile (the Triage view makes a different call about that, on its own).
  const late = q(rows).type('task').open().due({ before: new Date(today0.getTime() - 1) }).all().length
  const dueToday = q(rows).type('task').open().due({ after: today0, before: today1 }).all().length
  const events = q(rows).type('event').between(today0, today1, 'at').where((e) => e.status !== 'cancelled').all().length
  const risks = q(rows).type('risk').open().all().length
  const questions = q(rows).type('note').tagged('question').all().length

  const triage = buildTriage(entities, { now, mutes: state?.triage || {}, brain: state?.brain || null })
  const urgent = triage.filter((s) => s.severity === 'critical' || s.severity === 'serious').length

  const focusMinutes = (state?.focus?.sessions || [])
    .filter((s) => s?.endedAt && toDate(s.endedAt) >= today0 && toDate(s.endedAt) <= today1)
    .reduce((sum, s) => sum + (Number(s.minutes) || 0), 0)

  const usage = state?.brain?.usage || {}
  const [top, next] = topViews(usage.views)

  const out = new Array(FIELDS.length).fill(0)
  out[FIELD_INDEX.hour] = hourBand(now.getHours())
  out[FIELD_INDEX.day] = weekday(now)
  out[FIELD_INDEX.overdue] = countBucket(late)
  out[FIELD_INDEX.dueToday] = countBucket(dueToday)
  out[FIELD_INDEX.events] = countBucket(events)
  out[FIELD_INDEX.risks] = countBucket(risks)
  out[FIELD_INDEX.questions] = countBucket(questions)
  out[FIELD_INDEX.urgent] = urgentBucket(urgent)
  out[FIELD_INDEX.focus] = focusBucket(focusMinutes)
  out[FIELD_INDEX.topView] = top
  out[FIELD_INDEX.nextView] = next
  out[FIELD_INDEX.size] = sizeBucket(rows.length)
  out[FIELD_INDEX.boards] = countBucket(state?.work?.boards?.filter((b) => !b.archived).length || 0)
  out[FIELD_INDEX.telamate] = state?.settings?.telamate?.url ? 1 : 0
  out[FIELD_INDEX.tenure] = tenureBucket(usage.sessions || 0)
  return out
}

const COUNT = ['no', '1-2', '3-5', '6 or more']

/**
 * One field's value as a short phrase a person would say: "3-5 late tasks",
 * "no meetings today", "Monday morning". Every value has one, including the
 * zeros, because "no meetings today" is exactly the fact that takes the agenda
 * off the board.
 */
export function describeField(values, id) {
  const f = FIELDS[FIELD_INDEX[id]]
  const v = values[FIELD_INDEX[id]]
  const label = f.values[v]
  switch (id) {
    case 'hour': return `${FIELDS[FIELD_INDEX.day].values[values[FIELD_INDEX.day]]} ${label}`
    case 'day': return FIELDS[FIELD_INDEX.day].values[v]
    case 'overdue': return `${COUNT[v]} late tasks`
    case 'dueToday': return `${COUNT[v]} tasks due today`
    case 'events': return `${COUNT[v]} meetings today`
    case 'risks': return `${COUNT[v]} open risks`
    case 'questions': return `${COUNT[v]} open questions`
    case 'urgent': return v === 0 ? 'nothing urgent' : `${label} urgent ${label === '1' ? 'signal' : 'signals'}`
    case 'focus': return v === 0 ? 'no focus time yet today' : `${label} of focus today`
    case 'topView': return v === 0 ? 'no favourite view yet' : `you mostly open ${label}`
    case 'nextView': return v === 0 ? 'no second favourite view' : `then ${label}`
    case 'size': return `a ${label} workspace`
    case 'boards': return v === 0 ? 'no boards' : `${label} ${v === 1 ? 'board' : 'boards'}`
    case 'telamate': return v === 1 ? 'Telamate connected' : 'Telamate not connected'
    case 'tenure': return v === 0 ? 'new here' : v === 1 ? 'a few sessions in' : v === 2 ? 'a regular user' : 'a long-time user'
    default: return `${f.label}: ${label}`
  }
}
