import { dayKey } from '../core/time.js'
import { WEEKDAYS } from './learn.js'

/**
 * The brain as a folder of Markdown files.
 *
 * Plain files with a small front matter block, so they read well in any
 * editor, diff well in git, and can be handed to an agent that never sees
 * the app. `notes` are the person's own words per file, kept in the store
 * and appended under "## Notes" every time the file is regenerated.
 */

export const slugify = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item'

const pctText = (rate) => (rate === null || rate === undefined ? '-' : `${Math.round(rate * 100)}%`)
const day = (iso) => (iso ? dayKey(iso) : '-')
const front = (fields) => ['---', ...Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}: ${yaml(v)}`), '---'].join('\n')
const yaml = (v) => (Array.isArray(v) ? `[${v.map(yaml).join(', ')}]` : typeof v === 'string' && /[:#\[\]{}"']|^\s|\s$/.test(v) ? JSON.stringify(v) : String(v))
const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n')

/** Every file, in a stable order. */
export function renderBrain(brain, brainState = {}) {
  const notes = brainState.notes || {}
  const files = []
  const push = (path, text) => files.push({ path, text: withNotes(text, notes[path]) })

  push('README.md', readme(brain, brainState))
  push('profile.md', profile(brain))
  push('habits.md', habits(brain))
  push('insights.md', insights(brain))
  for (const p of brain.people) push(`people/${slugify(p.name)}.md`, person(p))
  for (const t of brain.topics) push(`topics/${slugify(t.tag)}.md`, topic(t))
  return files
}

/** A hash of the content that changes only when something learned changes. */
export function signature(files) {
  let h = 2166136261
  for (const f of files) {
    const text = f.text.replace(/^generated: .*$/m, '')
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
  }
  return (h >>> 0).toString(16)
}

function withNotes(text, note) {
  const body = text.trimEnd()
  return note && note.trim() ? `${body}\n\n## Notes\n\n${note.trim()}\n` : `${body}\n`
}

function readme(brain, brainState) {
  const { profile, opinions } = brain
  const accepted = opinions.filter((o) => o.status === 'accepted')
  const pending = opinions.filter((o) => o.status === 'pending')
  return [
    front({ workspace: profile.workspace, generated: brain.generatedAt, version: brain.version, entities: profile.entities, documents: profile.documents }),
    '',
    `# ${profile.name ? `${profile.name}'s brain` : 'Brain'}`,
    '',
    'What The All Dash has learned about the person using it. Every line is computed from their own data by rules, on their device; no model is involved. Facts are recorded automatically; opinions are proposed and only count once accepted.',
    '',
    '## Facts',
    '',
    ...(brain.facts.length ? brain.facts.map((f) => `- ${f}`) : ['- Nothing yet. Import a few documents and use the app for a while.']),
    '',
    '## Files',
    '',
    '- `profile.md`: who this is and how they work',
    '- `habits.md`: completion rhythm and meeting load by weekday',
    '- `insights.md`: opinions, accepted and pending',
    `- \`people/\`: ${brain.people.length} ${brain.people.length === 1 ? 'person' : 'people'} they work with`,
    `- \`topics/\`: ${brain.topics.length} ${brain.topics.length === 1 ? 'topic' : 'topics'} (tags)`,
    '',
    '## Status',
    '',
    `- ${accepted.length} accepted opinion${accepted.length === 1 ? '' : 's'}, ${pending.length} pending`,
    `- Last synced: ${brainState.sync?.lastSyncAt ? brainState.sync.lastSyncAt : 'never'}${brainState.sync?.folder ? ` to ${brainState.sync.folder}` : ''}`,
  ].join('\n')
}

function profile(brain) {
  const { profile, habits, rhythm } = brain
  return [
    front({
      name: profile.name || null,
      role: profile.role || null,
      focus: profile.focus || null,
      workspace: profile.workspace,
      timezone: profile.timezone || null,
      since: profile.since ? day(profile.since) : null,
      last_seen: profile.lastSeen ? day(profile.lastSeen) : null,
      sessions: profile.sessions,
      documents: profile.documents,
      formats: profile.formats.map((f) => f.kind),
    }),
    '',
    `# ${profile.name || 'Profile'}`,
    '',
    profile.role ? `${profile.role}${profile.focus ? `, focused on ${profile.focus}` : ''}.` : profile.focus ? `Focused on ${profile.focus}.` : '',
    '',
    '## Rhythm',
    '',
    `- Active hours: ${rhythm.activeHours.length ? rhythm.activeHours.join(', ') : 'not enough data yet'}`,
    `- Active days: ${rhythm.activeDays.length ? rhythm.activeDays.map((d) => WEEKDAYS[d]).join(', ') : 'not enough data yet'}`,
    `- Views used most: ${rhythm.topViews.length ? rhythm.topViews.map((v) => `${v.view} (${v.count})`).join(', ') : '-'}`,
    `- Actions: ${rhythm.topActions.length ? rhythm.topActions.map((a) => `${a.action} (${a.count})`).join(', ') : '-'}`,
    '',
    '## How they work',
    '',
    `- Dated tasks finished in the app: ${habits.finished}`,
    `- Finished after the due date: ${pctText(habits.lateRate)}`,
    `- Typical finish: ${habits.medianLeadDays === null ? '-' : `${Math.round(habits.medianLeadDays)} days before due`}`,
    `- Planning horizon: ${habits.medianHorizonDays === null ? '-' : `${Math.round(habits.medianHorizonDays)} days`}`,
    `- Open dated tasks: ${habits.openDated}, overdue: ${habits.overdueOpen} (${pctText(habits.overdueRate)})`,
    `- Open tasks without an owner: ${habits.unownedOpen}`,
    '',
    '## Data',
    '',
    `- ${profile.entities} entities from ${profile.documents} documents`,
    ...profile.formats.map((f) => `- ${f.kind}: ${f.count}`),
  ].filter((l) => l !== undefined).join('\n')
}

function habits(brain) {
  const { rhythm } = brain
  const rows = WEEKDAYS.map((name, i) => [name, rhythm.doneByWeekday[i], rhythm.meetingsByWeekday[i]])
  const hours = rhythm.doneByHour.map((n, h) => [h, n]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6)
  return [
    front({ finished: brain.habits.finished, meetings_90d: rhythm.meetings, busiest_meeting_day: rhythm.busiestMeetingDay === null ? null : WEEKDAYS[rhythm.busiestMeetingDay] }),
    '',
    '# Habits',
    '',
    '## By weekday',
    '',
    table(['Day', 'Tasks finished', 'Meetings (90 days back, 30 ahead)'], rows),
    '',
    '## Hours tasks get finished',
    '',
    hours.length ? table(['Hour', 'Tasks'], hours.map(([h, n]) => [`${String(h).padStart(2, '0')}:00`, n])) : 'Not enough finished tasks yet.',
    '',
    '## App usage by hour',
    '',
    rhythm.activeHours.length ? `Mostly ${rhythm.activeHours.join(' and ')}.` : 'Not enough sessions yet.',
  ].join('\n')
}

function insights(brain) {
  const by = (status) => brain.opinions.filter((o) => o.status === status)
  const block = (title, list, empty) => [
    `## ${title}`,
    '',
    ...(list.length ? list.map((o) => `- **${o.kind}** ${o.text}${o.acceptedAt ? ` _(accepted ${day(o.acceptedAt)})_` : ''}${o.evidence.length ? ` _(${o.evidence.length} item${o.evidence.length === 1 ? '' : 's'})_` : ''}`) : [`- ${empty}`]),
    '',
  ]
  return [
    front({ accepted: by('accepted').length, pending: by('pending').length, dismissed: by('dismissed').length }),
    '',
    '# Insights',
    '',
    'Opinions are judgements with evidence. Accepted ones change the dashboard: a slipping tag is raised earlier in triage, an overloaded person is watched, reminders move, the start view changes. Dismissed ones stay dismissed until the evidence changes.',
    '',
    ...block('Accepted', by('accepted'), 'None accepted yet.'),
    ...block('Pending', by('pending'), 'Nothing proposed right now.'),
    ...block('Dismissed', by('dismissed'), 'None.'),
  ].join('\n')
}

function person(p) {
  return [
    front({ name: p.name, open: p.open, done: p.done, overdue: p.overdue, meetings: p.meetings, last_seen: p.lastSeen ? day(p.lastSeen) : null, on_time: p.onTimeRate === null ? null : pctText(p.onTimeRate), share_of_open_work: pctText(p.share) }),
    '',
    `# ${p.name}`,
    '',
    `${p.open} open, ${p.done} done, ${p.overdue} overdue, ${p.meetings} meeting${p.meetings === 1 ? '' : 's'}. Seen in ${p.documents} document${p.documents === 1 ? '' : 's'}${p.lastSeen ? `, last ${day(p.lastSeen)}` : ''}.`,
    '',
    p.with.length ? `Works with: ${p.with.join(', ')}.` : '',
    p.tags.length ? `Topics: ${p.tags.map((t) => `#${t}`).join(' ')}.` : '',
    p.onTimeRate !== null ? `Finishes on time ${pctText(p.onTimeRate)} of the time (${p.finished} tracked).` : '',
    '',
    '## Open items',
    '',
    ...(p.items.length ? p.items.map((e) => `- ${e.title}${e.due ? ` (due ${day(e.due)})` : ''}${e.status !== 'open' ? ` [${e.status}]` : ''}`) : ['- None']),
  ].filter((l) => l !== '').join('\n')
}

function topic(t) {
  return [
    front({ tag: t.tag, total: t.total, open: t.open, done: t.done, overdue: t.overdue, unowned: t.unowned, slip_rate: t.slipRate === null ? null : pctText(t.slipRate), momentum: t.momentum, last_active: t.lastActive ? day(t.lastActive) : null }),
    '',
    `# #${t.tag}`,
    '',
    `${t.total} item${t.total === 1 ? '' : 's'} across ${t.documents} document${t.documents === 1 ? '' : 's'}: ${t.open} open, ${t.done} done, ${t.overdue} overdue, ${t.unowned} without an owner.`,
    '',
    t.momentum > 0 ? `Picking up: ${t.recent} new in the last two weeks, ${t.recent - t.momentum} the two before.` : t.momentum < 0 ? `Slowing down: ${t.recent} new in the last two weeks, ${t.recent - t.momentum} the two before.` : '',
    t.slipRate !== null ? `Finished late ${pctText(t.slipRate)} of the time (${t.finished} tracked).` : '',
    t.people.length ? `People: ${t.people.join(', ')}.` : '',
    '',
    '## Open items',
    '',
    ...(t.items.length ? t.items.map((e) => `- ${e.title}${e.due ? ` (due ${day(e.due)})` : ''}${e.people.length ? ` @${e.people[0]}` : ''}`) : ['- None']),
  ].filter((l) => l !== '').join('\n')
}
