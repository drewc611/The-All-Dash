import { useMemo, useState } from 'react'
import { defineWidget } from '../../core/registry.js'
import { q, daily, movingAverage, momentum } from '../../core/query.js'
import { availableMetrics, evaluate } from '../../engine/metrics.js'
import { buildInsights } from '../../engine/insights.js'
import { format } from '../../core/format.js'
import { formatDate } from '../../core/time.js'
import { LineChart, BarChart, HBars, Heatmap, StatTile, SERIES } from '../viz/charts.jsx'
import { Empty } from '../components.jsx'
import { STATUS_ICON } from '../icons.jsx'

/** Everything that turns the pile of entities into a number or a shape. */

defineWidget({
  id: 'pulse',
  name: 'Pulse',
  description: 'Four numbers that tell you whether today is under control.',
  category: 'Analytics',
  size: 'sm',
  render: ({ entities, range }) => {
    const cards = ['tasks-open', 'tasks-overdue', 'tasks-completed', 'meeting-load']
      .map((id) => evaluate(id, entities, range))
      .filter(Boolean)
    return (
      <div style={{ display: 'grid', gap: 'var(--gap-4)' }}>
        {cards.map((m) => (
          <StatTile
            key={m.id}
            label={m.name}
            value={m.value}
            unit={m.unit}
            goal={m.goal}
            delta={m.change}
            footnote={m.change !== null && Math.abs(Math.round(m.change * 100)) >= 1 ? 'vs previous window' : undefined}
          />
        ))}
      </div>
    )
  },
})

defineWidget({
  id: 'metric-grid',
  name: 'Metric wall',
  description: 'Every metric available right now, built-in or discovered in your data, as one grid.',
  category: 'Analytics',
  size: 'xl',
  render: ({ entities, range, state }) => {
    const metrics = useMemo(
      () => availableMetrics(entities, state.customMetrics).map((m) => evaluate(m, entities, range)).filter(Boolean),
      [entities, range, state.customMetrics]
    )
    if (!metrics.length) return <Empty title="No metrics yet" hint="Import a spreadsheet and every numeric column becomes one." />
    return (
      <div className="stat-grid" style={{ margin: 'calc(var(--gap-4) * -1)', borderRadius: 0, border: 0 }}>
        {metrics.map((m) => (
          <StatTile
            key={m.id}
            label={m.name}
            value={m.value}
            unit={m.unit}
            goal={m.goal}
            delta={m.change}
            footnote={m.target ? `${Math.round((m.progress || 0) * 100)}% of ${format(m.target, m.unit)}` : undefined}
            points={m.series}
          />
        ))}
      </div>
    )
  },
})

defineWidget({
  id: 'series-explorer',
  name: 'Series explorer',
  description: 'Pick any metric and read it as a line, with a 7-day average laid over the raw daily values.',
  category: 'Analytics',
  size: 'lg',
  options: [{ key: 'metricId', label: 'Metric', type: 'metric' }],
  render: ({ entities, range, state, config, setConfig }) => {
    const metrics = useMemo(() => availableMetrics(entities, state.customMetrics), [entities, state.customMetrics])
    // Default to a metric that actually has a shape, not just the first one
    // registered - a flat line is a poor introduction to the chart.
    const fallback = useMemo(() => {
      const withData = metrics.find((m) => {
        const points = evaluate(m, entities, range)?.series || []
        return points.filter((p) => Number(p.value)).length >= 3
      })
      return withData || metrics[0]
    }, [metrics, entities, range])
    const active = metrics.find((m) => m.id === config.metricId) || fallback
    if (!active) return <Empty title="No metrics to explore" />
    const result = evaluate(active, entities, range)
    const smoothed = movingAverage(result.series, 7)

    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <div className="row row--wrap">
          <select
            className="select"
            style={{ width: 'auto', minWidth: 180 }}
            value={active.id}
            onChange={(e) => setConfig({ metricId: e.target.value })}
            aria-label="Metric"
          >
            {metrics.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <div className="spacer" />
          <div className="stat" style={{ alignItems: 'flex-end' }}>
            <span className="stat__value" style={{ fontSize: 'var(--t-xl)' }}>{format(result.value, result.unit)}</span>
          </div>
        </div>
        <LineChart
          unit={result.unit}
          series={[
            { name: 'Daily', points: result.series, color: SERIES[0] },
            { name: '7-day average', points: smoothed, color: SERIES[1] },
          ]}
        />
        <p className="muted" style={{ fontSize: 'var(--t-xs)', margin: 0 }}>
          {describeTrend(result)}
        </p>
      </div>
    )
  },
})

function describeTrend(result) {
  if (!result.series.length) return 'No data in this window.'
  const parts = []
  if (result.change !== null && Number.isFinite(result.previous)) {
    const pct = Math.round(result.change * 100)
    parts.push(pct === 0 ? 'Level with the previous window.' : `${pct > 0 ? 'Up' : 'Down'} ${Math.abs(pct)}% on the previous window (${format(result.previous, result.unit)}).`)
  }
  const change = result.momentum
  if (Math.abs(change) >= 0.05) {
    parts.push(`Inside the window the second half is ${change > 0 ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))}% on the first.`)
  }
  if (result.projection && result.trend.r2 >= 0.3) {
    parts.push(`Straight-line projection for 7 days out: ${format(result.projection.value, result.unit)} (fit ${Math.round(result.trend.r2 * 100)}%).`)
  }
  if (result.target && result.projection?.daysToTarget !== null && result.projection?.daysToTarget !== undefined) {
    parts.push(`Target ${format(result.target, result.unit)} reached in about ${result.projection.daysToTarget} days at this pace.`)
  }
  return parts.join(' ') || 'Flat across the window.'
}

defineWidget({
  id: 'throughput',
  name: 'Throughput',
  description: 'Tasks finished per day. The shape matters more than any single bar.',
  category: 'Analytics',
  size: 'md',
  render: ({ entityList, range }) => {
    const done = q(entityList).type('task').status('done').between(range.from, range.to, 'updatedAt').all()
    const points = daily(done, { from: range.from, to: range.to, field: 'updatedAt' })
    const total = done.length
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <StatTile label="Closed in window" value={total} delta={momentum(points) || null} />
        <BarChart points={points} height={150} />
      </div>
    )
  },
})

defineWidget({
  id: 'workload',
  name: 'Work by tag',
  description: 'Where open work is concentrated, ranked.',
  category: 'Analytics',
  size: 'md',
  render: ({ entityList }) => {
    const open = q(entityList).type('task').open().all()
    const byTag = q(open).groupBy((e) => (e.tags.length ? e.tags : ['untagged']))
    const rows = [...byTag.entries()]
      .map(([label, list]) => ({ label, value: list.length }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
    if (!rows.length) return <Empty title="No open work to break down" />
    return <HBars rows={rows} />
  },
})

defineWidget({
  id: 'insights',
  name: 'What needs attention',
  description: 'Rules run over everything you have imported. Each finding names its evidence.',
  category: 'Analytics',
  size: 'lg',
  render: ({ entities, range, state, onOpen }) => {
    const insights = useMemo(
      () => buildInsights(entities, range, state.customMetrics),
      [entities, range, state.customMetrics]
    )
    if (!insights.length) {
      return <Empty title="Nothing is shouting" hint="No overdue work, no concentration risk, no metric moving sharply." />
    }
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {insights.map((insight) => {
          const Icon = STATUS_ICON[insight.severity] || STATUS_ICON.info
          return (
            <div key={insight.id} className={`bar-left bar-left--${insight.severity}`}>
              <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                <Icon width={13} height={13} style={{ marginTop: 3, flex: 'none', color: `var(--${insight.severity === 'info' ? 'accent' : insight.severity})` }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 560 }}>{insight.title}</div>
                  <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{insight.detail}</div>
                  {insight.entities?.length > 0 && (
                    <div className="row row--wrap" style={{ marginTop: 6, gap: 4 }}>
                      {insight.entities.slice(0, 4).map((e) => (
                        <button key={e.id} className="chip chip--button truncate" style={{ maxWidth: 220 }} onClick={() => onOpen?.(e)}>
                          {e.title}
                        </button>
                      ))}
                      {insight.entities.length > 4 && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>+{insight.entities.length - 4} more</span>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    )
  },
})

defineWidget({
  id: 'activity-heatmap',
  name: 'Activity heatmap',
  description: 'One cell per day across the window, shaded by how much happened.',
  category: 'Analytics',
  size: 'md',
  render: ({ entityList, range }) => {
    const rows = q(entityList).where((e) => e.type !== 'person' && e.type !== 'doc').all()
    const points = daily(rows, { from: range.from, to: range.to, field: 'createdAt' })
    const busiest = [...points].sort((a, b) => b.value - a.value)[0]
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <Heatmap points={points} />
        <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
          {busiest?.value ? `Busiest day was ${formatDate(busiest.key)} with ${busiest.value} items.` : 'Nothing recorded in this window yet.'}
        </span>
      </div>
    )
  },
})

defineWidget({
  id: 'table-preview',
  name: 'Imported table',
  description: 'The raw rows from a spreadsheet, scrollable, so you can check what was read.',
  category: 'Data',
  size: 'lg',
  options: [{ key: 'tableId', label: 'Table', type: 'table' }],
  render: ({ entityList, config, setConfig }) => {
    const tables = q(entityList).type('note').tagged('table').all().filter((e) => e.meta?.table)
    const [rowLimit, setRowLimit] = useState(12)
    if (!tables.length) return <Empty title="No tables imported" hint="Drop a .csv or .xlsx in and it appears here." />
    const active = tables.find((t) => t.id === config.tableId) || tables[0]
    const { headers, rows, columns } = active.meta.table

    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {tables.length > 1 && (
          <select className="select" value={active.id} onChange={(e) => setConfig({ tableId: e.target.value })} aria-label="Table">
            {tables.map((t) => <option key={t.id} value={t.id}>{t.title.replace('Table: ', '')}</option>)}
          </select>
        )}
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table">
            <thead>
              <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, rowLimit).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, ci) => (
                    <td key={ci} className={columns?.[ci]?.kind === 'number' ? 'num' : ''}>{String(cell ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            Showing {Math.min(rowLimit, rows.length)} of {rows.length} rows
          </span>
          {rows.length > rowLimit && (
            <button className="btn btn--sm" onClick={() => setRowLimit((n) => n + 40)}>Show more</button>
          )}
        </div>
      </div>
    )
  },
})

defineWidget({
  id: 'source-mix',
  name: 'Where it came from',
  description: 'Which documents produced what you are looking at.',
  category: 'Data',
  size: 'sm',
  render: ({ entityList }) => {
    const bySource = q(entityList).where((e) => e.type !== 'doc').groupBy((e) => e.source?.name || 'Unknown')
    const rows = [...bySource.entries()]
      .map(([label, list]) => ({ label, value: list.length }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
    if (!rows.length) return <Empty title="Nothing imported yet" />
    return <HBars rows={rows} />
  },
})
