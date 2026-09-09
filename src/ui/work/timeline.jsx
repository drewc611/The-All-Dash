import { useMemo, useState } from 'react'
import { cellValue, labelOf } from '../../work/columns.js'
import { pickColumn, topLevel } from '../../work/schema.js'
import { setItemFields } from '../../work/store.js'
import { addDays, formatDate, startOfDay } from '../../core/time.js'
import { Empty } from '../components.jsx'

/**
 * A Gantt chart that is honest about what it knows.
 *
 * A row needs a start and an end - a timeline column, or a single date, which
 * draws a one-day marker. Dependencies drawn as elbows are the point of the
 * view: you can see that the second thing cannot start until the first ends.
 */

const DAY = 86400000
const ROW = 34
const SCALE = 26

export function TimelineView({ board, view, items, onOpen }) {
  const [zoom, setZoom] = useState(view.config.zoom || 'weeks')
  const timeline = pickColumn(board, 'timeline', view.config.timelineColumn)
  const dateColumn = pickColumn(board, 'date', view.config.dateColumn)
  const colorBy = board.columns.find((c) => c.id === view.config.colorBy) || board.columns.find((c) => c.kind === 'status')
  const dependency = board.columns.find((c) => c.kind === 'dependency')

  const rows = useMemo(() => topLevel(items).map((item) => {
    const range = timeline ? cellValue(item, timeline, board) : null
    const single = dateColumn ? cellValue(item, dateColumn, board) : item.due
    const from = range?.from || item.at || single
    const to = range?.to || item.end || single
    if (!from) return null
    return { item, from: startOfDay(from).getTime(), to: startOfDay(to || from).getTime() }
  }).filter(Boolean).sort((a, b) => a.from - b.from), [items, board, timeline, dateColumn])

  if (!rows.length) {
    return <Empty title="Nothing has dates yet" hint={`Give a ${board.itemNoun.toLowerCase()} a timeline or a date and it draws here.`} />
  }

  const min = Math.min(...rows.map((r) => r.from))
  const max = Math.max(...rows.map((r) => r.to))
  const pad = zoom === 'days' ? 1 : zoom === 'weeks' ? 3 : 10
  const start = startOfDay(min - pad * DAY).getTime()
  const end = startOfDay(max + pad * DAY).getTime()
  const span = Math.max(1, Math.round((end - start) / DAY))
  const pxPerDay = zoom === 'days' ? 44 : zoom === 'weeks' ? 14 : 4
  const width = span * pxPerDay
  const x = (time) => ((startOfDay(time).getTime() - start) / DAY) * pxPerDay
  const today = x(Date.now())
  const index = new Map(rows.map((r, i) => [r.item.id, i]))

  return (
    <div className="wgantt">
      <div className="wgantt__tools">
        <span className="muted">{formatDate(start)} – {formatDate(end)}</span>
        <div className="segmented" role="group" aria-label="Zoom">
          {['days', 'weeks', 'months'].map((z) => (
            <button key={z} type="button" aria-pressed={z === zoom} onClick={() => setZoom(z)}>{z}</button>
          ))}
        </div>
      </div>
      <div className="wgantt__scroll">
        <div className="wgantt__names">
          <div className="wgantt__tick" />
          {rows.map(({ item }) => (
            <button key={item.id} type="button" className="wgantt__name truncate" onClick={() => onOpen(item)} title={item.title}>
              {item.title}
            </button>
          ))}
        </div>
        <div className="wgantt__chart" style={{ width }}>
          <div className="wgantt__scale">
            {ticks(start, end, zoom).map((tick) => (
              <span key={tick.at} className="wgantt__tickmark" style={{ left: x(tick.at) }}>{tick.label}</span>
            ))}
          </div>
          {today >= 0 && today <= width && <span className="wgantt__today" style={{ left: today }} aria-hidden="true" />}

          {dependency && (
            <svg className="wgantt__links" width={width} height={rows.length * ROW} aria-hidden="true">
              {rows.flatMap(({ item }, row) => (cellValue(item, dependency, board) || []).map((id) => {
                const fromRow = index.get(id)
                if (fromRow === undefined) return null
                const source = rows[fromRow]
                const target = rows[row]
                const x1 = x(source.to) + pxPerDay
                const y1 = fromRow * ROW + ROW / 2
                const x2 = x(target.from)
                const y2 = row * ROW + ROW / 2
                const mid = Math.max(x1 + 6, x2 - 10)
                return (
                  <path key={`${id}-${item.id}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} className="wgantt__link" />
                )
              }))}
            </svg>
          )}

          {rows.map(({ item, from, to }, row) => {
            const label = colorBy ? labelOf(colorBy, cellValue(item, colorBy, board)) : null
            const left = x(from)
            const barWidth = Math.max(pxPerDay, x(to) + pxPerDay - left)
            return (
              <button
                key={item.id}
                type="button"
                className={`wgantt__bar tone--${label?.tone || 'accent'}${item.status === 'done' ? ' is-done' : ''}`}
                style={{ left, width: barWidth, top: SCALE + row * ROW + 4 }}
                title={`${item.title}: ${formatDate(from)} – ${formatDate(to)}`}
                onClick={() => onOpen(item)}
                onDoubleClick={() => setItemFields(item.id, { at: new Date(from + DAY).toISOString(), end: new Date(to + DAY).toISOString() })}
              >
                <span className="truncate">{item.title}</span>
              </button>
            )
          })}
        </div>
      </div>
      <p className="muted wgantt__hint">
        Double-click a bar to push it a day. {dependency ? 'Lines follow the dependency column.' : 'Add a dependency column to draw links.'}
      </p>
    </div>
  )
}

function ticks(start, end, zoom) {
  const out = []
  const step = zoom === 'days' ? 1 : zoom === 'weeks' ? 7 : 30
  for (let at = start; at <= end; at = addDays(at, step).getTime()) {
    out.push({ at, label: zoom === 'months' ? formatDate(at, { day: undefined, month: 'short', year: '2-digit' }) : formatDate(at) })
  }
  return out
}
