import { cellValue } from '../../work/columns.js'
import { pickColumn, topLevel } from '../../work/schema.js'
import { updateView } from '../../work/store.js'
import { addDays, dayKey, formatDate, startOfWeek } from '../../core/time.js'
import { Empty } from '../components.jsx'

/**
 * Who is carrying what, by week.
 *
 * Effort is either a count of items or a number column you pick; capacity is
 * one number per person per week. A cell over capacity turns red, which is the
 * only thing anyone actually looks at this view for.
 */
export function WorkloadView({ board, view, items, weekStartsOn = 1, onOpen }) {
  const person = pickColumn(board, 'person', view.config.personColumn)
  const timeline = pickColumn(board, 'timeline', view.config.timelineColumn)
  const dateColumn = pickColumn(board, 'date', view.config.dateColumn)
  const effort = board.columns.find((c) => c.id === view.config.effortColumn && ['number', 'rating', 'progress', 'formula'].includes(c.kind))
  const capacity = Number(view.config.capacity) || 5
  const weeks = Number(view.config.weeks) || 8

  const start = startOfWeek(new Date(), weekStartsOn)
  const columns = Array.from({ length: weeks }, (_, i) => addDays(start, i * 7))

  const rows = new Map()
  for (const item of topLevel(items)) {
    if (item.status === 'done' || item.status === 'cancelled') continue
    const range = timeline ? cellValue(item, timeline, board) : null
    const from = range?.from || item.at || (dateColumn ? cellValue(item, dateColumn, board) : item.due)
    const to = range?.to || item.end || from
    if (!from) continue
    const load = effort ? Number(cellValue(item, effort, board)) || 0 : 1
    const owners = (person ? cellValue(item, person, board) : item.people) || []
    const names = owners.length ? owners : ['Unassigned']
    const spanWeeks = columns.filter((week) => overlaps(from, to, week, addDays(week, 7)))
    const share = spanWeeks.length ? load / spanWeeks.length : 0
    for (const name of names) {
      if (!rows.has(name)) rows.set(name, { name, cells: new Map() })
      const cells = rows.get(name).cells
      for (const week of spanWeeks) {
        const key = dayKey(week)
        const cell = cells.get(key) || { load: 0, items: [] }
        cell.load += share / names.length
        cell.items.push(item)
        cells.set(key, cell)
      }
    }
  }

  const people = [...rows.values()].sort((a, b) => b.cells.size - a.cells.size)

  return (
    <div className="wworkload stack">
      <div className="row row--wrap">
        <label className="field">
          <span className="field__label">Effort</span>
          <select className="select" value={effort?.id || ''} onChange={(e) => updateView(board.id, view.id, { config: { effortColumn: e.target.value } })}>
            <option value="">One per item</option>
            {board.columns.filter((c) => ['number', 'rating', 'progress', 'formula'].includes(c.kind)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Capacity a week</span>
          <input
            className="input" type="number" min="1" max="200" value={capacity} style={{ width: 90 }}
            onChange={(e) => updateView(board.id, view.id, { config: { capacity: Number(e.target.value) || 1 } })}
          />
        </label>
        <label className="field">
          <span className="field__label">Weeks</span>
          <input
            className="input" type="number" min="2" max="26" value={weeks} style={{ width: 90 }}
            onChange={(e) => updateView(board.id, view.id, { config: { weeks: Number(e.target.value) || 8 } })}
          />
        </label>
      </div>

      {people.length === 0 ? (
        <Empty title="Nothing scheduled" hint="Items need an owner and a date before they show a load." />
      ) : (
        <div className="table-wrap">
          <table className="table wload">
            <thead>
              <tr>
                <th scope="col">Person</th>
                {columns.map((week) => <th key={dayKey(week)} scope="col" className="tabular">{formatDate(week)}</th>)}
              </tr>
            </thead>
            <tbody>
              {people.map((row) => (
                <tr key={row.name}>
                  <th scope="row" className="truncate">{row.name}</th>
                  {columns.map((week) => {
                    const cell = row.cells.get(dayKey(week))
                    const load = cell ? Math.round(cell.load * 10) / 10 : 0
                    const ratio = load / capacity
                    const tone = ratio > 1 ? 'critical' : ratio > 0.8 ? 'warning' : ratio > 0 ? 'good' : 'none'
                    return (
                      <td key={dayKey(week)} className={`wload__cell tone--${tone}`}>
                        {load > 0 && (
                          <button
                            type="button"
                            className="wload__pill"
                            title={cell.items.map((i) => i.title).join('\n')}
                            onClick={() => onOpen(cell.items[0])}
                          >
                            <span className="tabular">{load}</span>
                            <span className="wload__bar" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const overlaps = (from, to, weekStart, weekEnd) => {
  const a = new Date(from).getTime()
  const b = new Date(to || from).getTime()
  return a < weekEnd.getTime() && b >= weekStart.getTime()
}
