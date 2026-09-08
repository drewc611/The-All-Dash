/**
 * Date handling, deliberately small. Everything in the store is an ISO string;
 * this file is the only place that knows about calendars.
 */

const DAY = 86400000
export const MS = { minute: 60000, hour: 3600000, day: DAY, week: 7 * DAY }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The one place a value becomes a Date. A bare "YYYY-MM-DD" day key is a
 * local calendar day, so it is built from its parts: `new Date("2026-03-04")`
 * would be UTC midnight, which is the previous evening in the Americas and
 * would shift every day label and the "Today" highlight by one.
 */
export function toDate(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const m = value.match(DAY_KEY)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return new Date(value)
}

export const iso = (d) => toDate(d).toISOString()
export const startOfDay = (d = new Date()) => { const x = new Date(toDate(d)); x.setHours(0, 0, 0, 0); return x }
export const endOfDay = (d = new Date()) => { const x = new Date(toDate(d)); x.setHours(23, 59, 59, 999); return x }
/** Calendar days, not 24-hour blocks: crossing a DST change keeps the clock time. */
export const addDays = (d, n) => { const x = new Date(toDate(d)); x.setDate(x.getDate() + n); return x }
export const dayKey = (d) => {
  const x = startOfDay(d)
  const pad = (n) => String(n).padStart(2, '0')
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

export function startOfWeek(d = new Date(), weekStartsOn = 1) {
  const x = startOfDay(d)
  const diff = (x.getDay() - weekStartsOn + 7) % 7
  return addDays(x, -diff)
}

export const isSameDay = (a, b) => dayKey(a) === dayKey(b)

/** Human-scale relative label: "in 3d", "2h ago", "now". */
export function relative(target, from = Date.now()) {
  const delta = toDate(target).getTime() - toDate(from).getTime()
  const abs = Math.abs(delta)
  if (Number.isNaN(abs)) return ''
  if (abs < MS.minute) return 'now'
  let n
  let unit
  if (abs < MS.hour) { n = Math.round(abs / MS.minute); unit = 'm' }
  else if (abs < DAY) { n = Math.round(abs / MS.hour); unit = 'h' }
  else if (abs < 30 * DAY) { n = Math.round(abs / DAY); unit = 'd' }
  else { n = Math.round(abs / (30 * DAY)); unit = 'mo' }
  return delta >= 0 ? `in ${n}${unit}` : `${n}${unit} ago`
}

export function formatDate(d, opts = {}) {
  if (!d) return ''
  const date = toDate(d)
  if (Number.isNaN(Number(date))) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...opts })
}

export function formatTime(d) {
  if (!d) return ''
  const date = toDate(d)
  if (Number.isNaN(Number(date))) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function atHour(d, hour) {
  const x = new Date(d)
  x.setHours(hour, 0, 0, 0)
  return x
}

/**
 * Parse the dates people actually write in notes: "2026-03-04", "by Friday",
 * "next tuesday", "Mar 4", "4 March", "3/4/26", "EOD", "in 2 weeks".
 * Returns an ISO string, or null when it cannot tell. It never guesses.
 */
export function parseLooseDate(input, ref = new Date()) {
  if (!input) return null
  const text = String(input).toLowerCase().trim()
  const base = startOfDay(ref)

  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) {
    const d = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]))
    return Number.isNaN(Number(d)) ? null : iso(atHour(d, 17))
  }

  if (/(^|\W)(eod|end of day|today|tonight)(\W|$)/.test(text)) return iso(atHour(base, 17))
  if (/(^|\W)tomorrow(\W|$)/.test(text)) return iso(atHour(addDays(base, 1), 17))
  if (/(^|\W)yesterday(\W|$)/.test(text)) return iso(atHour(addDays(base, -1), 17))
  if (/(^|\W)(eow|end of week)(\W|$)/.test(text)) return iso(atHour(addDays(startOfWeek(base), 4), 17))
  if (/(^|\W)(eom|end of month)(\W|$)/.test(text)) {
    return iso(atHour(new Date(base.getFullYear(), base.getMonth() + 1, 0), 17))
  }

  const inN = text.match(/in (\d+) (day|week|month)s?/)
  if (inN) {
    const mult = inN[2] === 'week' ? 7 : inN[2] === 'month' ? 30 : 1
    return iso(atHour(addDays(base, Number(inN[1]) * mult), 17))
  }

  const weekday = text.match(/(next |this |last )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/)
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2])
    const modifier = (weekday[1] || '').trim()
    let delta = (target - base.getDay() + 7) % 7
    if (delta === 0) delta = 7
    if (modifier === 'next' && delta < 7) delta += 7
    if (modifier === 'last') delta -= 7
    return iso(atHour(addDays(base, delta), 17))
  }

  const monthDay = text.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/
  )
  if (monthDay) {
    const year = monthDay[3] ? Number(monthDay[3]) : base.getFullYear()
    const d = new Date(year, MONTHS.indexOf(monthDay[1]), Number(monthDay[2]))
    return Number.isNaN(Number(d)) ? null : iso(atHour(d, 17))
  }

  const dayMonth = text.match(
    /(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,?\s*(\d{4}))?/
  )
  if (dayMonth) {
    const year = dayMonth[3] ? Number(dayMonth[3]) : base.getFullYear()
    const d = new Date(year, MONTHS.indexOf(dayMonth[2]), Number(dayMonth[1]))
    return Number.isNaN(Number(d)) ? null : iso(atHour(d, 17))
  }

  // Slash dates are ambiguous by nature. Assume month-first unless the first
  // number is too big to be a month.
  const slash = text.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (slash) {
    let month = Number(slash[1])
    let day = Number(slash[2])
    if (month > 12) { const t = month; month = day; day = t }
    let year = slash[3] ? Number(slash[3]) : base.getFullYear()
    if (year < 100) year += 2000
    const d = new Date(year, month - 1, day)
    return Number.isNaN(Number(d)) ? null : iso(atHour(d, 17))
  }

  return null
}

/** Named windows. Every analytics call takes one of these. */
export function rangeFor(preset, ref = new Date()) {
  const end = endOfDay(ref)
  if (preset === 'today') return { from: startOfDay(ref), to: end, label: 'Today', days: 1 }
  if (preset === 'week') return { from: startOfWeek(ref), to: end, label: 'This week', days: 7 }
  if (preset === 'all') return { from: new Date(0), to: new Date(8.64e15), label: 'All time', days: 3650 }
  const days = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }[preset] ?? 30
  return { from: startOfDay(addDays(ref, -days + 1)), to: end, label: `Last ${days} days`, days }
}

export const RANGE_PRESETS = ['today', 'week', '7d', '30d', '90d', 'all']
