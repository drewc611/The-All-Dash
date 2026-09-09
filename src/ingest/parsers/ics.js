import { defineParser } from '../../core/registry.js'
import { extractFromText, titleCase } from '../extract.js'
import { iso, addDays } from '../../core/time.js'

/**
 * iCalendar feeds and .ics exports. Recurring events are expanded for a year
 * either side of today, which is enough for an agenda and cheap enough to do
 * on the main thread.
 */

const MAX_OCCURRENCES = 120

export function unfold(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter(Boolean)
}

export function parseIcsDate(value, params = {}) {
  const raw = String(value || '').trim()
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m
  const allDay = !m[4]
  const date = z
    ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
    : new Date(+y, +mo - 1, +d, +h, +mi, +s)
  return Number.isNaN(Number(date)) ? null : { iso: iso(date), date, allDay: allDay || params.VALUE === 'DATE' }
}

export function parseIcs(text) {
  const lines = unfold(text)
  const events = []
  let current = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = { attendees: [] }; continue }
    if (line === 'END:VEVENT') { if (current) events.push(current); current = null; continue }
    if (!current) continue

    const split = line.indexOf(':')
    if (split < 0) continue
    const left = line.slice(0, split)
    const value = line.slice(split + 1)
    const [key, ...paramParts] = left.split(';')
    const params = {}
    for (const p of paramParts) {
      const eq = p.indexOf('=')
      if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
    }

    switch (key.toUpperCase()) {
      case 'SUMMARY': current.summary = unescapeText(value); break
      case 'DESCRIPTION': current.description = unescapeText(value); break
      case 'LOCATION': current.location = unescapeText(value); break
      case 'UID': current.uid = value; break
      case 'STATUS': current.status = value; break
      case 'DTSTART': current.start = parseIcsDate(value, params); break
      case 'DTEND': current.end = parseIcsDate(value, params); break
      case 'RRULE': current.rrule = parseRrule(value); break
      case 'ORGANIZER': current.organizer = personFrom(params, value); break
      case 'ATTENDEE': current.attendees.push(personFrom(params, value)); break
      default: break
    }
  }
  return events
}

function personFrom(params, value) {
  if (params.CN) return titleCase(params.CN)
  const email = String(value).replace(/^mailto:/i, '')
  return titleCase(email.split('@')[0].replace(/[._-]+/g, ' '))
}

function parseRrule(value) {
  const out = {}
  for (const part of String(value).split(';')) {
    const [k, v] = part.split('=')
    if (k) out[k.toUpperCase()] = v
  }
  return out
}

function unescapeText(v) {
  return String(v).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\')
}

/** Expand DAILY/WEEKLY/MONTHLY/YEARLY rules; anything fancier stays single. */
export function expand(event, windowStart, windowEnd) {
  if (!event.start) return []
  const first = event.start.date
  if (!event.rrule?.FREQ) return [first]

  const { FREQ, INTERVAL, COUNT, UNTIL } = event.rrule
  const step = Math.max(1, Number(INTERVAL) || 1)
  const until = UNTIL ? parseIcsDate(UNTIL)?.date : null
  const limit = Math.min(Number(COUNT) || MAX_OCCURRENCES, MAX_OCCURRENCES)
  const out = []
  let cursor = new Date(first)

  for (let i = 0; i < limit; i++) {
    if (until && cursor > until) break
    if (cursor > windowEnd) break
    if (cursor >= windowStart) out.push(new Date(cursor))
    if (FREQ === 'DAILY') cursor = addDays(cursor, step)
    else if (FREQ === 'WEEKLY') cursor = addDays(cursor, 7 * step)
    else if (FREQ === 'MONTHLY') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + step, cursor.getDate(), cursor.getHours(), cursor.getMinutes())
    else if (FREQ === 'YEARLY') cursor = new Date(cursor.getFullYear() + step, cursor.getMonth(), cursor.getDate(), cursor.getHours(), cursor.getMinutes())
    else break
  }
  return out.length ? out : [first]
}

defineParser({
  id: 'ics',
  name: 'Calendar (iCalendar)',
  extensions: ['.ics', '.ical'],
  priority: 30,
  match: ({ name, text }) =>
    /\.(ics|ical|ifb)$/i.test(name || '') || /BEGIN:VCALENDAR/i.test(String(text || '').slice(0, 400)),
  parse: ({ name, text, docId, kind }) => {
    const source = { docId, name, kind }
    const now = new Date()
    const windowStart = addDays(now, -365)
    const windowEnd = addDays(now, 365)
    const out = []

    for (const event of parseIcs(text)) {
      if (!event.start || !event.summary) continue
      const people = [...new Set([event.organizer, ...event.attendees].filter(Boolean))]
      const durationMs = event.end ? event.end.date - event.start.date : 30 * 60000

      for (const occurrence of expand(event, windowStart, windowEnd)) {
        out.push({
          type: 'event',
          title: event.summary,
          body: [event.location, event.description].filter(Boolean).join('\n').slice(0, 2000),
          at: iso(occurrence),
          end: iso(new Date(occurrence.getTime() + durationMs)),
          people,
          tags: ['calendar', ...(event.start.allDay ? ['all-day'] : [])],
          status: event.status === 'CANCELLED' ? 'cancelled' : null,
          meta: { location: event.location || '', allDay: event.start.allDay, uid: event.uid },
          source,
          confidence: 1,
        })
      }

      // Agendas hidden in invite descriptions are a real source of actions.
      if (event.description) {
        const nested = extractFromText(event.description, source, event.start.date).entities
        for (const e of nested) {
          if (e.type === 'note') continue
          out.push({ ...e, people: e.people?.length ? e.people : people, tags: [...(e.tags || []), 'calendar'] })
        }
      }
    }
    return out
  },
})
