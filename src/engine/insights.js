import { q, daily, trend, momentum, anomalies, streak } from '../core/query.js'
import { addDays, dayKey, relative } from '../core/time.js'
import { availableMetrics, evaluate } from './metrics.js'
import { format } from '../core/format.js'

/**
 * The analytics that actually change what you do today.
 *
 * Each rule looks for one pattern and returns a sentence with the evidence
 * attached. Nothing here is a black box: every finding names the entities it
 * came from, so you can click through and disagree with it.
 */

const SEVERITY_ORDER = { critical: 0, serious: 1, warning: 2, good: 3, info: 4 }

export function buildInsights(entitiesMap, range, customMetrics = [], now = new Date()) {
  const entities = Object.values(entitiesMap)
  const found = []
  const add = (insight) => found.push(insight)

  overdueWork(entities, now, add)
  agingWork(entities, now, add)
  ownerConcentration(entities, add)
  meetingPressure(entities, range, now, add)
  unownedCommitments(entities, add)
  stalledRisks(entities, now, add)
  decisionDebt(entities, add)
  metricMovement(entitiesMap, range, customMetrics, add)
  completionRhythm(entities, range, add)

  return found.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, 12)
}

function overdueWork(entities, now, add) {
  const overdue = q(entities).type('task').open().due({ before: now }).sort('due').all()
  if (!overdue.length) return
  const worst = overdue[0]
  add({
    id: 'overdue',
    severity: overdue.length > 5 ? 'critical' : 'serious',
    title: `${overdue.length} ${plural(overdue.length, 'task')} past due`,
    detail: `Oldest is "${worst.title}", ${relative(worst.due, now)}.`,
    entities: overdue.slice(0, 8),
  })
}

function agingWork(entities, now, add) {
  const cutoff = addDays(now, -14)
  const stale = q(entities)
    .type('task')
    .open()
    .where((e) => new Date(e.createdAt) < cutoff && !e.due)
    .all()
  if (stale.length < 3) return
  add({
    id: 'aging',
    severity: 'warning',
    title: `${stale.length} open tasks have no date and no movement`,
    detail: 'They came in over two weeks ago and have never been scheduled. Give them a due date or drop them.',
    entities: stale.slice(0, 8),
  })
}

function ownerConcentration(entities, add) {
  const open = q(entities).type('task').open().all()
  if (open.length < 6) return
  const byPerson = q(open).groupBy((e) => e.people)
  if (byPerson.size < 2) return
  const ranked = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length)
  const [name, rows] = ranked[0]
  const share = rows.length / open.length
  if (share < 0.45) return
  add({
    id: 'concentration',
    severity: share > 0.6 ? 'serious' : 'warning',
    title: `${name} holds ${Math.round(share * 100)}% of open work`,
    detail: `${rows.length} of ${open.length} open tasks. The next busiest is ${ranked[1][0]} with ${ranked[1][1].length}.`,
    entities: rows.slice(0, 8),
  })
}

function meetingPressure(entities, range, now, add) {
  const week = q(entities).type('event').between(now, addDays(now, 7), 'at').all()
  if (week.length < 3) return
  const hours = week.reduce((a, e) => a + (e.end ? (new Date(e.end) - new Date(e.at)) / 3600000 : 0.5), 0)
  const byDay = q(week).groupBy((e) => dayKey(e.at))
  const heaviest = [...byDay.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (hours < 12) return
  add({
    id: 'meetings',
    severity: hours > 20 ? 'serious' : 'warning',
    title: `${Math.round(hours)} hours of meetings in the next 7 days`,
    detail: `Heaviest day is ${heaviest[0]} with ${heaviest[1].length} ${plural(heaviest[1].length, 'meeting')}. That leaves roughly ${Math.max(0, Math.round(40 - hours))}h of focus time.`,
    entities: heaviest[1].slice(0, 6),
  })
}

function unownedCommitments(entities, add) {
  const open = q(entities).type('task').open().all()
  const unowned = open.filter((e) => !e.people.length)
  if (unowned.length < 3 || unowned.length / Math.max(1, open.length) < 0.3) return
  add({
    id: 'unowned',
    severity: 'warning',
    title: `${unowned.length} open tasks have no owner`,
    detail: 'Commitments picked out of notes and transcripts default to nobody. Assign them or they will not happen.',
    entities: unowned.slice(0, 8),
  })
}

function stalledRisks(entities, now, add) {
  const risks = q(entities).type('risk').open().all()
  if (!risks.length) return
  const old = risks.filter((r) => new Date(r.updatedAt) < addDays(now, -7))
  add({
    id: 'risks',
    severity: risks.length > 3 ? 'serious' : 'warning',
    title: `${risks.length} open ${plural(risks.length, 'risk')}`,
    detail: old.length
      ? `${old.length} have not been touched in over a week.`
      : 'All were updated in the last week.',
    entities: risks.slice(0, 8),
  })
}

function decisionDebt(entities, add) {
  const questions = q(entities).type('note').tagged('question').all()
  if (questions.length < 2) return
  add({
    id: 'questions',
    severity: 'info',
    title: `${questions.length} open questions across your notes`,
    detail: 'These were raised and never resolved into a decision.',
    entities: questions.slice(0, 8),
  })
}

function metricMovement(entitiesMap, range, customMetrics, add) {
  for (const metric of availableMetrics(entitiesMap, customMetrics)) {
    const result = evaluate(metric, entitiesMap, range)
    if (!result || result.series.length < 6) continue
    const change = momentum(result.series)
    const spikes = anomalies(result.series, 2.2)
    if (Math.abs(change) > 0.35) {
      const rising = change > 0
      const good = (rising && result.goal === 'up') || (!rising && result.goal === 'down')
      add({
        id: `metric:${result.id}`,
        severity: good ? 'good' : 'warning',
        title: `${result.name} ${rising ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))}% across ${range.label.toLowerCase()}`,
        detail: `Now at ${format(result.value, result.unit)}. Comparison is the second half of the window against the first.`,
        metric: result,
      })
    } else if (spikes.length) {
      const spike = spikes.at(-1)
      add({
        id: `spike:${result.id}`,
        severity: 'info',
        title: `${result.name} spiked on ${spike.key}`,
        detail: `${format(spike.value, result.unit)} against a typical day in this window.`,
        metric: result,
      })
    }
  }
}

function completionRhythm(entities, range, add) {
  const done = q(entities).type('task').status('done').between(range.from, range.to, 'updatedAt').all()
  if (done.length < 5) return
  const points = daily(done, { from: range.from, to: range.to, field: 'updatedAt' })
  const run = streak(points)
  const slope = trend(points).slope
  if (run >= 3) {
    add({
      id: 'streak',
      severity: 'good',
      title: `${run}-day closing streak`,
      detail: `${done.length} tasks finished in ${range.label.toLowerCase()}, and the trend is ${slope >= 0 ? 'holding or rising' : 'slowing'}.`,
    })
  }
}

const plural = (n, word) => (n === 1 ? word : `${word}s`)

export { format }
