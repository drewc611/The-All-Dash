import { useMemo, useState } from 'react'
import { Cell } from './cells.jsx'
import { SUMMARY_NAMES, groupItems, summarise } from '../../work/query.js'
import { itemOrder, subitemsOf, topLevel } from '../../work/schema.js'
import {
  addGroup, addSubitem, createItem, duplicateItem, moveGroup, moveItem, removeGroup,
  removeItems, setItemFields, updateGroup, updateView,
} from '../../work/store.js'
import { IconChevron, IconPlus, IconTrash } from '../icons.jsx'

/**
 * The main table.
 *
 * Rows in groups, a cell per column, a summary line under each group and one
 * under the board. Dragging a row moves it; the drop target is a group header
 * or another row, which is enough for both reordering and re-grouping.
 */

/**
 * `items` is what the view's filters left; `allItems` is everything on the
 * board. Subitems and dependency pickers read the second one, so a filter on
 * the parent rows never makes a child look deleted.
 */
export function TableView({ board, view, items, allItems = items, people, onOpen, onToast }) {
  const [selection, setSelection] = useState(() => new Set())
  const [expanded, setExpanded] = useState(() => new Set())
  const [dragging, setDragging] = useState(null)

  const hidden = new Set(view.config.hidden || [])
  const columns = board.columns.filter((c) => !hidden.has(c.id))
  const groups = useMemo(
    () => groupItems(topLevel(items), board, view.config.groupBy || 'group'),
    [items, board, view.config.groupBy]
  )
  const byGroup = view.config.groupBy === 'group' || !view.config.groupBy

  const toggle = (id) => setSelection((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const sort = view.config.sort
  const setSort = (columnId) => updateView(board.id, view.id, {
    config: {
      sort: sort?.columnId === columnId ? (sort.dir === 'asc' ? { columnId, dir: 'desc' } : null) : { columnId, dir: 'asc' },
    },
  })

  const drop = (groupId, beforeId) => {
    if (!dragging) return
    moveItem(dragging, groupId, { before: beforeId })
    setDragging(null)
  }

  /**
   * Reordering without a mouse. Dragging is the fast path; these two buttons
   * are the one that works with a keyboard and a thumb, which is the same
   * bargain the widget grid makes.
   */
  const nudge = (rows, index, delta) => {
    const item = rows[index]
    const target = index + delta
    if (!item || target < 0 || target >= rows.length) return
    const before = delta < 0 ? rows[target].id : rows[target + 1]?.id || null
    moveItem(item.id, item.meta?.group, { before })
  }

  return (
    <div className="wtable-wrap">
      {selection.size > 0 && (
        <BulkBar
          board={board}
          count={selection.size}
          onClear={() => setSelection(new Set())}
          onDelete={() => { removeItems([...selection]); onToast?.(`${selection.size} deleted`, 'good'); setSelection(new Set()) }}
          onMove={(groupId) => { for (const id of selection) moveItem(id, groupId); setSelection(new Set()) }}
          onDuplicate={() => { for (const id of selection) duplicateItem(id); setSelection(new Set()) }}
        />
      )}

      {groups.map((group) => {
        const rows = [...group.items].sort(view.config.sort ? () => 0 : itemOrder)
        const collapsed = byGroup && board.groups.find((g) => g.id === group.id)?.collapsed
        return (
          <section key={group.id || 'none'} className={`wgroup tone--${group.tone || 'accent'}`}>
            <header
              className="wgroup__head"
              onDragOver={(e) => { if (dragging && byGroup) e.preventDefault() }}
              onDrop={() => byGroup && drop(group.id, null)}
            >
              <button
                type="button"
                className="wgroup__toggle"
                aria-expanded={!collapsed}
                onClick={() => byGroup && updateGroup(board.id, group.id, { collapsed: !collapsed })}
              >
                <IconChevron width={11} height={11} style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }} />
              </button>
              {byGroup ? (
                <input
                  className="wgroup__name"
                  value={group.name}
                  aria-label="Group name"
                  onChange={(e) => updateGroup(board.id, group.id, { name: e.target.value })}
                />
              ) : <span className="wgroup__name">{group.name}</span>}
              <span className="muted">{rows.length}</span>
              {byGroup && (
                <span className="wgroup__tools">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => moveGroup(board.id, group.id, -1)} aria-label="Move the group up">↑</button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => moveGroup(board.id, group.id, 1)} aria-label="Move the group down">↓</button>
                  <select
                    className="select select--sm" value={group.tone || 'accent'} aria-label="Group colour"
                    onChange={(e) => updateGroup(board.id, group.id, { tone: e.target.value })}
                  >
                    {['accent', 'good', 'warning', 'serious', 'critical', 'neutral'].map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeGroup(board.id, group.id)} aria-label={`Delete the group ${group.name}`}><IconTrash width={11} height={11} /></button>
                </span>
              )}
            </header>

            {!collapsed && (
              <div className="wtable" role="table" aria-label={`${board.name}: ${group.name}`}>
                <div className="wtable__row wtable__row--head" role="row">
                  <span className="wtable__pick" role="columnheader"><span className="visually-hidden">Select</span></span>
                  <span className="wtable__title" role="columnheader">
                    <button type="button" className="wtable__sort" onClick={() => setSort('title')}>
                      {board.itemNoun}{sort?.columnId === 'title' ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                  </span>
                  {columns.map((column) => (
                    <span key={column.id} className="wtable__cell" role="columnheader" style={{ width: column.width }}>
                      <button type="button" className="wtable__sort truncate" onClick={() => setSort(column.id)} title={`Sort by ${column.name}`}>
                        {column.name}{sort?.columnId === column.id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                      </button>
                    </span>
                  ))}
                </div>

                {rows.map((item, index) => (
                  <Row
                    key={item.id}
                    item={item}
                    board={board}
                    columns={columns}
                    items={allItems}
                    people={people}
                    selected={selection.has(item.id)}
                    onSelect={() => toggle(item.id)}
                    onOpen={onOpen}
                    subitems={subitemsOf(allItems, item.id)}
                    expanded={expanded.has(item.id)}
                    onExpand={() => setExpanded((s) => { const next = new Set(s); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next })}
                    onDragStart={() => setDragging(item.id)}
                    onDrop={() => byGroup && drop(item.meta?.group, item.id)}
                    draggable={byGroup && !view.config.sort}
                    onNudge={byGroup && !view.config.sort ? (delta) => nudge(rows, index, delta) : null}
                  />
                ))}

                {byGroup && (
                  <div className="wtable__row wtable__row--add" role="row">
                    <span className="wtable__pick" />
                    <span className="wtable__title">
                      <AddRow noun={board.itemNoun} onAdd={(title) => createItem(board.id, group.id, { title })} />
                    </span>
                  </div>
                )}

                <div className="wtable__row wtable__row--sum" role="row">
                  <span className="wtable__pick" />
                  <span className="wtable__title muted">{rows.length} {rows.length === 1 ? 'item' : 'items'}</span>
                  {columns.map((column) => {
                    const summary = summarise(rows, column, board, view.config.summaries?.[column.id])
                    return (
                      <span key={column.id} className="wtable__cell wtable__sum" style={{ width: column.width }}>
                        {summary && (
                          <span className={summary.tone ? `tone--${summary.tone}` : undefined} title={`${SUMMARY_NAMES[view.config.summaries?.[column.id]] || summary.label}: ${summary.text}`}>
                            <span className="wtable__sumlabel">{summary.label}</span> {summary.text}
                          </span>
                        )}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </section>
        )
      })}

      {byGroup && (
        <button type="button" className="btn btn--ghost wgroup__add" onClick={() => addGroup(board.id)}>
          <IconPlus width={11} height={11} /> Add a group
        </button>
      )}
    </div>
  )
}

function Row({ item, board, columns, items, people, selected, onSelect, onOpen, subitems, expanded, onExpand, onDragStart, onDrop, draggable, onNudge }) {
  return (
    <>
      <div
        className={`wtable__row${selected ? ' is-selected' : ''}${item.status === 'done' ? ' is-done' : ''}`}
        role="row"
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={(e) => draggable && e.preventDefault()}
        onDrop={onDrop}
      >
        <span className="wtable__pick" role="cell">
          <input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${item.title}`} />
        </span>
        <span className="wtable__title" role="cell">
          {subitems.length > 0 && (
            <button type="button" className="wtable__expand" aria-expanded={expanded} onClick={onExpand} aria-label={`${subitems.length} subitems`}>
              <IconChevron width={10} height={10} style={{ transform: expanded ? 'rotate(90deg)' : 'none' }} />
            </button>
          )}
          <input
            className="wtable__name"
            value={item.title}
            aria-label={`${board.itemNoun} name`}
            onChange={(e) => setItemFields(item.id, { title: e.target.value })}
          />
          {onNudge && (
            <>
              <button type="button" className="wtable__open" onClick={() => onNudge(-1)} aria-label={`Move ${item.title} up`}>↑</button>
              <button type="button" className="wtable__open" onClick={() => onNudge(1)} aria-label={`Move ${item.title} down`}>↓</button>
            </>
          )}
          <button type="button" className="wtable__open" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}>
            {(board.itemNoun || 'Item').toLowerCase()} ›
          </button>
        </span>
        {columns.map((column) => (
          <span key={column.id} className="wtable__cell" role="cell" style={{ width: column.width }}>
            <Cell item={item} column={column} board={board} people={people} items={items} onOpen={onOpen} />
          </span>
        ))}
      </div>
      {expanded && subitems.map((sub) => (
        <div key={sub.id} className="wtable__row wtable__row--sub" role="row">
          <span className="wtable__pick" />
          <span className="wtable__title">
            <input className="wtable__name" value={sub.title} aria-label="Subitem name" onChange={(e) => setItemFields(sub.id, { title: e.target.value })} />
            <button type="button" className="wtable__open" onClick={() => onOpen(sub)} aria-label={`Open ${sub.title}`}>open ›</button>
          </span>
          {columns.map((column) => (
            <span key={column.id} className="wtable__cell" style={{ width: column.width }}>
              <Cell item={sub} column={column} board={board} people={people} items={items} onOpen={onOpen} />
            </span>
          ))}
        </div>
      ))}
      {expanded && (
        <div className="wtable__row wtable__row--sub" role="row">
          <span className="wtable__pick" />
          <span className="wtable__title"><AddRow noun="subitem" onAdd={(title) => addSubitem(item.id, title)} /></span>
        </div>
      )}
    </>
  )
}

function AddRow({ noun, onAdd }) {
  const [value, setValue] = useState('')
  const commit = () => {
    const title = value.trim()
    if (!title) return
    onAdd(title)
    setValue('')
  }
  return (
    <span className="wadd">
      <IconPlus width={10} height={10} />
      <input
        className="wadd__input"
        value={value}
        placeholder={`Add a ${String(noun).toLowerCase()}`}
        aria-label={`Add a ${String(noun).toLowerCase()}`}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
        onBlur={commit}
      />
    </span>
  )
}

function BulkBar({ board, count, onClear, onDelete, onMove, onDuplicate }) {
  return (
    <div className="wbulk" role="region" aria-label="Selected items">
      <strong>{count} selected</strong>
      <select className="select select--sm" value="" onChange={(e) => e.target.value && onMove(e.target.value)} aria-label="Move to a group">
        <option value="">Move to…</option>
        {board.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button type="button" className="btn btn--sm" onClick={onDuplicate}>Duplicate</button>
      <button type="button" className="btn btn--sm btn--danger" onClick={onDelete}>Delete</button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={onClear}>Clear</button>
    </div>
  )
}
