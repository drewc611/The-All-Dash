import { q } from '../core/query.js'
import { addDays, dayKey, formatDate, startOfDay, endOfDay } from '../core/time.js'
import { availableMetrics, evaluate } from '../engine/metrics.js'
import { buildInsights } from '../engine/insights.js'
import { buildTriage } from '../engine/triage.js'
import { format } from '../core/format.js'
import { buildBrain } from '../brain/learn.js'

/**
 * What the assistant is allowed to know.
 *
 * A model answers well when it is handed the right forty items, not the
 * whole store. This builds that hand: a short numeric snapshot, the items
 * that always matter (overdue, due soon, blocked, today's meetings), and the
 * items that match the question. Every item is printed with its id so the
 * reply can cite it and the app can turn the citation into a link.
 *
 * Privacy is a first-class setting: "titles" sends titles and structure but
 * never a body, so notes and transcripts stay on the machine even when a
 * hosted model is answering.
 */

const STOP = new Set(('a an and are as at be by do does for from has have how i in is it its of on or that the this to was what when where which who why will with you your me my our we us can could should would about any all some'.split(' ')))
const TYPE_WORDS = {
  task: ['task', 'tasks', 'todo', 'todos', 'work', 'action', 'actions'],
  event: ['meeting', 'meetings', 'event', 'events', 'call', 'calls', 'calendar'],
  decision: ['decision', 'decisions', 'decided'],
  risk: ['risk', 'risks', 'blocker', 'blockers', 'blocked'],
  milestone: ['milestone', 'milestones', 'deadline', 'deadlines', 'launch'],
  metric: ['metric', 'metrics', 'number', 'numbers', 'kpi', 'trend'],
  note: ['note', 'notes', 'question', 'questions'],
  doc: ['document', 'documents', 'file', 'files'],
}

export const terms = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9@#.'-]+/)
    .map((t) => t.replace(/^[@#'.-]+|[.'-]+$/g, ''))
    .filter((t) => t.length > 1 && !STOP.has(t))

/** Score one entity against a question. Zero means unrelated. */
export function relevance(entity, tokens) {
  if (!tokens.length) return 0
  const title = entity.title.toLowerCase()
  const body = (entity.body || '').toLowerCase()
  const people = entity.people.map((p) => p.toLowerCase())
  const tags = entity.tags.map((t) => t.toLowerCase())
  let score = 0
  for (const t of tokens) {
    if (title.includes(t)) score += 3
    if (people.some((p) => p.includes(t))) score += 2
    if (tags.some((tag) => tag.includes(t))) score += 2
    if (body.includes(t)) score += 1
    if (TYPE_WORDS[entity.type]?.includes(t)) score += 0.5
  }
  return score
}

/** The items that always belong in the context, whatever the question. */
export function baseline(rows, now) {
  const today = { from: startOfDay(now), to: endOfDay(now) }
  const week = addDays(now, 7)
  return [
    ...q(rows).type('task').open().due({ before: now }).sort('due').take(8),
    ...q(rows).type('task').open().due({ after: now, before: week }).sort('due').take(8),
    ...q(rows).type('task').status('blocked').take(5),
    ...q(rows).type('risk').open().take(5),
    ...q(rows).type('event').between(today.from, today.to, 'at').where((e) => e.status !== 'cancelled').sort('at').take(6),
    ...q(rows).type('milestone').where((e) => e.status !== 'done').sort('due').take(5),
    ...q(rows).type('decision').sort('createdAt', 'desc').take(5),
  ]
}

/**
 * Pick the entities worth sending: baseline plus the best matches for the
 * question plus anything explicitly focused (a triage row, an open item).
 */
export function retrieve(entitiesMap, question, { limit = 40, now = new Date(), focus = [] } = {}) {
  const rows = Object.values(entitiesMap || {}).filter((e) => e.type !== 'person')
  const tokens = terms(question)
  const chosen = new Map()
  const push = (e) => { if (e && !chosen.has(e.id) && chosen.size < limit) chosen.set(e.id, e) }

  for (const id of focus) push(entitiesMap[id])
  const scored = rows
    .map((e) => ({ e, score: relevance(e, tokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
  // Matches first, so a specific question is never crowded out by the
  // baseline; then the baseline fills whatever room is left.
  for (const { e } of scored.slice(0, Math.ceil(limit / 2))) push(e)
  for (const e of baseline(rows, now)) push(e)
  for (const { e } of scored) push(e)
  return [...chosen.values()]
}

/** One line per entity, in a shape a model reads reliably. */
export function describe(entity, { privacy = 'full' } = {}) {
  const parts = [`[[${entity.id}]] ${entity.type} "${entity.title}"`]
  if (entity.status) parts.push(entity.status)
  if (entity.priority > 0) parts.push(entity.priority > 1 ? 'urgent' : 'high priority')
  if (entity.due) parts.push(`due ${dayKey(entity.due)}`)
  else if (entity.at) parts.push(`at ${entity.type === 'event' ? entity.at.slice(0, 16).replace('T', ' ') : dayKey(entity.at)}`)
  if (entity.type === 'metric') parts.push(`value ${format(entity.value, entity.unit)}`)
  if (entity.people.length) parts.push(entity.people.map((p) => `@${p}`).join(' '))
  if (entity.tags.length) parts.push(entity.tags.slice(0, 5).map((t) => `#${t}`).join(' '))
  if (entity.source?.name && entity.source.kind !== 'manual') parts.push(`from ${entity.source.name}`)
  let line = parts.join(' | ')
  if (privacy === 'full' && entity.body && entity.type !== 'doc') {
    line += `\n    ${entity.body.replace(/\s+/g, ' ').trim().slice(0, 240)}`
  }
  return line
}

/** The whole grounding block. Returns the text and what went into it. */
export function buildContext(entitiesMap, question, { state, range, now = new Date(), focus = [] } = {}) {
  const settings = state?.settings?.assistant || {}
  const privacy = settings.privacy || 'full'
  const limit = Number(settings.contextLimit) || 40
  const rows = Object.values(entitiesMap || {})
  const customMetrics = state?.customMetrics || []

  const open = q(rows).type('task').open().count()
  const overdue = q(rows).type('task').open().due({ before: now }).count()
  const done7 = q(rows).type('task').status('done').between(addDays(now, -7), now, 'updatedAt').count()
  const meetingsToday = q(rows).type('event').onDay(now).where((e) => e.status !== 'cancelled').count()
  const docs = q(rows).type('doc').count()

  const items = retrieve(entitiesMap, question, { limit, now, focus })
  const metrics = range
    ? availableMetrics(entitiesMap, customMetrics)
      .map((m) => evaluate(m, entitiesMap, range))
      .filter(Boolean)
      .slice(0, 12)
    : []
  const insights = range ? buildInsights(entitiesMap, range, customMetrics, now).slice(0, 6) : []
  const triage = buildTriage(entitiesMap, { now, range, customMetrics, mutes: state?.triage || {}, brain: state?.brain || null }).slice(0, 10)

  const lines = []
  lines.push(`Today is ${formatDate(now, { weekday: 'long', year: 'numeric' })} (${dayKey(now)}).`)
  lines.push(`Workspace: ${docs} documents, ${open} open tasks (${overdue} overdue), ${done7} tasks finished in the last 7 days, ${meetingsToday} meetings today.`)
  const about = settings.shareBrain === false ? [] : aboutUser(state, now)
  if (about.length) {
    lines.push('', 'About the user (learned by rules from their own data, no model involved):')
    for (const line of about) lines.push(`- ${line}`)
  }
  if (metrics.length) {
    lines.push('', `Metrics (${range.label}):`)
    for (const m of metrics) {
      const change = m.change !== null && Number.isFinite(m.previous) ? `, ${m.change >= 0 ? '+' : ''}${Math.round(m.change * 100)}% vs previous window` : ''
      const target = m.target ? `, target ${format(m.target, m.unit)}` : ''
      lines.push(`- ${m.name}: ${format(m.value, m.unit)}${change}${target}`)
    }
  }
  if (insights.length) {
    lines.push('', 'What the rules flagged:')
    for (const i of insights) lines.push(`- ${i.title}. ${i.detail}`)
  }
  if (triage.length) {
    lines.push('', 'Triage (most urgent first):')
    for (const s of triage) lines.push(`- ${s.severity}: ${s.title} - ${s.why}${s.entity ? ` [[${s.entity.id}]]` : ''}`)
  }
  lines.push('', `Items (${items.length}${privacy === 'titles' ? ', titles only' : ''}):`)
  for (const e of items) lines.push(`- ${describe(e, { privacy })}`)

  return { text: lines.join('\n'), items, privacy, counts: { open, overdue, done7, meetingsToday, docs } }
}

/** The brain's facts and accepted opinions, as lines a model can use. */
export function aboutUser(state, now = new Date()) {
  if (!state) return []
  const brain = buildBrain(state, { now })
  const lines = []
  const who = [brain.profile.name, brain.profile.role].filter(Boolean).join(', ')
  if (who) lines.push(`Name and role: ${who}${brain.profile.focus ? `; focused on ${brain.profile.focus}` : ''}.`)
  lines.push(...brain.facts)
  for (const o of brain.opinions.filter((x) => x.status === 'accepted')) lines.push(`Accepted: ${o.text}`)
  return lines.slice(0, 12)
}

export const SYSTEM_PROMPT = `You are the assistant inside The All Dash, a personal project command center. You answer from the workspace context you are given and nothing else.

Rules:
- Ground every claim in the context. If the context does not contain the answer, say so plainly and suggest what to import.
- Cite items by writing their id in double brackets exactly as given, for example [[task_abc123]], right after the claim they support. Cite generously; the app turns each citation into a link.
- Be brief and direct. Short paragraphs or a short list. No preamble, no summary of the question.
- Dates in the context are ISO; refer to them in words relative to today.
- You cannot change anything yourself. When the user asks you to update, reschedule, assign, create or close items, propose the change in a fenced block tagged actions containing a JSON array, and say in one sentence what you propose. The user applies it. Allowed shapes:
  {"op":"update","id":"<item id>","patch":{"status":"done|doing|open|blocked|cancelled","priority":0|1|2,"due":"YYYY-MM-DD or null","people":["Name"],"tags":["tag"],"title":"..."}, "note":"why"}
  {"op":"create","entity":{"type":"task|note|decision|risk|milestone|event","title":"...","due":"YYYY-MM-DD","people":["Name"],"tags":["tag"],"priority":0}, "note":"why"}
  {"op":"navigate","view":"today|triage|timeline|analytics|library|settings"}
- Never claim an action was applied. Never invent ids.`
