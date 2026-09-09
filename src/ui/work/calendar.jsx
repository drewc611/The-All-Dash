import { useState } from 'react'
import { cellValue, labelOf } from '../../work/columns.js'
import { pickColumn, topLevel } from '../../work/schema.js'
import { createItem, setCell, setItemFields } from '../../work/store.js'
import { addDays, dayKey, formatWeekday, startOfDay, startOfWeek } from '../../core/time.js'

/** A month at a time. Dropping a card on a day writes that day's date. */
export function CalendarView({ board, view, items, weekStartsOn = 1, onOpen }) {
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [dragging, setDragging] = useState(null)
  const dateColumn = pickColumn(board, 'date', view.config.dateColumn)
  const colorBy = board.columns.find((c) => c.id === view.config.colorBy) || board.columns.find((c) => c.kind === 'status')

  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = startOfWeek(first, weekStartsOn)
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))

  const buckets = new Map()
  for (const item of topLevel(items)) {
    const raw = dateColumn ? cellValue(item, dateColumn, board) : item.due || item.at
    const at = raw && typeof raw === 'object' ? raw.from : raw
    if (!at) continue
    const key = dayKey(at)
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }

  const write = (itemId, day) => {
    const iso = `${dayKey(day)}T09:00:00`
    if (dateColumn) setCell(itemId, dateColumn.id, iso)
    else setItemFields(itemId, { due: iso })
  }

  const monthName = first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const todayKey = dayKey(new Date())

  return (
    <div className="wcal">
      <header className="wcal__head">
        <button type="button" className="btn btn--sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month">←</button>
        <strong>{monthName}</strong>
        <button type="button" className="btn btn--sm" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month">→</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
        <span className="muted">{dateColumn ? dateColumn.name : 'Due date'}</span>
      </header>
      <div className="wcal__grid">
        {days.slice(0, 7).map((day) => (
          <div key={`h${day}`} className="wcal__weekday">{formatWeekday(day, 'short')}</div>
        ))}
        {days.map((day) => {
          const key = dayKey(day)
          const list = buckets.get(key) || []
          const outside = day.getMonth() !== first.getMonth()
          return (
            <div
              key={key}
              className={`wcal__day${outside ? ' is-outside' : ''}${key === todayKey ? ' is-today' : ''}`}
              onDragOver={(e) => dragging && e.preventDefault()}
              onDrop={() => { if (dragging) { write(dragging, day); setDragging(null) } }}
            >
              <div className="wcal__date">
                <span>{day.getDate()}</span>
                <button
                  type="button" className="wcal__add" aria-label={`Add on ${key}`}
                  onClick={() => {
                    const created = createItem(board.id, board.groups[0]?.id, { title: `New ${board.itemNoun.toLowerCase()}` })
                    if (created) write(created.id, day)
                  }}
                >+</button>
              </div>
              {list.slice(0, 4).map((item) => {
                const label = colorBy ? labelOf(colorBy, cellValue(item, colorBy, board)) : null
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`wcal__item tone--${label?.tone || 'accent'}`}
                    draggable
                    onDragStart={() => setDragging(item.id)}
                    onDragEnd={() => setDragging(null)}
                    onClick={() => onOpen(item)}
                    title={item.title}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                )
              })}
              {list.length > 4 && <span className="muted wcal__more">+{list.length - 4} more</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
