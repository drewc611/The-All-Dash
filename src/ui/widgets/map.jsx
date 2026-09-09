import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { defineWidget } from '../../core/registry.js'
import { q } from '../../core/query.js'
import { addDays, startOfWeek, dayKey } from '../../core/time.js'
import { Empty } from '../components.jsx'
import { HBars, SERIES } from '../viz/charts.jsx'

/**
 * Shape widgets: how the work hangs together, who carries it, and who is
 * ahead. Drawn with HTML and one SVG overlay rather than a graph library:
 * the nodes are ordinary buttons, so they stay clickable, focusable and
 * readable by a screen reader, and the lines are recomputed from their real
 * positions after layout.
 */

defineWidget({
  id: 'relationship-map',
  name: 'Relationship map',
  description: 'Documents on the left, the work they produced in the middle, the people carrying it on the right. Hover to trace a thread.',
  category: 'Project',
  size: 'xl',
  options: [
    { key: 'limit', label: 'Items', type: 'number', min: 6, max: 60, default: 24 },
    { key: 'scope', label: 'Show', type: 'select', choices: [
      { value: 'open', label: 'Open work only' }, { value: 'all', label: 'Everything recent' },
    ] },
  ],
  render: ({ entityList, onOpen, config }) => {
    const model = useMemo(() => buildMap(entityList, config), [entityList, config.limit, config.scope])
    if (!model.items.length) return <Empty title="Nothing to map yet" hint="Import notes or a task list and the threads appear." />
    return <MapCanvas model={model} onOpen={onOpen} />
  },
})

function buildMap(entityList, config) {
  const limit = config.limit || 24
  let scope = q(entityList).type('task', 'milestone', 'risk', 'decision')
  if (config.scope !== 'all') scope = scope.where((e) => e.type === 'decision' || ['open', 'doing', 'blocked'].includes(e.status))
  const items = scope
    .all()
    .map((e) => ({ e, score: (e.type === 'task' ? 3 : 2) + (e.due ? 2 : 0) + e.priority + (e.people.length ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, limit)
    .map((r) => r.e)

  const docsById = new Map(entityList.filter((e) => e.type === 'doc').map((d) => [d.id, d]))
  const docCounts = new Map()
  const peopleCounts = new Map()
  for (const e of items) {
    if (e.source?.docId && docsById.has(e.source.docId)) docCounts.set(e.source.docId, (docCounts.get(e.source.docId) || 0) + 1)
    for (const p of e.people) peopleCounts.set(p, (peopleCounts.get(p) || 0) + 1)
  }
  const docs = [...docCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => docsById.get(id))
  const people = [...peopleCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name)
  const docSet = new Set(docs.map((d) => d.id))
  const peopleSet = new Set(people)

  const edges = []
  for (const e of items) {
    if (docSet.has(e.source?.docId)) edges.push({ from: `d:${e.source.docId}`, to: `i:${e.id}` })
    for (const p of e.people) if (peopleSet.has(p)) edges.push({ from: `i:${e.id}`, to: `p:${p}` })
  }
  return { docs, items, people, edges }
}

function MapCanvas({ model, onOpen }) {
  const container = useRef(null)
  const nodes = useRef(new Map())
  const [lines, setLines] = useState([])
  const [hover, setHover] = useState(null)

  useLayoutEffect(() => {
    const measure = () => {
      const box = container.current?.getBoundingClientRect()
      if (!box) return
      const centre = (key, side) => {
        const el = nodes.current.get(key)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: (side === 'right' ? r.right : r.left) - box.left, y: r.top + r.height / 2 - box.top }
      }
      setLines(
        model.edges
          .map((edge) => {
            const a = centre(edge.from, 'right')
            const b = centre(edge.to, 'left')
            return a && b ? { ...edge, a, b } : null
          })
          .filter(Boolean)
      )
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro && container.current) ro.observe(container.current)
    return () => ro?.disconnect()
  }, [model])

  const linked = useMemo(() => {
    if (!hover) return null
    const set = new Set([hover])
    for (const e of model.edges) {
      if (e.from === hover) set.add(e.to)
      if (e.to === hover) set.add(e.from)
    }
    return set
  }, [hover, model])

  const register = (key) => (el) => { if (el) nodes.current.set(key, el); else nodes.current.delete(key) }
  const dim = (key) => (linked && !linked.has(key) ? ' map__node--dim' : '')

  return (
    <div className="map" ref={container}>
      <svg className="map__lines" aria-hidden="true">
        {lines.map((l, i) => {
          const mid = (l.a.x + l.b.x) / 2
          const active = linked ? linked.has(l.from) && linked.has(l.to) : false
          return (
            <path
              key={i}
              d={`M${l.a.x},${l.a.y} C${mid},${l.a.y} ${mid},${l.b.y} ${l.b.x},${l.b.y}`}
              className={`map__edge${active ? ' map__edge--active' : ''}${linked && !active ? ' map__edge--dim' : ''}`}
            />
          )
        })}
      </svg>
      <div className="map__col">
        <span className="field__label">Documents</span>
        {model.docs.map((d) => (
          <button key={d.id} ref={register(`d:${d.id}`)} className={`map__node map__node--doc${dim(`d:${d.id}`)}`} onMouseEnter={() => setHover(`d:${d.id}`)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(`d:${d.id}`)} onBlur={() => setHover(null)} onClick={() => onOpen?.(d)} title={d.title}>
            <span className="truncate">{d.title}</span>
          </button>
        ))}
        {!model.docs.length && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>Added by hand</span>}
      </div>
      <div className="map__col map__col--items">
        <span className="field__label">Work</span>
        {model.items.map((e) => (
          <button key={e.id} ref={register(`i:${e.id}`)} className={`map__node map__node--${e.type}${e.status === 'blocked' ? ' map__node--blocked' : ''}${dim(`i:${e.id}`)}`} onMouseEnter={() => setHover(`i:${e.id}`)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(`i:${e.id}`)} onBlur={() => setHover(null)} onClick={() => onOpen?.(e)} title={`${e.type}: ${e.title}`}>
            <span className="truncate">{e.title}</span>
          </button>
        ))}
      </div>
      <div className="map__col">
        <span className="field__label">People</span>
        {model.people.map((p) => (
          <button key={p} ref={register(`p:${p}`)} className={`map__node map__node--person${dim(`p:${p}`)}`} onMouseEnter={() => setHover(`p:${p}`)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(`p:${p}`)} onBlur={() => setHover(null)} onClick={() => onOpen?.(model.items.find((e) => e.people.includes(p)))} title={p}>
            <span className="truncate">{p}</span>
          </button>
        ))}
        {!model.people.length && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>Nobody assigned</span>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ load heatmap

defineWidget({
  id: 'load-heatmap',
  name: 'Load by person and week',
  description: 'Open tasks per person across the coming weeks, shaded by count, with overdue and undated columns at the edges.',
  category: 'Analytics',
  size: 'lg',
  options: [{ key: 'weeks', label: 'Weeks ahead', type: 'number', min: 2, max: 12, default: 6 }],
  render: ({ entityList, onOpen, config }) => {
    const weeks = config.weeks || 6
    const grid = useMemo(() => buildLoad(entityList, weeks), [entityList, weeks])
    if (!grid.rows.length) return <Empty title="No open work to lay out" />
    return (
      <div className="table-wrap">
        <table className="heat-table">
          <thead>
            <tr>
              <th />
              {grid.columns.map((c) => <th key={c.key} title={c.title}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.name}>
                <th scope="row" className="truncate" title={row.name}>{row.name}</th>
                {row.cells.map((cell, ci) => (
                  <td key={ci}>
                    <button
                      type="button"
                      className="heat-table__cell"
                      data-level={cell.level}
                      data-overdue={grid.columns[ci].key === 'overdue' && cell.count > 0 ? 'true' : undefined}
                      disabled={!cell.count}
                      title={cell.count ? `${cell.count} ${cell.count === 1 ? 'task' : 'tasks'}: ${cell.rows.map((t) => t.title).slice(0, 3).join(', ')}` : ''}
                      aria-label={`${row.name}, ${grid.columns[ci].title}: ${cell.count}`}
                      onClick={() => cell.rows[0] && onOpen?.(cell.rows[0])}
                    >
                      {cell.count || ''}
                    </button>
                  </td>
                ))}
                <td className="heat-table__total tabular">{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  },
})

function buildLoad(entityList, weeks) {
  const now = new Date()
  const week0 = startOfWeek(now)
  const open = q(entityList).type('task').open().all()
  const columns = [
    { key: 'overdue', label: 'Late', title: 'Overdue' },
    ...Array.from({ length: weeks }, (_, i) => {
      const start = addDays(week0, i * 7)
      return { key: dayKey(start), label: i === 0 ? 'This wk' : i === 1 ? 'Next' : `+${i}`, title: `Week of ${dayKey(start)}`, start, end: addDays(start, 7) }
    }),
    { key: 'undated', label: 'No date', title: 'No due date' },
  ]
  const bucket = (t) => {
    if (!t.due) return 'undated'
    const d = new Date(t.due)
    if (d < now) return 'overdue'
    const col = columns.find((c) => c.start && d >= c.start && d < c.end)
    return col ? col.key : null
  }
  const byPerson = new Map()
  for (const t of open) {
    const names = t.people.length ? t.people : ['Unassigned']
    for (const name of names) {
      if (!byPerson.has(name)) byPerson.set(name, [])
      byPerson.get(name).push(t)
    }
  }
  let max = 1
  const rows = [...byPerson.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10)
    .map(([name, tasks]) => {
      const cells = columns.map((c) => ({ count: 0, rows: [] }))
      for (const t of tasks) {
        const key = bucket(t)
        const i = columns.findIndex((c) => c.key === key)
        if (i >= 0) { cells[i].count++; cells[i].rows.push(t) }
      }
      for (const c of cells) max = Math.max(max, c.count)
      return { name, cells, total: tasks.length }
    })
  for (const row of rows) for (const c of row.cells) c.level = c.count ? Math.min(4, Math.ceil((c.count / max) * 4)) : 0
  return { columns, rows }
}

// ------------------------------------------------------------- leaderboard

defineWidget({
  id: 'leaderboard',
  name: 'Leaderboard',
  description: 'People ranked by what they closed, what they carry, what is late on them, or how much of their week is meetings.',
  category: 'Analytics',
  size: 'md',
  options: [
    { key: 'by', label: 'Rank by', type: 'select', choices: [
      { value: 'closed', label: 'Closed in window' }, { value: 'open', label: 'Open work' },
      { value: 'overdue', label: 'Overdue' }, { value: 'meetings', label: 'Meeting hours in window' },
    ] },
  ],
  render: ({ entityList, range, config }) => {
    const by = config.by || 'closed'
    const rows = useMemo(() => rank(entityList, range, by), [entityList, range, by])
    if (!rows.length) return <Empty title="Nobody to rank yet" hint="Assign owners with @name and this fills in." />
    return (
      <HBars
        rows={rows}
        unit={by === 'meetings' ? 'h' : ''}
        colorBy={(row, i) => (by === 'overdue' ? 'var(--critical)' : row.label === 'Unassigned' ? 'var(--ink-muted)' : SERIES[i % SERIES.length])}
      />
    )
  },
})

function rank(entityList, range, by) {
  const now = new Date()
  let scope
  if (by === 'closed') scope = q(entityList).type('task').status('done').between(range.from, range.to, 'updatedAt')
  else if (by === 'open') scope = q(entityList).type('task').open()
  else if (by === 'overdue') scope = q(entityList).type('task').open().due({ before: now })
  else scope = q(entityList).type('event').between(range.from, range.to, 'at').where((e) => e.status !== 'cancelled')
  const groups = scope.groupBy((e) => (e.people.length ? e.people : by === 'meetings' ? [] : ['Unassigned']))
  return [...groups.entries()]
    .map(([label, list]) => ({
      label,
      value: by === 'meetings'
        ? Math.round(list.reduce((a, e) => a + (e.meta?.allDay ? 0 : e.end ? (new Date(e.end) - new Date(e.at)) / 3600000 : 0.5), 0) * 10) / 10
        : list.length,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
}
