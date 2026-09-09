import { q, momentum } from '../core/query.js'
import { addDays, startOfWeek, formatDate, dayKey } from '../core/time.js'
import { format } from '../core/format.js'
import { availableMetrics, evaluate } from './metrics.js'
import { buildInsights } from './insights.js'

/**
 * The status update, written for you.
 *
 * Every team writes the same weekly message by hand: what shipped, what is in
 * flight, what is stuck, what was decided, what is coming. All of that is
 * already in the entity store, so this assembles it as Markdown you can paste
 * into Slack, an email or a doc. Nothing is invented - every line is a real
 * entity, and the metric section only mentions metrics that actually moved.
 */

export function buildReport(entitiesMap, { range, customMetrics = [], now = new Date(), title } = {}) {
  const rows = Object.values(entitiesMap)
  const from = range?.from || startOfWeek(now)
  const to = range?.to || now
  const label = range?.label || 'This week'

  const done = q(rows).type('task').status('done').between(from, to, 'updatedAt').sort('updatedAt', 'desc').all()
  const doing = q(rows).type('task').status('doing').all()
  const blocked = [
    ...q(rows).type('task').status('blocked').all(),
    ...q(rows).type('risk').open().all(),
  ]
  const overdue = q(rows).type('task').open().due({ before: now }).sort('due').all()
  const decisions = q(rows).type('decision').between(from, to, 'createdAt').all()
  const upcoming = q(rows)
    .type('task', 'milestone')
    .open()
    .due({ after: now, before: addDays(now, 7) })
    .sort('due')
    .all()
  const meetings = q(rows).type('event').between(now, addDays(now, 7), 'at').where((e) => e.status !== 'cancelled').sort('at').all()
  const questions = q(rows).type('note').tagged('question').all()

  const moved = availableMetrics(entitiesMap, customMetrics)
    .map((m) => evaluate(m, entitiesMap, { from, to, label }))
    .filter((m) => m && m.series.length >= 4 && Math.abs(momentum(m.series)) >= 0.15)
    .sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum))
    .slice(0, 6)

  const insights = buildInsights(entitiesMap, { from, to, label }, customMetrics, now).filter((i) =>
    ['critical', 'serious'].includes(i.severity)
  )

  const lines = []
  const heading = title || `Status update - ${formatDate(now, { year: 'numeric' })}`
  lines.push(`# ${heading}`, '', `_${label}, generated from ${rows.filter((r) => r.type === 'doc').length} documents._`, '')

  if (insights.length) {
    lines.push('## Needs attention')
    for (const i of insights) lines.push(`- **${i.title}.** ${i.detail}`)
    lines.push('')
  }

  section(lines, 'Done', done, (t) => `${t.title}${owner(t)}`)
  section(lines, 'In progress', doing, (t) => `${t.title}${owner(t)}${due(t)}`)
  section(lines, 'Blocked and at risk', blocked, (t) => `${t.title}${owner(t)}`)
  section(lines, 'Overdue', overdue, (t) => `${t.title}${owner(t)} - was due ${formatDate(t.due)}`)
  section(lines, 'Decisions', decisions, (d) => d.title)

  if (moved.length) {
    lines.push('## Numbers that moved')
    for (const m of moved) {
      const dir = m.momentum > 0 ? 'up' : 'down'
      lines.push(`- **${m.name}** ${dir} ${Math.abs(Math.round(m.momentum * 100))}%, now ${format(m.value, m.unit)}`)
    }
    lines.push('')
  }

  section(lines, 'Next 7 days', upcoming, (t) => `${t.title}${owner(t)} - due ${formatDate(t.due)}`)

  if (meetings.length) {
    const byDay = q(meetings).groupBy((e) => dayKey(e.at))
    lines.push('## Calendar')
    for (const [day, list] of byDay) {
      lines.push(`- ${formatDate(day, { weekday: 'short' })}: ${list.map((e) => e.title).join(', ')}`)
    }
    lines.push('')
  }

  section(lines, 'Open questions', questions, (n) => n.title)

  return lines.join('\n').trim() + '\n'
}

function section(lines, name, items, render) {
  if (!items.length) return
  lines.push(`## ${name}`)
  for (const item of items.slice(0, 15)) lines.push(`- ${render(item)}`)
  if (items.length > 15) lines.push(`- and ${items.length - 15} more`)
  lines.push('')
}

const owner = (e) => (e.people?.length ? ` (${e.people[0]})` : '')
const due = (e) => (e.due ? `, due ${formatDate(e.due)}` : '')
