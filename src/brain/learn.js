import { q } from '../core/query.js'
import { addDays, endOfDay, MS } from '../core/time.js'

/**
 * The brain: what the app has learned about the person using it.
 *
 * No model is involved. Every line here is a rule over the entities, the
 * documents and the usage counters, so each fact can be traced to the rows it
 * came from and recomputed from scratch at any time. Nothing derived is
 * stored; the store keeps only what the person said about it (their name,
 * their notes, which opinions they accepted or dismissed) and the usage
 * counters that cannot be re-derived.
 *
 * Two grades of knowledge:
 *   facts     recorded automatically and shown for editing or deletion
 *   opinions  judgements with evidence, proposed until the person accepts them;
 *             an accepted opinion changes how the dashboard behaves
 */

export const BRAIN_VERSION = 1

export const emptyUsage = () => ({
  firstSeen: null,
  lastSeen: null,
  sessions: 0,
  hours: Array(24).fill(0),
  weekdays: Array(7).fill(0),
  views: {},
  actions: {},
  imports: {},
})

export const emptyBrainState = () => ({
  profile: { name: '', role: '', focus: '' },
  notes: {},
  accepted: {},
  dismissed: {},
  usage: emptyUsage(),
  sync: null,
})

/** Merge whatever was persisted with the current shape, so old exports load. */
export function normaliseBrainState(raw) {
  const base = emptyBrainState()
  if (!raw || typeof raw !== 'object') return base
  const usage = { ...base.usage, ...(raw.usage || {}) }
  if (!Array.isArray(usage.hours) || usage.hours.length !== 24) usage.hours = Array(24).fill(0)
  if (!Array.isArray(usage.weekdays) || usage.weekdays.length !== 7) usage.weekdays = Array(7).fill(0)
  return {
    profile: { ...base.profile, ...(raw.profile || {}) },
    notes: raw.notes && typeof raw.notes === 'object' ? raw.notes : {},
    accepted: raw.accepted && typeof raw.accepted === 'object' ? raw.accepted : {},
    dismissed: raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {},
    usage,
    sync: raw.sync && typeof raw.sync === 'object' ? raw.sync : null,
  }
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const daysBetween = (a, b) => (new Date(b) - new Date(a)) / MS.day
const median = (values) => {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0)
const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n }
const top = (map, n = 3) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n)

/** The whole picture. Pure: same state and now, same result. */
export function buildBrain(state, { now = new Date() } = {}) {
  const brainState = normaliseBrainState(state?.brain)
  const rows = Object.values(state?.entities || {})
  const docs = Array.isArray(state?.docs) ? state.docs : []
  const tasks = q(rows).type('task').all()
  const events = q(rows).type('event').where((e) => e.status !== 'cancelled').all()

  // Finished in the app, so updatedAt is when it really happened. Imported
  // "done" rows carry the import time and say nothing about the person.
  const finished = tasks.filter((t) => t.status === 'done' && t.meta?.editedByUser && t.due)
  const late = finished.filter((t) => new Date(t.updatedAt) > endOfDay(t.due))
  const leadDays = finished.map((t) => daysBetween(t.updatedAt, t.due))

  const dated = tasks.filter((t) => t.due && t.createdAt)
  const horizons = dated.map((t) => daysBetween(t.createdAt, t.due)).filter((d) => d >= 0)
  const openDated = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && t.due)
  const overdueOpen = openDated.filter((t) => new Date(t.due) < now)

  const people = peopleFacts(rows, tasks, events, finished, late, now)
  const topics = topicFacts(rows, tasks, finished, late, now)
  const rhythm = rhythmFacts(finished, events, brainState.usage, now)
  const formats = {}
  for (const d of docs) if (d.kind) bump(formats, d.kind)

  const habits = {
    finished: finished.length,
    finishedLate: late.length,
    lateRate: finished.length ? late.length / finished.length : null,
    medianLeadDays: median(leadDays),
    medianHorizonDays: median(horizons),
    openDated: openDated.length,
    overdueOpen: overdueOpen.length,
    overdueRate: openDated.length ? overdueOpen.length / openDated.length : null,
    unownedOpen: tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled' && !t.people.length).length,
  }

  const profile = {
    name: brainState.profile.name || '',
    role: brainState.profile.role || '',
    focus: brainState.profile.focus || '',
    workspace: state?.workspace?.name || 'Workspace',
    since: brainState.usage.firstSeen || state?.workspace?.createdAt || null,
    lastSeen: brainState.usage.lastSeen || null,
    sessions: brainState.usage.sessions || 0,
    documents: docs.length,
    formats: top(formats, 6).map(([kind, count]) => ({ kind, count })),
    entities: rows.length,
    timezone: safeTimezone(),
  }

  const opinions = buildOpinions({ people, topics, habits, rhythm, usage: brainState.usage, tasks, events }, brainState, now)

  return {
    version: BRAIN_VERSION,
    generatedAt: now.toISOString(),
    profile,
    habits,
    rhythm,
    people,
    topics,
    opinions,
    facts: factLines({ profile, habits, rhythm, people, topics }),
  }
}

function safeTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

// ------------------------------------------------------------------ people

function peopleFacts(rows, tasks, events, finished, late, now) {
  const byName = new Map()
  const get = (name) => {
    if (!byName.has(name)) {
      byName.set(name, { name, open: 0, done: 0, overdue: 0, meetings: 0, finished: 0, late: 0, lastSeen: null, tags: {}, with: {}, docs: new Set(), items: [] })
    }
    return byName.get(name)
  }
  const seen = (p, when) => { if (when && (!p.lastSeen || new Date(when) > new Date(p.lastSeen))) p.lastSeen = new Date(when).toISOString() }
  const lateIds = new Set(late.map((t) => t.id))
  const finishedIds = new Set(finished.map((t) => t.id))

  for (const e of rows) {
    if (!e.people?.length) continue
    for (const name of e.people) {
      const p = get(name)
      if (e.source?.docId) p.docs.add(e.source.docId)
      for (const tag of e.tags || []) bump(p.tags, tag)
      for (const other of e.people) if (other !== name) bump(p.with, other)
      seen(p, e.type === 'event' ? e.at : e.updatedAt)
      if (e.type === 'task') {
        if (e.status === 'done') p.done += 1
        else if (e.status !== 'cancelled') {
          p.open += 1
          if (e.due && new Date(e.due) < now) p.overdue += 1
          p.items.push(e)
        }
        if (finishedIds.has(e.id)) p.finished += 1
        if (lateIds.has(e.id)) p.late += 1
      } else if (e.type === 'event') p.meetings += 1
    }
  }
  const totalOpen = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length
  return [...byName.values()]
    .map((p) => ({
      name: p.name,
      open: p.open,
      done: p.done,
      overdue: p.overdue,
      meetings: p.meetings,
      share: totalOpen ? p.open / totalOpen : 0,
      onTimeRate: p.finished ? (p.finished - p.late) / p.finished : null,
      finished: p.finished,
      lastSeen: p.lastSeen,
      sinceSeenDays: p.lastSeen ? Math.floor(daysBetween(p.lastSeen, now)) : null,
      tags: top(p.tags).map(([tag]) => tag),
      with: top(p.with).map(([name]) => name),
      documents: p.docs.size,
      items: p.items.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0)).slice(0, 8),
    }))
    .sort((a, b) => b.open + b.done + b.meetings - (a.open + a.done + a.meetings) || a.name.localeCompare(b.name))
}

// ------------------------------------------------------------------ topics

function topicFacts(rows, tasks, finished, late, now) {
  const byTag = new Map()
  const get = (tag) => {
    if (!byTag.has(tag)) byTag.set(tag, { tag, total: 0, open: 0, done: 0, overdue: 0, unowned: 0, finished: 0, late: 0, recent: 0, previous: 0, docs: new Set(), people: {}, lastActive: null, items: [] })
    return byTag.get(tag)
  }
  const lateIds = new Set(late.map((t) => t.id))
  const finishedIds = new Set(finished.map((t) => t.id))
  const cut1 = addDays(now, -14)
  const cut2 = addDays(now, -28)
  for (const e of rows) {
    if (!e.tags?.length) continue
    for (const tag of e.tags) {
      const t = get(tag)
      t.total += 1
      if (e.source?.docId) t.docs.add(e.source.docId)
      for (const name of e.people || []) bump(t.people, name)
      const when = new Date(e.updatedAt || e.createdAt)
      if (!t.lastActive || when > new Date(t.lastActive)) t.lastActive = when.toISOString()
      const created = new Date(e.createdAt)
      if (created >= cut1) t.recent += 1
      else if (created >= cut2) t.previous += 1
      if (e.type !== 'task') continue
      if (e.status === 'done') t.done += 1
      else if (e.status !== 'cancelled') {
        t.open += 1
        if (!e.people?.length) t.unowned += 1
        if (e.due && new Date(e.due) < now) t.overdue += 1
        t.items.push(e)
      }
      if (finishedIds.has(e.id)) t.finished += 1
      if (lateIds.has(e.id)) t.late += 1
    }
  }
  return [...byTag.values()]
    .map((t) => ({
      tag: t.tag,
      total: t.total,
      open: t.open,
      done: t.done,
      overdue: t.overdue,
      unowned: t.unowned,
      finished: t.finished,
      slipRate: t.finished ? t.late / t.finished : null,
      momentum: t.recent - t.previous,
      recent: t.recent,
      documents: t.docs.size,
      people: top(t.people).map(([name]) => name),
      lastActive: t.lastActive,
      items: t.items.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0)).slice(0, 8),
    }))
    .sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag))
}

// ------------------------------------------------------------------ rhythm

function rhythmFacts(finished, events, usage, now) {
  const doneByWeekday = Array(7).fill(0)
  const doneByHour = Array(24).fill(0)
  for (const t of finished) {
    const d = new Date(t.updatedAt)
    doneByWeekday[d.getDay()] += 1
    doneByHour[d.getHours()] += 1
  }
  const meetingsByWeekday = Array(7).fill(0)
  const from = addDays(now, -90)
  const to = addDays(now, 30)
  let meetings = 0
  for (const e of events) {
    if (!e.at) continue
    const d = new Date(e.at)
    if (d < from || d > to) continue
    meetingsByWeekday[d.getDay()] += 1
    meetings += 1
  }
  const activeHours = clusters(usage.hours || [])
  const activeDays = (usage.weekdays || []).map((n, i) => [i, n]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([i]) => i).sort()
  const busiestMeetingDay = meetings >= 6 ? meetingsByWeekday.indexOf(Math.max(...meetingsByWeekday)) : null
  return {
    doneByWeekday,
    doneByHour,
    meetingsByWeekday,
    meetings,
    busiestMeetingDay,
    activeHours,
    activeDays,
    usageHours: [...(usage.hours || [])],
    topViews: top(usage.views || {}, 3).map(([view, count]) => ({ view, count })),
    topActions: top(usage.actions || {}, 5).map(([action, count]) => ({ action, count })),
    weekdayNames: WEEKDAYS,
  }
}

/** Contiguous hour ranges holding most of the activity, as "9-11" strings. */
export function clusters(hours) {
  const total = hours.reduce((a, b) => a + b, 0)
  if (!total) return []
  const threshold = total / 24
  const out = []
  let start = null
  for (let h = 0; h <= 24; h++) {
    const active = h < 24 && hours[h] > threshold
    if (active && start === null) start = h
    if (!active && start !== null) {
      out.push({ from: start, to: h, weight: hours.slice(start, h).reduce((a, b) => a + b, 0) })
      start = null
    }
  }
  // A single stray session does not make an "active hour".
  const floor = Math.max(2, total * 0.1)
  return out.filter((c) => c.weight >= floor).sort((a, b) => b.weight - a.weight).slice(0, 3).sort((a, b) => a.from - b.from).map((c) => `${hour12(c.from)}-${hour12(c.to)}`)
}

const hour12 = (h) => {
  const x = h % 24
  if (x === 0) return '12am'
  if (x === 12) return '12pm'
  return x < 12 ? `${x}am` : `${x - 12}pm`
}

// ---------------------------------------------------------------- opinions

/**
 * Judgements. Each carries its evidence and, when accepting it should change
 * the dashboard, an effect the store applies and triage reads.
 */
function buildOpinions({ people, topics, habits, rhythm, usage, tasks, events }, brainState, now) {
  const found = []
  const add = (o) => found.push(o)
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`

  for (const t of topics) {
    if (t.finished >= 3 && t.slipRate >= 0.5) {
      add({
        id: `slip:${t.tag}`,
        kind: 'slip',
        text: `Work tagged #${t.tag} usually finishes late: ${t.finished - Math.round(t.finished * (1 - t.slipRate))} of ${t.finished} tasks. Triage will raise anything with that tag a step earlier.`,
        evidence: t.items.map((e) => e.id),
        effect: { kind: 'promote-tag', tag: t.tag },
        strength: t.slipRate,
      })
    }
    if (t.open >= 4 && t.unowned / t.open >= 0.6) {
      add({
        id: `unowned:${t.tag}`,
        kind: 'unowned',
        text: `Tasks tagged #${t.tag} mostly have no owner (${t.unowned} of ${t.open} open). Work without a name tends to wait.`,
        evidence: t.items.filter((e) => !e.people.length).map((e) => e.id),
        effect: null,
        strength: t.unowned / t.open,
      })
    }
  }

  const openTotal = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length
  if (people.length >= 2 && openTotal >= 5) {
    for (const p of people) {
      if (p.open >= 4 && p.share >= 0.4) {
        add({
          id: `overload:${p.name}`,
          kind: 'overload',
          text: `${p.name} carries ${pct(p.open, openTotal)}% of the open work (${plural(p.open, 'task')}). Anything else landing on them this week is at risk; triage will flag it.`,
          evidence: p.items.map((e) => e.id),
          effect: { kind: 'watch-person', person: p.name },
          strength: p.share,
        })
      }
      if (p.open >= 2 && p.sinceSeenDays !== null && p.sinceSeenDays >= 30) {
        add({
          id: `quiet:${p.name}`,
          kind: 'quiet',
          text: `${p.name} has not appeared in anything for ${p.sinceSeenDays} days but still owns ${plural(p.open, 'open task')}.`,
          evidence: p.items.map((e) => e.id),
          effect: null,
          strength: Math.min(1, p.sinceSeenDays / 90),
        })
      }
    }
  }

  if (habits.finished >= 5 && habits.lateRate >= 0.5) {
    add({
      id: 'rhythm:late',
      kind: 'rhythm',
      text: `You finish most tasks after their due date (${habits.finishedLate} of ${habits.finished}). Reminders will move to a day ahead instead of ${plural(15, 'minute')}.`,
      evidence: [],
      effect: { kind: 'lead-time', minutes: 24 * 60 },
      strength: habits.lateRate,
    })
  } else if (habits.finished >= 5 && habits.medianLeadDays >= 2) {
    add({
      id: 'rhythm:early',
      kind: 'rhythm',
      text: `You usually finish about ${Math.round(habits.medianLeadDays)} days before a task is due. Due dates are a plan for you, not a deadline.`,
      evidence: [],
      effect: null,
      strength: Math.min(1, habits.medianLeadDays / 7),
    })
  }

  if (habits.medianHorizonDays !== null && habits.openDated + habits.finished >= 8 && habits.medianHorizonDays <= 2) {
    add({
      id: 'horizon:short',
      kind: 'horizon',
      text: `You plan about ${Math.max(1, Math.round(habits.medianHorizonDays))} days ahead. Next week's work is invisible until it is urgent; the default range will widen to the week.`,
      evidence: [],
      effect: { kind: 'range', range: 'week' },
      strength: 0.6,
    })
  }

  if (rhythm.busiestMeetingDay !== null) {
    const day = rhythm.busiestMeetingDay
    const share = rhythm.meetingsByWeekday[day] / rhythm.meetings
    if (share >= 0.4) {
      add({
        id: `meeting-day:${day}`,
        kind: 'meeting-day',
        text: `${WEEKDAYS[day]}s hold ${pct(rhythm.meetingsByWeekday[day], rhythm.meetings)}% of your meetings. Tasks due that day get less time; triage will raise them a step earlier.`,
        evidence: events.filter((e) => e.at && new Date(e.at).getDay() === day).slice(0, 8).map((e) => e.id),
        effect: { kind: 'meeting-day', weekday: day },
        strength: share,
      })
    }
  }

  const views = usage.views || {}
  const opened = Object.values(views).reduce((a, b) => a + b, 0)
  if (opened >= 20) {
    for (const view of ['triage', 'analytics', 'timeline']) {
      if ((views[view] || 0) >= (views.today || 0) * 1.5 && (views[view] || 0) >= 8) {
        add({
          id: `start-view:${view}`,
          kind: 'start-view',
          text: `You open ${view[0].toUpperCase() + view.slice(1)} more than Today (${views[view]} to ${views.today || 0} times). The app will start there.`,
          evidence: [],
          effect: { kind: 'start-view', view },
          strength: 0.5,
        })
        break
      }
    }
  }

  return found.map((o) => ({
    ...o,
    status: brainState.accepted[o.id] ? 'accepted' : brainState.dismissed[o.id] ? 'dismissed' : 'pending',
    acceptedAt: brainState.accepted[o.id]?.at || null,
  }))
}

// ------------------------------------------------------------------- facts

function factLines({ profile, habits, rhythm, people, topics }) {
  const lines = []
  if (profile.documents) lines.push(`${profile.documents} document${profile.documents === 1 ? '' : 's'} read${profile.formats.length ? ` (${profile.formats.map((f) => f.kind).join(', ')})` : ''}.`)
  if (rhythm.activeHours.length) lines.push(`Usually here ${rhythm.activeHours.join(' and ')}${rhythm.activeDays.length ? ` on ${rhythm.activeDays.map((d) => WEEKDAYS[d].slice(0, 3)).join(', ')}` : ''}.`)
  if (rhythm.topViews.length) lines.push(`Opens ${rhythm.topViews.map((v) => v.view).join(', then ')} most.`)
  if (habits.finished >= 3) {
    lines.push(`Finished ${habits.finished} dated tasks in the app; ${pct(habits.finishedLate, habits.finished)}% after the due date${habits.medianLeadDays !== null ? `, typically ${describeLead(habits.medianLeadDays)}` : ''}.`)
  }
  if (habits.medianHorizonDays !== null) lines.push(`Plans about ${Math.max(1, Math.round(habits.medianHorizonDays))} days ahead.`)
  if (people.length) lines.push(`Works most with ${people.slice(0, 3).map((p) => p.name).join(', ')}.`)
  if (topics.length) lines.push(`Main topics: ${topics.slice(0, 4).map((t) => `#${t.tag}`).join(' ')}.`)
  if (rhythm.busiestMeetingDay !== null) lines.push(`Most meetings fall on ${WEEKDAYS[rhythm.busiestMeetingDay]}s.`)
  return lines
}

const describeLead = (days) => {
  if (days >= 1) return `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'} early`
  if (days > -1) return 'on the day'
  return `${Math.round(-days)} day${Math.round(-days) === 1 ? '' : 's'} late`
}

export { WEEKDAYS }
