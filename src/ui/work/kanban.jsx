import { useState } from 'react'
import { cellValue, labelOf, typeOf } from '../../work/columns.js'
import { groupItems } from '../../work/query.js'
import { itemOrder, topLevel } from '../../work/schema.js'
import { createItem, moveItem, setCell } from '../../work/store.js'
import { initials } from './cells.jsx'
import { formatDate } from '../../core/time.js'
import { IconPlus } from '../icons.jsx'

/**
 * Lanes, cards, drag between them.
 *
 * The lane a card sits in is a column value - status by default - so dropping
 * a card is the same write as picking that value in the table, automations
 * and all. Grouped by the board's own groups instead, a drop moves the row.
 */

export function KanbanView({ board, view, items, onOpen }) {
  const [dragging, setDragging] = useState(null)
  const groupBy = view.config.groupBy && view.config.groupBy !== 'group'
    ? view.config.groupBy
    : board.columns.find((c) => c.kind === 'status')?.id || 'group'
  const column = board.columns.find((c) => c.id === groupBy)
  const lanes = groupItems(topLevel(items), board, groupBy)
  const face = board.columns.filter((c) => c.id !== groupBy && !['longtext', 'formula'].includes(c.kind)).slice(0, 4)

  const dropOn = (laneId) => {
    if (!dragging) return
    if (column) setCell(dragging, column.id, column.kind === 'dropdown' ? [laneId] : laneId)
    else moveItem(dragging, laneId)
    setDragging(null)
  }

  return (
    <div className="wkanban">
      {lanes.map((lane) => (
        <section
          key={lane.id || 'none'}
          className={`wlane tone--${lane.tone || 'accent'}`}
          onDragOver={(e) => dragging && e.preventDefault()}
          onDrop={() => dropOn(lane.id)}
        >
          <header className="wlane__head">
            <span className="wlane__dot" aria-hidden="true" />
            <strong className="truncate">{lane.name}</strong>
            <span className="muted">{lane.items.length}</span>
          </header>
          <div className="wlane__body">
            {[...lane.items].sort(itemOrder).map((item) => (
              <article
                key={item.id}
                className="wcard"
                draggable
                onDragStart={() => setDragging(item.id)}
                onDragEnd={() => setDragging(null)}
              >
                <button type="button" className="wcard__title" onClick={() => onOpen(item)}>{item.title}</button>
                <div className="wcard__meta">
                  {(item.people || []).slice(0, 3).map((p) => (
                    <span key={p} className="avatar" title={p}>{initials(p)}</span>
                  ))}
                  {item.due && <span className="chip">{formatDate(item.due)}</span>}
                  {face.map((c) => {
                    const value = cellValue(item, c, board)
                    const text = typeOf(c).toText(value, c)
                    if (!text) return null
                    const label = labelOf(c, value)
                    return <span key={c.id} className={`chip${label?.tone ? ` chip--${label.tone === 'neutral' ? '' : label.tone}` : ''}`} title={c.name}>{text}</span>
                  })}
                </div>
              </article>
            ))}
            <AddCard
              noun={board.itemNoun}
              onAdd={(title) => {
                const created = createItem(board.id, board.groups[0]?.id, { title })
                if (created && column) setCell(created.id, column.id, column.kind === 'dropdown' ? [lane.id] : lane.id)
                else if (created) moveItem(created.id, lane.id)
              }}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

function AddCard({ noun, onAdd }) {
  const [value, setValue] = useState('')
  const commit = () => {
    const title = value.trim()
    if (!title) return
    onAdd(title)
    setValue('')
  }
  return (
    <div className="wcard wcard--add">
      <IconPlus width={11} height={11} />
      <input
        value={value}
        placeholder={`Add a ${String(noun).toLowerCase()}`}
        aria-label={`Add a ${String(noun).toLowerCase()} to this lane`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        onBlur={commit}
      />
    </div>
  )
}
