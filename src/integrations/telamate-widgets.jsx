import { useMemo, useState } from 'react'
import { defineWidget } from '../core/registry.js'
import { relative, formatDate } from '../core/time.js'
import { compact } from '../core/format.js'
import { StatTile, SERIES } from '../ui/viz/charts.jsx'
import { Empty } from '../ui/components.jsx'
import { FLAG, openCallbacks, overdueCallbacks, conversationsToday, channelSeries, CHANNEL_SERIES } from './telamate.js'

/**
 * The three Telamate widgets. Each carries the flag, so the picker and the
 * board hide them together with the feature; the selectors they draw from
 * live in telamate.js so the tests can reach them without JSX.
 */

const CATEGORY = 'Telamate'

defineWidget({
  id: 'telamate-queue',
  name: 'Callbacks due',
  description: 'Open callbacks from the front desk, soonest first, with the overdue ones flagged.',
  category: CATEGORY,
  size: 'md',
  flag: FLAG,
  options: [{ key: 'limit', label: 'Rows', type: 'number', min: 3, max: 30, default: 8 }],
  render: ({ entityList, config, onOpen }) => {
    const rows = useMemo(() => openCallbacks(entityList), [entityList])
    const shown = rows.slice(0, config.limit || 8)
    if (!shown.length) return <Empty title="No callbacks waiting" hint="Every call the front desk could not close has been returned." />
    const now = Date.now()
    return (
      <div className="list" style={{ margin: 'calc(var(--gap-4) * -1)' }}>
        {shown.map((e) => {
          const late = e.due && new Date(e.due).getTime() < now
          return (
            <button key={e.id} type="button" className="list__item list__item--interactive list__open" onClick={() => onOpen?.(e)}>
              <div className="list__main">
                <span className="list__title truncate">{e.title}</span>
                <span className="list__meta">
                  {e.people[0] && <span>{e.people[0]}</span>}
                  {e.meta?.phone && <span className="mono">{e.meta.phone}</span>}
                  {e.tags.filter((t) => t !== 'telamate' && t !== 'callback').map((t) => <span key={t} className="chip">{t}</span>)}
                </span>
              </div>
              <span className="list__side">
                {late && <span className="chip chip--critical">overdue</span>}
                <span title={e.due ? formatDate(e.due, { hour: 'numeric', minute: '2-digit' }) : ''}>{e.due ? relative(e.due) : 'no time'}</span>
              </span>
            </button>
          )
        })}
        {rows.length > shown.length && <div className="list__item muted" style={{ justifyContent: 'center', fontSize: 'var(--t-xs)' }}>{rows.length - shown.length} more</div>}
      </div>
    )
  },
})

defineWidget({
  id: 'telamate-channels',
  name: 'Conversations by channel',
  description: 'The last two weeks of front-desk conversations, one bar per day stacked by chat, SMS, voice and email.',
  category: CATEGORY,
  size: 'md',
  flag: FLAG,
  render: ({ entityList }) => {
    const days = useMemo(() => channelSeries(entityList, { days: 14 }), [entityList])
    if (!days.some((d) => d.total > 0)) return <Empty title="No conversations yet" hint="Import a Telamate export, or set its URL in Settings to pull live." />
    return <StackedBars days={days} />
  },
})

defineWidget({
  id: 'telamate-answered',
  name: 'Front desk today',
  description: 'Open callbacks, how many are overdue, and how many conversations the front desk has had today.',
  category: CATEGORY,
  size: 'sm',
  flag: FLAG,
  render: ({ entityList }) => {
    const open = useMemo(() => openCallbacks(entityList).length, [entityList])
    const late = useMemo(() => overdueCallbacks(entityList).length, [entityList])
    const today = useMemo(() => conversationsToday(entityList), [entityList])
    return (
      <div style={{ display: 'grid', gap: 'var(--gap-4)' }}>
        <StatTile label="Open callbacks" value={open} goal="down" />
        <StatTile label="Overdue" value={late} goal="down" footnote={late ? 'past their due time' : undefined} />
        <StatTile label="Conversations today" value={today} goal="neutral" />
      </div>
    )
  },
})

/**
 * Stacked daily bars. charts.jsx has no stacked variant and a fourteen-day
 * strip does not need axes: a baseline, a max tick, and a legend suffice.
 */
function StackedBars({ days }) {
  const [hover, setHover] = useState(null)
  const w = 640
  const h = 160
  const pad = { top: 8, right: 4, bottom: 18, left: 30 }
  const innerW = w - pad.left - pad.right
  const innerH = h - pad.top - pad.bottom
  const max = Math.max(1, ...days.map((d) => d.total))
  const slot = innerW / days.length
  const barW = Math.max(4, Math.min(28, slot - 6))
  const y = (v) => pad.top + innerH - (v / max) * innerH
  return (
    <div className="stack" style={{ gap: 'var(--gap-2)' }}>
      <div className="viz">
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Conversations per day by channel" onMouseLeave={() => setHover(null)}>
          <g className="viz__grid">
            {[0, 0.5, 1].map((t) => <line key={t} x1={pad.left} x2={w - pad.right} y1={y(t * max)} y2={y(t * max)} />)}
          </g>
          <g className="viz__tick">
            {[0, max].map((t) => <text key={t} x={pad.left - 6} y={y(t) + 3} textAnchor="end">{compact(t)}</text>)}
            <text x={pad.left} y={h - 4}>{formatDate(days[0].key)}</text>
            <text x={w - pad.right} y={h - 4} textAnchor="end">{formatDate(days.at(-1).key)}</text>
          </g>
          {days.map((d, i) => {
            let acc = 0
            const x = pad.left + i * slot + (slot - barW) / 2
            return (
              <g key={d.key} onMouseEnter={() => setHover(i)}>
                <rect className="viz__hit" x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} />
                {d.values.map((v, s) => {
                  if (!v.value) return null
                  const top = y(acc + v.value)
                  const bottom = y(acc)
                  acc += v.value
                  return <rect key={v.name} className="viz__bar" x={x} y={top} width={barW} height={Math.max(1, bottom - top)} fill={SERIES[s]} opacity={hover === null || hover === i ? 1 : 0.5} />
                })}
              </g>
            )
          })}
        </svg>
        {hover !== null && (
          <div className="viz__tip" style={{ left: `${((pad.left + hover * slot + slot / 2) / w) * 100}%`, top: `${(y(days[hover].total) / h) * 100}%` }}>
            <div className="viz__tip-label">{formatDate(days[hover].key, { weekday: 'short' })}</div>
            <div className="viz__tip-value">{days[hover].total} · {days[hover].values.filter((v) => v.value).map((v) => `${v.name.replace('Telamate ', '')} ${v.value}`).join(', ')}</div>
          </div>
        )}
      </div>
      <div className="row row--wrap" style={{ gap: 'var(--gap-3)', fontSize: 'var(--t-xs)' }}>
        {CHANNEL_SERIES.map((name, s) => (
          <span key={name} className="row" style={{ gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: SERIES[s], display: 'inline-block' }} />
            {name.replace('Telamate ', '')}
          </span>
        ))}
      </div>
    </div>
  )
}
