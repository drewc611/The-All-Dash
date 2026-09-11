import { parseLooseDate, iso, toDate } from '../core/time.js'

/**
 * The line reader behind every text format.
 *
 * Meeting notes, transcripts, plain text and stripped HTML all end up here.
 * Each line gets classified by the markers people actually type, and anything
 * that classifies produces an entity. Lines that match nothing stay as note
 * bodies rather than being thrown away, so nothing imported is ever lost.
 */

const MARKERS = [
  { type: 'task', re: /^(?:action items?|action|ai|todo|to-?do|next steps?|follow[- ]?ups?|task)\s*[:\-]\s*(.+)$/i },
  { type: 'decision', re: /^(?:decision|decided|agreed|resolution|resolved)\s*[:\-]\s*(.+)$/i },
  { type: 'risk', re: /^(?:risk|blocker|blocked|issue|concern|problem)\s*[:\-]\s*(.+)$/i },
  { type: 'milestone', re: /^(?:milestone|launch|ship|deadline|target)\s*[:\-]\s*(.+)$/i },
  { type: 'question', re: /^(?:open question|question|q)\s*[:\-]\s*(.+)$/i },
]

const CHECKBOX = /^[-*+]\s*\[( |x|X|\/|~)\]\s*(.+)$/
const BULLET = /^[-*+]\s+(.+)$/
const HEADING = /^(#{1,6})\s+(.+)$/
const NUMBERED = /^\d+[.)]\s+(.+)$/

const ATTENDEE_LINE = /^(?:attendees?|present|participants?|people|with)\s*[:\-]\s*(.+)$/i
const DATE_LINE = /^(?:date|when|meeting date|held)\s*[:\-]\s*(.+)$/i
const PROJECT_LINE = /^(?:project|workstream|team|client)\s*[:\-]\s*(.+)$/i

// "Revenue: $12,400", "NPS: 42", "Uptime: 99.5%", "Velocity: 31 pts"
const METRIC_LINE = /^([A-Za-z][A-Za-z0-9 _/&.'()-]{1,48}?)\s*[:=]\s*([$€£]?\s*-?[\d,]+(?:\.\d+)?)\s*(%|k|m|bn|pts?|hrs?|hours?|days?|d|h|min|users?|[$€£])?\s*$/

// "- 2026-03-01 - Beta launch" or "- Beta launch - 2026-03-01"
const TIMELINE_ROW = /^[-*+]?\s*(?:(\d{4}-\d{2}-\d{2})\s*[-|:]+\s*(.+)|(.+?)\s*[-|:]+\s*(\d{4}-\d{2}-\d{2}))\s*$/

const TIMELINE_HEADING = /(timeline|roadmap|schedule|milestones?|plan|key dates)/i
const RISK_HEADING = /(risks?|blockers?|issues?|concerns?)/i
const TASK_HEADING = /(action items?|actions|tasks?|todos?|next steps?|follow[- ]?ups?)/i
const DECISION_HEADING = /(decisions?|agreements?|outcomes?)/i
const METRIC_HEADING = /(metrics?|numbers?|kpis?|stats|measures?)/i

const STATUS_FOR_BOX = { ' ': 'open', '/': 'doing', x: 'done', X: 'done', '~': 'cancelled' }

/**
 * @param {string} text
 * @param {{docId:string, name:string, kind:string}} source
 * @returns {{entities: Array, meta: object}}
 */
export function extractFromText(text, source, refDate = new Date()) {
  const lines = String(text || '').split(/\r?\n/)
  const entities = []
  const meta = { people: [], project: null, date: null, title: null, headings: [] }
  // "by Friday" in notes dated three weeks ago means that week's Friday: once
  // the note names its date, relative dates resolve against it.
  const dateRef = () => (meta.date ? toDate(meta.date) : refDate)

  let section = null
  let sectionKind = null
  let pendingBody = []

  const contextTags = () => (section ? [slug(section)] : [])

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    if (!line) continue

    const heading = line.match(HEADING)
    if (heading) {
      const label = heading[2].replace(/[#*_`]/g, '').trim()
      meta.headings.push(label)
      if (heading[1].length === 1 && !meta.title) {
        // The document's own title names the document, not a topic.
        meta.title = label
        section = null
        sectionKind = null
        continue
      }
      section = label
      sectionKind = classifySection(section)
      continue
    }

    if (ATTENDEE_LINE.test(line)) {
      meta.people.push(...splitPeople(line.replace(ATTENDEE_LINE, '$1')))
      continue
    }
    if (DATE_LINE.test(line)) {
      meta.date = parseLooseDate(line.replace(DATE_LINE, '$1'), refDate) || meta.date
      continue
    }
    if (PROJECT_LINE.test(line)) {
      meta.project = line.replace(PROJECT_LINE, '$1').trim()
      continue
    }

    const base = { source: { ...source, line: i + 1 }, tags: contextTags() }

    // Checkboxes are unambiguous - always a task.
    const box = line.match(CHECKBOX)
    if (box) {
      entities.push(buildTask(box[2], { ...base, status: STATUS_FOR_BOX[box[1]] || 'open' }, dateRef()))
      continue
    }

    // Explicit markers beat section context.
    let matched = false
    for (const marker of MARKERS) {
      const m = line.match(marker.re)
      if (!m) continue
      entities.push(buildFromKind(marker.type, m[1], base, dateRef()))
      matched = true
      break
    }
    if (matched) continue

    // Timeline rows only inside a timeline section, otherwise too greedy.
    if (sectionKind === 'milestone') {
      const row = line.match(TIMELINE_ROW)
      if (row) {
        const when = row[1] || row[4]
        const label = (row[2] || row[3] || '').trim()
        if (when && label) {
          entities.push(buildFromKind('milestone', label, { ...base, due: parseLooseDate(when, dateRef()) }, dateRef()))
          continue
        }
      }
    }

    const metric = line.match(METRIC_LINE)
    if (metric && !/^(due|owner|status|priority|id|version|time|start|end)$/i.test(metric[1].trim())) {
      entities.push(buildMetric(metric, base, meta.date || refDate))
      continue
    }

    const bullet = line.match(BULLET) || line.match(NUMBERED)
    if (bullet) {
      const content = bullet[1].trim()
      if (sectionKind && sectionKind !== 'note') {
        entities.push(buildFromKind(sectionKind, content, base, dateRef()))
      } else if (looksLikeAction(content)) {
        entities.push(buildTask(content, base, dateRef()))
      } else {
        pendingBody.push(content)
      }
      continue
    }

    if (looksLikeAction(line) && line.length < 200) {
      entities.push(buildTask(line, base, refDate))
      continue
    }

    pendingBody.push(line)
  }

  meta.people = [...new Set(meta.people)]
  const summary = pendingBody.join('\n').trim()
  return { entities, meta, summary }
}

function classifySection(heading) {
  if (TASK_HEADING.test(heading)) return 'task'
  if (RISK_HEADING.test(heading)) return 'risk'
  if (DECISION_HEADING.test(heading)) return 'decision'
  if (TIMELINE_HEADING.test(heading)) return 'milestone'
  if (METRIC_HEADING.test(heading)) return 'metric'
  return null
}

function buildFromKind(kind, text, base, refDate) {
  if (kind === 'task') return buildTask(text, base, refDate)
  if (kind === 'question') {
    const { title, people, tags } = strip(text)
    return { ...base, type: 'note', title, people, tags: [...base.tags, ...tags, 'question'], confidence: 0.8 }
  }
  if (kind === 'metric') {
    const m = text.match(METRIC_LINE)
    if (m) return buildMetric(m, base, refDate)
    return { ...base, type: 'note', title: text, confidence: 0.5 }
  }
  const { title, people, tags, due, priority } = strip(text, refDate)
  return {
    ...base,
    type: kind,
    title,
    people,
    tags: [...base.tags, ...tags],
    due: base.due || due,
    at: kind === 'milestone' ? base.due || due : null,
    priority,
    status: kind === 'risk' ? 'open' : null,
    confidence: 0.85,
  }
}

function buildTask(text, base, refDate) {
  const { title, people, tags, due, priority } = strip(text, refDate)
  return {
    ...base,
    type: 'task',
    title,
    people,
    tags: [...base.tags, ...tags],
    due: base.due || due,
    priority,
    status: base.status || 'open',
    confidence: 0.9,
  }
}

function buildMetric(match, base, at) {
  const [, label, rawValue, rawUnit] = match
  const unit = normaliseUnit(rawValue, rawUnit)
  let value = Number(String(rawValue).replace(/[^0-9.-]/g, ''))
  const suffix = (rawUnit || '').toLowerCase()
  if (suffix === 'k') value *= 1e3
  if (suffix === 'm') value *= 1e6
  if (suffix === 'bn') value *= 1e9
  return {
    ...base,
    type: 'metric',
    title: label.trim(),
    series: label.trim(),
    value,
    unit,
    at: iso(at || new Date()),
    confidence: 0.75,
  }
}

function normaliseUnit(rawValue, rawUnit) {
  if (/^[$€£]/.test(String(rawValue).trim())) return String(rawValue).trim()[0]
  const u = (rawUnit || '').toLowerCase()
  if (u === '%') return '%'
  if (['$', '€', '£'].includes(u)) return u
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(u)) return 'h'
  if (['d', 'day', 'days'].includes(u)) return 'd'
  if (['pt', 'pts'].includes(u)) return 'pts'
  if (['k', 'm', 'bn'].includes(u)) return ''
  return u || ''
}

const ACTION_VERBS =
  /^(?:@?\w+ (?:to|will|should|must) |please |need to |follow up|send |draft |review |ship |fix |write |schedule |book |confirm |chase |prepare |update |share |set up |set-up |call |email |check |investigate |migrate |deploy |test |document )/i

function looksLikeAction(text) {
  if (/^(?:\w+\s+)?(?:said|asked|noted|mentioned|explained)\b/i.test(text)) return false
  return ACTION_VERBS.test(text) || /\bwill (?:send|draft|review|prepare|share|own|take)\b/i.test(text)
}

/** Pull owners, tags, due dates and priority out of a line, return clean title. */
export function strip(text, refDate = new Date()) {
  let title = String(text).trim()
  const people = []
  const tags = []
  let due = null
  let priority = 0

  title = title.replace(/@([A-Za-z][\w.'-]{1,30})/g, (_, name) => {
    people.push(titleCase(name))
    return ''
  })
  title = title.replace(/#([A-Za-z][\w-]{1,30})/g, (_, tag) => {
    tags.push(tag.toLowerCase())
    return ''
  })

  const owner = title.match(/\b(?:owner|assignee|assigned to)\s*[:\-]\s*([A-Za-z][\w .'-]{1,40})/i)
  if (owner) {
    people.push(...splitPeople(owner[1]))
    title = title.replace(owner[0], '')
  }

  const dueMatch = title.match(/\b(?:due|by|before|deadline)\s*[:\-]?\s*([^,;()]{2,30})/i)
  if (dueMatch) {
    const parsed = parseLooseDate(dueMatch[1], refDate)
    if (parsed) {
      due = parsed
      title = title.replace(dueMatch[0], '')
    }
  }
  if (!due) {
    const bare = parseLooseDate(title, refDate)
    if (bare && /\b(\d{4}-\d{2}-\d{2}|tomorrow|today|monday|tuesday|wednesday|thursday|friday)\b/i.test(title)) {
      due = bare
    }
  }

  if (/\bP0\b|\burgent\b|!!|\bcritical\b/i.test(title)) priority = 2
  else if (/\bP1\b|\bhigh\b|!\B/.test(title)) priority = 1
  title = title.replace(/\bP[012]\b/gi, '').replace(/!!+/g, '')

  const trailingOwner = title.match(/[([]([A-Z][a-z]+(?: [A-Z][a-z]+)?)[)\]]\s*$/)
  if (trailingOwner) {
    people.push(trailingOwner[1])
    title = title.replace(trailingOwner[0], '')
  }

  title = title.replace(/\s{2,}/g, ' ').replace(/^[\s\-:,]+|[\s\-:,]+$/g, '').trim()
  return { title: title || String(text).trim(), people, tags, due, priority }
}

/**
 * "@Dev" in an action item and "Dev Kaur" in the attendee list are the same
 * person. When a bare first name matches exactly one known full name, use the
 * full name so the person shows up once everywhere.
 */
export function canonicalPeople(names, known) {
  if (!names?.length || !known?.length) return names || []
  return names.map((name) => {
    if (name.includes(' ')) return name
    const matches = known.filter((k) => k.toLowerCase().split(' ')[0] === name.toLowerCase())
    return matches.length === 1 ? matches[0] : name
  })
}

export function splitPeople(text) {
  return String(text)
    .split(/[,;/&]|\band\b/i)
    .map((s) => s.replace(/[<(].*?[>)]/g, '').replace(/@[\w.]+/g, '').trim())
    .filter((s) => s.length > 1 && s.length < 48)
    .map(titleCase)
}

export const titleCase = (s) =>
  String(s)
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')

export const slug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)
