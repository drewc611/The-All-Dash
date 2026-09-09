/** Number and label formatting shared by charts, tiles and insights. */

export function format(value, unit = '') {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  const rounded = abs >= 1000 ? Math.round(value) : Math.round(value * 100) / 100
  const body = rounded.toLocaleString()
  if (unit === '%') return `${body}%`
  if (unit === '$' || unit === '€' || unit === '£') return `${unit}${body}`
  if (unit === 'h' || unit === 'd') return `${body}${unit}`
  return unit ? `${body} ${unit}` : body
}

/** Compact form for axis ticks and tight tiles: 12.4k, 3.1M. */
export function compact(value) {
  if (!Number.isFinite(value)) return '0'
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${trim(value / 1e9)}B`
  if (abs >= 1e6) return `${trim(value / 1e6)}M`
  if (abs >= 1e4) return `${trim(value / 1e3)}k`
  if (abs >= 1000) return value.toLocaleString()
  return String(Math.round(value * 100) / 100)
}

const trim = (n) => String(Math.round(n * 10) / 10)

export function percent(value, digits = 0) {
  if (!Number.isFinite(value)) return '0%'
  return `${(value * 100).toFixed(digits)}%`
}

export const pluralise = (n, word, plural) => (n === 1 ? word : plural || `${word}s`)
