import { q, anomalies } from '../core/query.js'
import { addDays, relative, formatDate, MS } from '../core/time.js'
import { availableMetrics, evaluate } from './metrics.js'
import { format } from '../core/format.js'

/**
 * Triage: one consolidated list of what is wrong right now.
 *
 * Insights (insights.js) speak in sentences about the whole project. Triage
 * speaks in rows about single items: this task is nine days late, this
 * milestone passed with four tasks still open, these two meetings overlap.
 * Every row carries a severity, the reason it was raised, and the one or two
 * actions that clear it, so the view is a worklist rather than a report.
 *
 * Nothing here is stored. Mute an item and the mute is remembered; the signal
 * comes back on its own when the mute expires or when the underlying fact
 * changes enough to change its id.
 */

export const SEVERITIES = ['critical', 'serious', 'warning', 'info']
const RANK = { critical: 0, serious: 1, warning: 2, info: 3 }

export function buildTriage(entitiesMap, { now = new Date(), range = null, customMetrics = [], mutes = {} } = {}) {
  const rows = Object.values(entitiesMap || {})
  const found = []
  const add = (signal) => found.push(signal)

  overdueTasks(rows, now, add)
  dueSoon(rows, now, add)
  blockedWork(rows, now, add)
  stalledWork(rows, now, add)
  milestones(rows, now, add)
  staleRisks(rows, now, add)
  unownedUrgent(rows, add)
  meetingClashes(rows, now, add)
  agingQuestions(rows, now, add)
  if (range) metricsOff(entitiesMap, range, customMetrics, add)

  return found
    .filter((s) => !isMuted(mutes[s.id], now))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.when ?? Infinity) - (b.when ?? Infinity))
}

/** Counts per severity, for the header tiles. */
export function summarise(signals) {
  const counts = { critical: 0, serious: 0, warning: 0, info: 0, total: signals.length }
  for (const s of signals) counts[s.severity] = (counts[s.severity] || 0) + 1
  return counts
}

export const isMuted = (mark, now = new Date()) =>
  Boolean(mark?.until && new Date(mark.until) > now)

const ACT = {
  done: { id: 'done', label: 'Mark done' },
  push: { id: 'push', label: 'Push a week' },
  unblock: { id: 'unblock', label: 'Unblock' },
  mute: { id: 'mute', label: 'Mute 7 days' },
  assign: { id: 'assign', label: 'Assign' },
}

const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / MS.day)
const owner = (e) => (e.people?.length ? ` (${e.people[0]})` : '')

function overdueTasks(rows, now, add) {
  for (const t of q(rows).type('task').open().due({ before: now }).all()) {
    const late = daysBetween(t.due, now)
    add({
      id: `overdue:${t.id}`,
      kind: 'overdue',
      severity: t.priority >= 2 || late >= 7 ? 'critical' : 'serious',
      title: t.title,
      why: `Due ${formatDate(t.due)}, ${late === 0 ? 'today' : `${late} ${late === 1 ? 'day' : 'days'} late`}${owner(t)}.`,
      entity: t,
      when: new Date(t.due).getTime(),
      actions: [ACT.done, ACT.push, ACT.mute],
    })
  }
}

function dueSoon(rows, now, add) {
  const horizon = new Date(now.getTime() + 48 * MS.hour)
  for (const t of q(rows).type('task').open().due({ after: now, before: horizon }).all()) {
    add({
      id: `due:${t.id}`,
      kind: 'due-soon',
      severity: t.priority >= 1 ? 'serious' : 'warning',
      title: t.title,
      why: `Due ${relative(t.due, now)}${owner(t)}.`,
      entity: t,
      when: new Date(t.due).getTime(),
      actions: [ACT.done, ACT.push, ACT.mute],
    })
  }
}

function blockedWork(rows, now, add) {
  for (const t of q(rows).type('task').status('blocked').all()) {
    const stuck = daysBetween(t.updatedAt, now)
    add({
      id: `blocked:${t.id}`,
      kind: 'blocked',
      severity: stuck >= 7 ? 'critical' : 'serious',
      title: t.title,
      why: `${stuck === 0 ? 'Blocked since today' : `Blocked for ${stuck} ${stuck === 1 ? 'day' : 'days'}`}${owner(t)}.`,
      entity: t,
      when: new Date(t.updatedAt).getTime(),
      actions: [ACT.unblock, ACT.done, ACT.mute],
    })
  }
}

function stalledWork(rows, now, add) {
  for (const t of q(rows).type('task').status('doing').all()) {
    const idle = daysBetween(t.updatedAt, now)
    if (idle < 14) continue
    add({
      id: `stalled:${t.id}`,
      kind: 'stalled',
      severity: 'warning',
      title: t.title,
      why: `In progress but untouched for ${idle} days${owner(t)}.`,
      entity: t,
      when: new Date(t.updatedAt).getTime(),
      actions: [ACT.done, ACT.mute],
    })
  }
}

function milestones(rows, now, add) {
  const open = q(rows).type('task').open().all()
  for (const m of q(rows).type('milestone').where((e) => e.status !== 'done' && e.status !== 'cancelled').all()) {
    const at = m.due || m.at
    if (!at) continue
    const days = daysBetween(now, at)
    if (days > 14) continue
    const tagged = m.tags.length ? open.filter((t) => t.tags.some((tag) => m.tags.includes(tag))) : []
    const openNote = tagged.length ? ` ${tagged.length} open ${tagged.length === 1 ? 'task shares' : 'tasks share'} its tags.` : ''
    add({
      id: `milestone:${m.id}`,
      kind: 'milestone',
      severity: days < 0 ? 'critical' : days <= 7 ? 'serious' : 'warning',
      title: m.title,
      why: days < 0 ? `Milestone date passed ${relative(at, now)} and it is not marked done.${openNote}` : `Milestone in ${days} ${days === 1 ? 'day' : 'days'}.${openNote}`,
      entity: m,
      entities: tagged.slice(0, 8),
      when: new Date(at).getTime(),
      actions: [ACT.done, ACT.push, ACT.mute],
    })
  }
}

function staleRisks(rows, now, add) {
  for (const r of q(rows).type('risk').open().all()) {
    const idle = daysBetween(r.updatedAt, now)
    if (idle < 7) continue
    add({
      id: `risk:${r.id}`,
      kind: 'risk',
      severity: idle >= 21 ? 'serious' : 'warning',
      title: r.title,
      why: `Open risk, untouched for ${idle} days${owner(r)}.`,
      entity: r,
      when: new Date(r.updatedAt).getTime(),
      actions: [ACT.done, ACT.mute],
    })
  }
}

function unownedUrgent(rows, add) {
  for (const t of q(rows).type('task').open().where((e) => e.priority >= 2 && !e.people.length).all()) {
    add({
      id: `unowned:${t.id}`,
      kind: 'unowned',
      severity: 'warning',
      title: t.title,
      why: 'Marked urgent but nobody owns it.',
      entity: t,
      when: t.due ? new Date(t.due).getTime() : null,
      actions: [ACT.assign, ACT.mute],
    })
  }
}

function meetingClashes(rows, now, add) {
  const soon = addDays(now, 2)
  const events = q(rows)
    .type('event')
    .where((e) => e.status !== 'cancelled' && e.end)
    .between(addDays(now, -1), soon, 'at')
    .sort('at')
    .all()
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i]
      const b = events[j]
      if (new Date(b.at) >= new Date(a.end)) break
      if (new Date(a.end) < now) continue
      const [x, y] = [a, b].sort((p, r) => p.id.localeCompare(r.id))
      add({
        id: `clash:${x.id}:${y.id}`,
        kind: 'clash',
        severity: 'warning',
        title: `${a.title} overlaps ${b.title}`,
        why: `${formatDate(a.at, { weekday: 'short' })}: both are on the calendar at the same time.`,
        entity: a,
        entities: [a, b],
        when: new Date(a.at).getTime(),
        actions: [ACT.mute],
      })
    }
  }
}

function agingQuestions(rows, now, add) {
  for (const n of q(rows).type('note').tagged('question').all()) {
    const age = daysBetween(n.createdAt, now)
    if (age < 14) continue
    add({
      id: `question:${n.id}`,
      kind: 'question',
      severity: 'info',
      title: n.title,
      why: `Raised ${age} days ago and never turned into a decision.`,
      entity: n,
      when: new Date(n.createdAt).getTime(),
      actions: [ACT.mute],
    })
  }
}

function metricsOff(entitiesMap, range, customMetrics, add) {
  for (const metric of availableMetrics(entitiesMap, customMetrics)) {
    const result = evaluate(metric, entitiesMap, range, { compare: false })
    if (!result) continue
    if (metric.target && result.value < metric.target) {
      const eta = result.projection?.daysToTarget
      if (eta === null || eta === undefined || eta > 60) {
        add({
          id: `target:${metric.id}`,
          kind: 'target',
          severity: 'warning',
          title: `${metric.name} is off target`,
          why: `${format(result.value, result.unit)} of ${format(metric.target, result.unit)} and the trend does not reach it inside two months.`,
          metric: result,
          when: null,
          actions: [ACT.mute],
        })
      }
    }
    // Built-in counters spike every time a document is imported, which is
    // not news. Only series that came from data (imported or user-defined)
    // are worth a row.
    if (!metric.custom) continue
    const spikes = anomalies(result.series, 2.5)
    const last = result.series.at(-1)
    if (last && spikes.length && spikes.at(-1).key === last.key) {
      add({
        id: `spike:${metric.id}:${last.key}`,
        kind: 'spike',
        severity: 'info',
        title: `${metric.name} is unusual today`,
        why: `${format(last.value, result.unit)} on ${formatDate(last.key)}, well outside the window's typical day.`,
        metric: result,
        when: null,
        actions: [ACT.mute],
      })
    }
  }
}
