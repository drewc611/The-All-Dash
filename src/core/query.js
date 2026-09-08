import { dayKey, addDays, startOfDay } from './time.js'

/**
 * A tiny query layer over the entity list. Chainable, lazy enough, and small
 * enough to read in one sitting. Widgets use this instead of hand-rolling
 * filters, which is what keeps them to twenty lines each.
 *
 *   q(entities).type('task').open().due({ before: tomorrow }).sort('due').take(5)
 */
class Query {
  constructor(rows) {
    this.rows = rows
  }

  get length() { return this.rows.length }
  all() { return this.rows }
  first() { return this.rows[0] || null }
  take(n) { return this.rows.slice(0, n) }
  map(fn) { return this.rows.map(fn) }

  where(fn) { return new Query(this.rows.filter(fn)) }

  type(...types) {
    const set = new Set(types.flat())
    return this.where((e) => set.has(e.type))
  }

  status(...statuses) {
    const set = new Set(statuses.flat())
    return this.where((e) => set.has(e.status))
  }

  open() { return this.status('open', 'doing', 'blocked') }

  tagged(...tags) {
    const set = new Set(tags.flat().map((t) => String(t).toLowerCase()))
    if (!set.size) return this
    return this.where((e) => e.tags.some((t) => set.has(t.toLowerCase())))
  }

  person(...names) {
    const set = new Set(names.flat().map((n) => String(n).toLowerCase()))
    if (!set.size) return this
    return this.where((e) => e.people.some((p) => set.has(p.toLowerCase())))
  }

  series(name) { return this.where((e) => e.series === name) }

  /** Free-text across title, body, tags and people. */
  search(text) {
    const needle = String(text || '').trim().toLowerCase()
    if (!needle) return this
    const terms = needle.split(/\s+/)
    return this.where((e) => {
      const hay = `${e.title} ${e.body} ${e.tags.join(' ')} ${e.people.join(' ')} ${e.type}`.toLowerCase()
      return terms.every((t) => hay.includes(t))
    })
  }

  /** Filter on any date field. `{ field, from, to, before, after }`. */
  between(from, to, field = 'at') {
    const lo = from ? new Date(from).getTime() : -Infinity
    const hi = to ? new Date(to).getTime() : Infinity
    return this.where((e) => {
      const v = e[field]
      if (!v) return false
      const t = new Date(v).getTime()
      return t >= lo && t <= hi
    })
  }

  due({ before, after } = {}) {
    return this.where((e) => {
      if (!e.due) return false
      const t = new Date(e.due).getTime()
      if (before && t > new Date(before).getTime()) return false
      if (after && t < new Date(after).getTime()) return false
      return true
    })
  }

  onDay(day, field = 'at') {
    const key = dayKey(day)
    return this.where((e) => e[field] && dayKey(e[field]) === key)
  }

  sort(field = 'at', dir = 'asc') {
    const sign = dir === 'desc' ? -1 : 1
    const rows = [...this.rows].sort((a, b) => {
      const av = a[field]
      const bv = b[field]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign
      return String(av).localeCompare(String(bv)) * sign
    })
    return new Query(rows)
  }

  /** Group into a Map keyed by field value or by a function. */
  groupBy(key) {
    const fn = typeof key === 'function' ? key : (e) => e[key]
    const out = new Map()
    for (const row of this.rows) {
      const k = fn(row)
      const keys = Array.isArray(k) ? k : [k]
      for (const kk of keys) {
        if (kk === null || kk === undefined || kk === '') continue
        if (!out.has(kk)) out.set(kk, [])
        out.get(kk).push(row)
      }
    }
    return out
  }

  count() { return this.rows.length }
  sum(field = 'value') { return this.rows.reduce((acc, e) => acc + (Number(e[field]) || 0), 0) }
  avg(field = 'value') { return this.rows.length ? this.sum(field) / this.rows.length : 0 }
}

export const q = (entities) => new Query(Array.isArray(entities) ? entities : Object.values(entities || {}))

// ------------------------------------------------------------- aggregation

/**
 * Bucket rows into one point per day across a range. Returns a dense series
 * (zeros included) so charts do not lie about gaps.
 */
export function daily(rows, { from, to, field = 'at', reduce = 'count', valueField = 'value' }) {
  const start = startOfDay(from)
  const end = startOfDay(to)
  const buckets = new Map()
  for (let d = start; d <= end; d = addDays(d, 1)) buckets.set(dayKey(d), [])
  for (const row of rows) {
    const key = row[field] && dayKey(row[field])
    if (key && buckets.has(key)) buckets.get(key).push(row)
  }
  return [...buckets.entries()].map(([key, group]) => ({
    key,
    at: key,
    value: applyReduce(group, reduce, valueField),
    rows: group,
  }))
}

function applyReduce(group, reduce, field) {
  if (reduce === 'count') return group.length
  const nums = group.map((r) => Number(r[field])).filter(Number.isFinite)
  if (!nums.length) return 0
  if (reduce === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (reduce === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (reduce === 'min') return Math.min(...nums)
  if (reduce === 'max') return Math.max(...nums)
  if (reduce === 'last') return nums[nums.length - 1]
  return nums.length
}

export const REDUCERS = ['count', 'sum', 'avg', 'min', 'max', 'last']

// ------------------------------------------------------------- statistics

/** Least-squares slope over a value series. Positive means rising. */
export function trend(series) {
  const pts = series.map((p, i) => [i, Number(p.value) || 0])
  const n = pts.length
  if (n < 2) return { slope: 0, intercept: pts[0]?.[1] ?? 0, r2: 0 }
  const meanX = pts.reduce((a, p) => a + p[0], 0) / n
  const meanY = pts.reduce((a, p) => a + p[1], 0) / n
  let num = 0
  let den = 0
  for (const [x, y] of pts) {
    num += (x - meanX) * (y - meanY)
    den += (x - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX
  let ssTot = 0
  let ssRes = 0
  for (const [x, y] of pts) {
    ssTot += (y - meanY) ** 2
    ssRes += (y - (slope * x + intercept)) ** 2
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot }
}

/** Percent change between the first and second half of a series. */
export function momentum(series) {
  if (series.length < 4) return 0
  const mid = Math.floor(series.length / 2)
  const first = series.slice(0, mid).reduce((a, p) => a + (Number(p.value) || 0), 0)
  const second = series.slice(mid).reduce((a, p) => a + (Number(p.value) || 0), 0)
  if (first === 0) return second === 0 ? 0 : 1
  return (second - first) / Math.abs(first)
}

/** Points more than `z` standard deviations from the mean. */
export function anomalies(series, z = 2) {
  const values = series.map((p) => Number(p.value) || 0)
  const n = values.length
  if (n < 5) return []
  const mean = values.reduce((a, b) => a + b, 0) / n
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n)
  if (sd === 0) return []
  return series.filter((p) => Math.abs((Number(p.value) || 0) - mean) / sd >= z)
}

/** Longest run of consecutive non-zero days, ending at the most recent day. */
export function streak(series) {
  let current = 0
  for (let i = series.length - 1; i >= 0; i--) {
    if ((Number(series[i].value) || 0) > 0) current++
    else break
  }
  return current
}

/**
 * Project the fitted trend forward. Returns the value expected `days` after
 * the last point, plus how many days until `target` is reached (null when the
 * trend does not point at it).
 */
export function forecast(series, { days = 7, target = null } = {}) {
  const fit = trend(series)
  const n = series.length
  if (n < 3) return { value: series.at(-1)?.value ?? 0, daysToTarget: null, slope: 0, r2: 0 }
  const value = fit.intercept + fit.slope * (n - 1 + days)
  let daysToTarget = null
  if (target !== null && Number.isFinite(target) && fit.slope !== 0) {
    const current = fit.intercept + fit.slope * (n - 1)
    const eta = (target - current) / fit.slope
    daysToTarget = eta >= 0 ? Math.ceil(eta) : null
  }
  return { value, daysToTarget, slope: fit.slope, r2: fit.r2 }
}

/** Pearson correlation between two equal-length value series, -1..1. */
export function correlation(a, b) {
  const n = Math.min(a.length, b.length)
  if (n < 5) return 0
  const xs = a.slice(0, n).map((p) => Number(p.value) || 0)
  const ys = b.slice(0, n).map((p) => Number(p.value) || 0)
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my)
    dx += (xs[i] - mx) ** 2
    dy += (ys[i] - my) ** 2
  }
  const den = Math.sqrt(dx * dy)
  return den === 0 ? 0 : num / den
}

export function movingAverage(series, window = 7) {
  return series.map((p, i) => {
    const slice = series.slice(Math.max(0, i - window + 1), i + 1)
    const sum = slice.reduce((a, s) => a + (Number(s.value) || 0), 0)
    return { ...p, value: sum / slice.length }
  })
}
