import { cellValue, labelOf, typeOf } from '../../work/columns.js'
import { topLevel } from '../../work/schema.js'
import { updateView } from '../../work/store.js'
import { HBars } from '../viz/charts.jsx'
import { Empty } from '../components.jsx'
import { format } from '../../core/format.js'

const REDUCERS = { count: 'Count', sum: 'Sum', avg: 'Average' }

/** One breakdown: pick what to split by, what to add up, and how. */
export function ChartView({ board, view, items }) {
  const dimension = board.columns.find((c) => c.id === view.config.dimension)
    || board.columns.find((c) => c.kind === 'status')
    || board.columns[0]
  const measure = board.columns.find((c) => c.id === view.config.measure)
  const reduce = view.config.reduce && REDUCERS[view.config.reduce] ? view.config.reduce : measure ? 'sum' : 'count'
  const rows = topLevel(items)

  const buckets = new Map()
  for (const item of rows) {
    const raw = dimension ? cellValue(item, dimension, board) : null
    const keys = Array.isArray(raw) ? (raw.length ? raw : ['']) : [raw]
    for (const key of keys) {
      const label = labelOf(dimension, key)
      const name = label?.text || (dimension ? typeOf(dimension).toText(key, dimension) : '') || 'Not set'
      if (!buckets.has(name)) buckets.set(name, { name, tone: label?.tone, values: [] })
      buckets.get(name).values.push(measure ? Number(cellValue(item, measure, board)) || 0 : 1)
    }
  }

  const data = [...buckets.values()].map((bucket) => ({
    label: bucket.name,
    tone: bucket.tone,
    value: reduce === 'count' ? bucket.values.length
      : reduce === 'avg' ? round(bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length)
        : round(bucket.values.reduce((a, b) => a + b, 0)),
  })).sort((a, b) => b.value - a.value)

  const unit = reduce === 'count' ? '' : measure?.unit || ''

  return (
    <div className="wchart stack">
      <div className="row row--wrap">
        <label className="field">
          <span className="field__label">Split by</span>
          <select className="select" value={dimension?.id || ''} onChange={(e) => updateView(board.id, view.id, { config: { dimension: e.target.value } })}>
            {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Measure</span>
          <select className="select" value={measure?.id || ''} onChange={(e) => updateView(board.id, view.id, { config: { measure: e.target.value, reduce: e.target.value ? 'sum' : 'count' } })}>
            <option value="">Number of items</option>
            {board.columns.filter((c) => ['number', 'rating', 'progress', 'formula'].includes(c.kind)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Reduce</span>
          <select className="select" value={reduce} disabled={!measure} onChange={(e) => updateView(board.id, view.id, { config: { reduce: e.target.value } })}>
            {Object.entries(REDUCERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {data.length ? (
        <>
          <HBars rows={data.map((d) => ({ label: d.label, value: d.value }))} unit={unit} />
          <div className="row row--wrap" style={{ gap: 'var(--gap-2)' }}>
            {data.slice(0, 8).map((d) => (
              <span key={d.label} className={`chip${d.tone && d.tone !== 'neutral' ? ` chip--${d.tone}` : ''}`}>
                {d.label} <strong className="tabular">{format(d.value, unit)}</strong>
              </span>
            ))}
          </div>
        </>
      ) : <Empty title="No rows to chart" hint="Add items to the board and this fills in." />}
    </div>
  )
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)
