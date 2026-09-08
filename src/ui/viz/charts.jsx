import { useMemo, useState, useId } from 'react'
import { compact, format } from '../../core/format.js'
import { formatDate } from '../../core/time.js'

/**
 * Charts, drawn by hand in SVG.
 *
 * A charting library would be four times the size of this file and would still
 * need wrapping to obey the house rules: thin marks, a recessive grid, one
 * y-axis, a hover layer on everything, and text in ink tokens rather than the
 * series colour.
 */

export const SERIES = [
  'var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)',
  'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)',
]

const nice = (max) => {
  if (max <= 0) return 1
  const exp = Math.floor(Math.log10(max))
  const base = 10 ** exp
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (max <= step * base) return step * base
  }
  return 10 * base
}

// ------------------------------------------------------------- sparkline

export function Sparkline({ points, color = SERIES[0], height = 32, area = true }) {
  const values = points.map((p) => Number(p.value) || 0)
  const id = useId()
  if (values.length < 2) return <div style={{ height }} />

  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const w = 100
  const x = (i) => (i / (values.length - 1)) * w
  const y = (v) => height - ((v - min) / span) * (height - 3) - 1.5
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${height}`} height={height} preserveAspectRatio="none" role="img" aria-hidden="true">
      {area && (
        <>
          <defs>
            <linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#sp${id})`} />
        </>
      )}
      <path d={line} className="viz__line" stroke={color} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

// ------------------------------------------------------------ line chart

export function LineChart({ series, height = 200, unit = '', showLegend = true }) {
  const [hover, setHover] = useState(null)
  const pad = { top: 8, right: 8, bottom: 20, left: 38 }
  const w = 640
  const h = height

  const model = useMemo(() => {
    const lines = series.filter((s) => s.points?.length)
    const length = Math.max(0, ...lines.map((s) => s.points.length))
    const max = nice(Math.max(1, ...lines.flatMap((s) => s.points.map((p) => Number(p.value) || 0))))
    return { lines, length, max }
  }, [series])

  if (!model.lines.length || model.length < 2) return <Empty height={height} />

  const innerW = w - pad.left - pad.right
  const innerH = h - pad.top - pad.bottom
  const x = (i) => pad.left + (i / (model.length - 1)) * innerW
  const y = (v) => pad.top + innerH - (v / model.max) * innerH
  const ticks = [0, 0.5, 1].map((t) => t * model.max)
  const labels = model.lines[0].points

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width) * w
    const i = Math.round(((px - pad.left) / innerW) * (model.length - 1))
    setHover(Math.max(0, Math.min(model.length - 1, i)))
  }

  return (
    <div className="viz">
      <svg viewBox={`0 0 ${w} ${h}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        <g className="viz__grid">
          {ticks.map((t) => <line key={t} x1={pad.left} x2={w - pad.right} y1={y(t)} y2={y(t)} />)}
        </g>
        <g className="viz__tick">
          {ticks.map((t) => (
            <text key={t} x={pad.left - 6} y={y(t) + 3} textAnchor="end">{compact(t)}</text>
          ))}
          <text x={pad.left} y={h - 6}>{shortDay(labels[0]?.key)}</text>
          <text x={w - pad.right} y={h - 6} textAnchor="end">{shortDay(labels.at(-1)?.key)}</text>
        </g>

        {model.lines.map((s, si) => (
          <path
            key={s.name}
            className="viz__line"
            stroke={s.color || SERIES[si % SERIES.length]}
            vectorEffect="non-scaling-stroke"
            d={s.points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(Number(p.value) || 0).toFixed(2)}`).join(' ')}
          />
        ))}

        {hover !== null && (
          <>
            <line className="viz__crosshair" x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} />
            {model.lines.map((s, si) => {
              const p = s.points[hover]
              if (!p) return null
              return (
                <circle
                  key={s.name}
                  className="viz__marker"
                  cx={x(hover)}
                  cy={y(Number(p.value) || 0)}
                  r={4}
                  fill={s.color || SERIES[si % SERIES.length]}
                />
              )
            })}
          </>
        )}
      </svg>

      {hover !== null && (
        <div className="viz__tip" style={{ left: `${(x(hover) / w) * 100}%`, top: `${(y(model.lines[0].points[hover]?.value || 0) / h) * 100}%` }}>
          <div className="viz__tip-label">{formatDate(labels[hover]?.key, { weekday: 'short' })}</div>
          {model.lines.map((s, si) => (
            <div key={s.name} className="row" style={{ gap: 6 }}>
              <span className="legend__swatch" style={{ background: s.color || SERIES[si % SERIES.length] }} />
              <span className="viz__tip-value">{format(s.points[hover]?.value ?? 0, s.unit || unit)}</span>
              {model.lines.length > 1 && <span className="muted">{s.name}</span>}
            </div>
          ))}
        </div>
      )}

      {showLegend && model.lines.length > 1 && (
        <div className="legend" style={{ marginTop: 8 }}>
          {model.lines.map((s, si) => (
            <span key={s.name} className="legend__item">
              <span className="legend__swatch" style={{ background: s.color || SERIES[si % SERIES.length] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- bar chart

export function BarChart({ points, height = 160, unit = '', color = SERIES[0], onSelect }) {
  const [hover, setHover] = useState(null)
  const pad = { top: 8, right: 4, bottom: 18, left: 34 }
  const w = 640
  const h = height

  if (!points?.length) return <Empty height={height} />

  const max = nice(Math.max(1, ...points.map((p) => Number(p.value) || 0)))
  const innerW = w - pad.left - pad.right
  const innerH = h - pad.top - pad.bottom
  const slot = innerW / points.length
  const barW = Math.max(2, Math.min(24, slot - 2))
  const y = (v) => pad.top + innerH - (v / max) * innerH

  return (
    <div className="viz">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" onMouseLeave={() => setHover(null)}>
        <g className="viz__grid">
          {[0, 0.5, 1].map((t) => <line key={t} x1={pad.left} x2={w - pad.right} y1={y(t * max)} y2={y(t * max)} />)}
        </g>
        <g className="viz__tick">
          {[0, max].map((t) => <text key={t} x={pad.left - 6} y={y(t) + 3} textAnchor="end">{compact(t)}</text>)}
          <text x={pad.left} y={h - 4}>{shortDay(points[0]?.key)}</text>
          <text x={w - pad.right} y={h - 4} textAnchor="end">{shortDay(points.at(-1)?.key)}</text>
        </g>
        {points.map((p, i) => {
          const value = Number(p.value) || 0
          const top = y(value)
          const barH = Math.max(value > 0 ? 2 : 0, pad.top + innerH - top)
          return (
            <g key={p.key || i} onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(p)}>
              <rect className="viz__hit" x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} />
              <rect
                className="viz__bar"
                x={pad.left + i * slot + (slot - barW) / 2}
                y={pad.top + innerH - barH}
                width={barW}
                height={barH}
                rx={Math.min(4, barW / 2)}
                fill={color}
                opacity={hover === null || hover === i ? 1 : 0.5}
              />
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <div
          className="viz__tip"
          style={{ left: `${((pad.left + hover * slot + slot / 2) / w) * 100}%`, top: `${(y(Number(points[hover].value) || 0) / h) * 100}%` }}
        >
          <div className="viz__tip-label">{formatDate(points[hover].key, { weekday: 'short' })}</div>
          <div className="viz__tip-value">{format(points[hover].value, unit)}</div>
        </div>
      )}
    </div>
  )
}

// ----------------------------------------------------------- ranked bars

export function HBars({ rows, unit = '', max, colorBy }) {
  if (!rows?.length) return <div className="empty"><span>Nothing to rank yet</span></div>
  const top = max ?? Math.max(...rows.map((r) => r.value))
  return (
    <div className="hbar">
      {rows.map((row, i) => (
        <div className="hbar__row" key={row.label}>
          <span className="hbar__label" title={row.label}>{row.label}</span>
          <span className="hbar__track">
            <span
              className="hbar__fill"
              style={{
                width: `${Math.max(2, (row.value / (top || 1)) * 100)}%`,
                background: colorBy ? colorBy(row, i) : SERIES[i % SERIES.length],
              }}
            />
          </span>
          <span className="hbar__value">{format(row.value, unit)}</span>
        </div>
      ))}
    </div>
  )
}

// --------------------------------------------------------------- heatmap

export function Heatmap({ points, unit = '' }) {
  if (!points?.length) return <Empty height={80} />
  const max = Math.max(...points.map((p) => Number(p.value) || 0), 1)
  const weeks = []
  for (let i = 0; i < points.length; i += 7) weeks.push(points.slice(i, i + 7))
  return (
    <div className="heat">
      {weeks.map((week, wi) => (
        <div className="heat__week" key={wi}>
          {week.map((p) => {
            const value = Number(p.value) || 0
            const level = value === 0 ? 0 : Math.min(4, Math.ceil((value / max) * 4))
            return (
              <span
                key={p.key}
                className="heat__cell"
                data-level={level}
                title={`${p.key}: ${format(value, unit)}`}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------- stat tile

export function StatTile({ label, value, unit = '', delta, goal = 'up', points, hero, footnote }) {
  // A delta that rounds to zero is noise, and a metric with no declared
  // direction gets a neutral colour rather than a guess at good or bad.
  const shown = Number.isFinite(delta) && Math.abs(Math.round(delta * 100)) >= 1 ? delta : null
  const tone = shown === null || goal === 'neutral' ? 'neutral' : (goal === 'down' ? shown < 0 : shown > 0) ? 'good' : 'bad'
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className={`stat__value${hero ? ' stat__value--hero' : ''}`}>{format(value, unit)}</span>
      <span className="stat__foot">
        {shown !== null && (
          <span className={`stat__delta stat__delta--${tone}`}>
            {shown > 0 ? '+' : ''}{Math.round(shown * 100)}%
          </span>
        )}
        {footnote && <span>{footnote}</span>}
      </span>
      {points?.length > 1 && <div style={{ marginTop: 6 }}><Sparkline points={points} /></div>}
    </div>
  )
}

const Empty = ({ height }) => (
  <div className="empty" style={{ height, padding: 0 }}>
    <span className="muted">Not enough data yet</span>
  </div>
)

const shortDay = (key) => (key ? formatDate(key) : '')
