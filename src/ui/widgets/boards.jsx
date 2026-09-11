import { useMemo } from 'react'
import { defineWidget } from '../../core/registry.js'
import { Empty } from '../components.jsx'
import { cellValue, labelOf } from '../../work/columns.js'
import { groupItems } from '../../work/query.js'
import { topLevel } from '../../work/schema.js'
import { boardsOf, itemsOf } from '../../work/store.js'
import { formatDate } from '../../core/time.js'

/** Everything assigned to one person, across every board. */
defineWidget({
  id: 'my-work',
  name: 'My work',
  description: 'Board items assigned to you, whichever board they live on, soonest first.',
  category: 'Day',
  size: 'md',
  options: [
    { key: 'who', label: 'Person', type: 'text' },
    { key: 'limit', label: 'Rows', type: 'number', min: 3, max: 20, default: 8 },
  ],
  render: ({ state, config, navigate }) => {
    const who = (config.who || state.work?.me || '').trim().toLowerCase()
    const rows = useMemo(() => {
      const out = []
      for (const board of boardsOf(state)) {
        for (const item of itemsOf(state, board.id)) {
          if (item.status === 'done' || item.status === 'cancelled') continue
          const owners = (item.people || []).map((p) => p.toLowerCase())
          if (who && !owners.includes(who)) continue
          if (!who && owners.length) continue
          out.push({ item, board })
        }
      }
      return out.sort((a, b) => due(a.item) - due(b.item)).slice(0, config.limit || 8)
    }, [state.entities, state.work, who, config.limit])

    if (!boardsOf(state).length) {
      return <Empty title="No boards yet" hint="Open Boards and start from a template." action={<button className="btn btn--sm" onClick={() => navigate?.('work')}>Open Boards</button>} />
    }
    if (!rows.length) {
      return <Empty title={who ? `Nothing open for ${config.who || state.work.me}` : 'Nothing unassigned'} hint="Set the person in this widget's settings to see one person's load." />
    }
    return (
      <div className="list">
        {rows.map(({ item, board }) => {
          const status = board.columns.find((c) => c.kind === 'status')
          const label = status ? labelOf(status, cellValue(item, status, board)) : null
          return (
            <button key={item.id} type="button" className="list__item list__item--interactive" onClick={() => navigate?.('work')}>
              <span className="list__main">
                <span className="list__title truncate">{item.title}</span>
                <span className="list__meta">
                  <span className="chip">{board.name}</span>
                  {label && <span className={`chip${label.tone && label.tone !== 'neutral' ? ` chip--${label.tone}` : ''}`}>{label.text}</span>}
                  {item.due && <span>{formatDate(item.due)}</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    )
  },
})

/** One board, broken down by any of its label columns. */
defineWidget({
  id: 'board-summary',
  name: 'Board summary',
  description: 'How one board splits by status, priority or any dropdown, with a live count per lane.',
  category: 'Work',
  size: 'md',
  options: [
    { key: 'board', label: 'Board name', type: 'text' },
    { key: 'by', label: 'Column name', type: 'text' },
  ],
  render: ({ state, config, navigate }) => {
    const boards = boardsOf(state)
    const board = boards.find((b) => b.name.toLowerCase() === String(config.board || '').toLowerCase()) || boards[0]
    if (!board) {
      return <Empty title="No boards yet" action={<button className="btn btn--sm" onClick={() => navigate?.('work')}>Open Boards</button>} />
    }
    const column = board.columns.find((c) => c.name.toLowerCase() === String(config.by || '').toLowerCase())
      || board.columns.find((c) => c.kind === 'status')
    const items = topLevel(itemsOf(state, board.id))
    const lanes = groupItems(items, board, column?.id || 'group').filter((lane) => lane.items.length)
    const total = items.length || 1
    return (
      <div className="stack" style={{ gap: 'var(--gap-2)' }}>
        <div className="row row--between">
          <strong>{board.name}</strong>
          <span className="muted">{items.length} {board.itemNoun.toLowerCase()}{items.length === 1 ? '' : 's'}</span>
        </div>
        {lanes.length === 0 && <Empty title="This board is empty" />}
        {lanes.map((lane) => (
          <div key={lane.id || 'none'} className={`bar-row tone--${lane.tone || 'accent'}`}>
            <span className="bar-row__label truncate">{lane.name}</span>
            <span className="bar-row__track">
              <span className="bar-row__fill" style={{ width: `${Math.max(2, (lane.items.length / total) * 100)}%`, background: 'var(--tone)' }} />
            </span>
            <span className="bar-row__value tabular">{lane.items.length}</span>
          </div>
        ))}
        <button className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate?.('work')}>Open the board</button>
      </div>
    )
  },
})

/** What changed on the boards, newest first. */
defineWidget({
  id: 'board-activity',
  name: 'Board activity',
  description: 'The last things that changed on any board: who, what and when.',
  category: 'Work',
  size: 'md',
  options: [{ key: 'limit', label: 'Rows', type: 'number', min: 3, max: 30, default: 10 }],
  render: ({ state, config, navigate }) => {
    const rows = useMemo(() => {
      const out = []
      for (const board of boardsOf(state)) {
        for (const entry of state.work.activity[board.id] || []) out.push({ ...entry, board: board.name })
      }
      return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, config.limit || 10)
    }, [state.work, config.limit])
    if (!rows.length) return <Empty title="Nothing has changed yet" hint="Edit a board and its history shows up here." />
    return (
      <div className="list">
        {rows.map((entry) => (
          <button key={entry.id} type="button" className="list__item list__item--interactive" onClick={() => navigate?.('work')}>
            <span className="list__main">
              <span className="list__title truncate">{entry.itemTitle}</span>
              <span className="list__meta">
                <span className="chip">{entry.board}</span>
                <span className="truncate">{entry.text}</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    )
  },
})

const due = (item) => {
  const at = Date.parse(item.due || item.end || item.at || '')
  return Number.isFinite(at) ? at : Number.MAX_SAFE_INTEGER
}
