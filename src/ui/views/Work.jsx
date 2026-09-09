import { useEffect, useMemo, useState } from 'react'
import { TableView } from '../work/table.jsx'
import { KanbanView } from '../work/kanban.jsx'
import { TimelineView } from '../work/timeline.jsx'
import { CalendarView } from '../work/calendar.jsx'
import { ChartView } from '../work/chart.jsx'
import { WorkloadView } from '../work/workload.jsx'
import { FormView } from '../work/form.jsx'
import { ItemPanel } from '../work/item.jsx'
import { BoardSettings } from '../work/settings.jsx'
import { Empty } from '../components.jsx'
import { downloadText } from '../download.js'
import { DATE_WINDOWS, FILTER_OPS, applyFilters, applySort, opsFor } from '../../work/query.js'
import { boardToCsv, boardFromTable } from '../../work/csv.js'
import { TEMPLATES } from '../../work/templates.js'
import {
  activityFor, boardsOf, createBoard, createItem, createItems, duplicateBoard,
  findBoard, itemsOf, markNotificationsRead, removeBoard, updateView, updatesFor,
} from '../../work/store.js'
import { parseDelimited, toTable } from '../../ingest/parsers/csv.js'
import { readWorkbook } from '../../ingest/parsers/xlsx.js'
import {
  IconBell, IconChart, IconClose, IconGrid, IconPlus, IconSettings,
  IconTimeline, IconToday, IconTrash, IconUpload, IconUsers,
} from '../icons.jsx'

const VIEW_ICON = {
  table: IconGrid, kanban: IconGrid, timeline: IconTimeline,
  calendar: IconToday, chart: IconChart, workload: IconUsers, form: IconUpload,
}

/**
 * Boards: the work-management half of the app.
 *
 * A board picker, the saved views on the board it selects, and one toolbar that
 * every view shares. Rows are entities, so anything created here also lands in
 * Today, Triage, the timeline and the brain.
 */
export function Work({ state, onToast, onOpenEntity }) {
  const boards = boardsOf(state)
  const [boardId, setBoardId] = useState(() => boards[0]?.id || null)
  const [viewId, setViewId] = useState(null)
  const [inspecting, setInspecting] = useState(null)
  const [settings, setSettings] = useState(false)
  const [filtering, setFiltering] = useState(false)
  const [editingForm, setEditingForm] = useState(false)

  const board = findBoard(state, boardId) || boards[0] || null
  const view = board?.views.find((v) => v.id === viewId) || board?.views[0] || null

  useEffect(() => {
    if (board && !boards.some((b) => b.id === boardId)) setBoardId(board.id)
  }, [boards, boardId, board])

  const allItems = useMemo(() => (board ? itemsOf(state, board.id) : []), [state.entities, board?.id])
  const people = useMemo(() => {
    const seen = new Set()
    for (const entity of Object.values(state.entities)) for (const person of entity.people || []) seen.add(person)
    return [...seen].sort()
  }, [state.entities])

  const items = useMemo(() => {
    if (!board || !view) return []
    return applySort(applyFilters(allItems, view, board), view, board)
  }, [allItems, board, view])

  const item = inspecting ? state.entities[inspecting] : null
  const unread = (state.work.notifications || []).filter((n) => !n.read).length

  if (!boards.length) return <FirstBoard onToast={onToast} onPick={(id) => setBoardId(id)} />

  return (
    <div className="wshell">
      <aside className="wboards" aria-label="Boards">
        <div className="wboards__head">
          <span className="field__label">Boards</span>
          <button type="button" className="btn btn--sm" onClick={() => { const b = createBoard({ name: 'New board' }); setBoardId(b.id) }} aria-label="New board">
            <IconPlus width={11} height={11} />
          </button>
        </div>
        {boards.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`wboards__item tone--${b.tone}`}
            aria-current={b.id === board?.id}
            onClick={() => { setBoardId(b.id); setViewId(null) }}
          >
            <span className="wboards__dot" aria-hidden="true" />
            <span className="truncate">{b.name}</span>
            <span className="muted">{itemsOf(state, b.id).filter((i) => !i.meta?.parent).length}</span>
          </button>
        ))}
        <TemplateAdd onCreate={(id) => setBoardId(id)} onToast={onToast} />
        <SpreadsheetAdd onCreate={(id) => setBoardId(id)} onToast={onToast} />
        {board && (
          <BoardActions
            board={board}
            onToast={onToast}
            onGone={() => setBoardId(boards.find((b) => b.id !== board.id)?.id || null)}
            onCopied={(id) => setBoardId(id)}
          />
        )}
      </aside>

      <div className="wmain">
        <header className="wtabs">
          {board.views.map((v) => {
            const Icon = VIEW_ICON[v.kind] || IconGrid
            return (
              <button
                key={v.id}
                type="button"
                className="wtab"
                aria-current={v.id === view?.id}
                onClick={() => { setViewId(v.id); setEditingForm(false) }}
              >
                <Icon width={12} height={12} /> {v.name}
              </button>
            )
          })}
          <span className="spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setSettings(true)}>
            <IconSettings width={12} height={12} /> Board
          </button>
        </header>

        <div className="wtools">
          <input
            className="input wtools__search"
            type="search"
            value={view?.config.search || ''}
            placeholder={`Search ${board.name}`}
            aria-label={`Search ${board.name}`}
            onChange={(e) => updateView(board.id, view.id, { config: { search: e.target.value } })}
          />
          <button type="button" className="btn btn--sm" aria-pressed={filtering} onClick={() => setFiltering((f) => !f)}>
            Filter{(view?.config.filters || []).length ? ` (${view.config.filters.length})` : ''}
          </button>
          <select
            className="select select--sm"
            value={view?.config.groupBy || 'group'}
            aria-label="Group by"
            onChange={(e) => updateView(board.id, view.id, { config: { groupBy: e.target.value } })}
          >
            <option value="group">Group by: groups</option>
            <option value="none">No grouping</option>
            {board.columns.filter((c) => ['status', 'priority', 'dropdown', 'person'].includes(c.kind)).map((c) => (
              <option key={c.id} value={c.id}>Group by: {c.name}</option>
            ))}
          </select>
          <span className="spacer" />
          {view?.kind === 'form' && (
            <button type="button" className="btn btn--sm" aria-pressed={editingForm} onClick={() => setEditingForm((e) => !e)}>Edit the form</button>
          )}
          <button
            type="button" className="btn btn--sm"
            onClick={() => downloadText(boardToCsv(board, items), `${board.name.replace(/[^\w.-]+/g, '-')}.csv`, 'text/csv')}
          >
            Export CSV
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={() => createItem(board.id, board.groups[0]?.id, { title: `New ${board.itemNoun.toLowerCase()}` })}>
            <IconPlus width={11} height={11} /> New {board.itemNoun.toLowerCase()}
          </button>
          <Bell count={unread} notifications={state.work.notifications} onRead={markNotificationsRead} onOpen={(id) => setInspecting(id)} />
        </div>

        {filtering && <Filters board={board} view={view} />}

        <div className="wbody">
          {!view ? <Empty title="This board has no views" /> : renderView(view.kind, {
            board, view, items, people, allItems,
            weekStartsOn: state.settings.weekStartsOn,
            editing: editingForm,
            onOpen: (row) => setInspecting(row.id),
            onToast,
          })}
        </div>
      </div>

      {item && board && (
        <ItemPanel
          item={item}
          board={findBoard(state, item.meta?.board) || board}
          boards={boards}
          items={itemsOf(state, item.meta?.board)}
          updates={updatesFor(state, item.id)}
          activity={activityFor(state, item.meta?.board)}
          people={people}
          onOpen={(row) => setInspecting(row.id)}
          onClose={() => setInspecting(null)}
        />
      )}

      {settings && (
        <BoardSettings
          board={board}
          boards={boards}
          view={view}
          onToast={onToast}
          onClose={() => setSettings(false)}
        />
      )}
    </div>
  )
}

function renderView(kind, props) {
  switch (kind) {
    case 'kanban': return <KanbanView {...props} />
    case 'timeline': return <TimelineView {...props} />
    case 'calendar': return <CalendarView {...props} />
    case 'chart': return <ChartView {...props} />
    case 'workload': return <WorkloadView {...props} />
    case 'form': return <FormView {...props} />
    default: return <TableView {...props} />
  }
}

function Filters({ board, view }) {
  const filters = view.config.filters || []
  const set = (next) => updateView(board.id, view.id, { config: { filters: next } })
  return (
    <div className="wfilters">
      {filters.map((filter, i) => {
        const column = board.columns.find((c) => c.id === filter.columnId)
        const ops = opsFor(column)
        return (
          <div key={i} className="row row--wrap">
            <select
              className="select select--sm" value={filter.columnId || 'title'} aria-label="Filter column"
              onChange={(e) => set(filters.map((f, j) => (j === i ? { ...f, columnId: e.target.value, op: opsFor(board.columns.find((c) => c.id === e.target.value))[0] } : f)))}
            >
              <option value="title">{board.itemNoun} name</option>
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="select select--sm" value={filter.op} aria-label="Filter test"
              onChange={(e) => set(filters.map((f, j) => (j === i ? { ...f, op: e.target.value } : f)))}
            >
              {ops.map((op) => <option key={op} value={op}>{FILTER_OPS[op].name}</option>)}
            </select>
            {FILTER_OPS[filter.op]?.needsValue && <FilterValue column={column} filter={filter} onChange={(value) => set(filters.map((f, j) => (j === i ? { ...f, value } : f)))} />}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => set(filters.filter((_, j) => j !== i))} aria-label="Remove this filter"><IconClose width={11} height={11} /></button>
          </div>
        )
      })}
      <button type="button" className="btn btn--sm" onClick={() => set([...filters, { columnId: board.columns[0]?.id, op: opsFor(board.columns[0])[0], value: '' }])}>
        <IconPlus width={10} height={10} /> Add a filter
      </button>
      {filters.length > 0 && <button type="button" className="btn btn--sm btn--ghost" onClick={() => set([])}>Clear all</button>}
    </div>
  )
}

function FilterValue({ column, filter, onChange }) {
  if (filter.op === 'within') {
    return (
      <select className="select select--sm" value={filter.value || 'today'} aria-label="When" onChange={(e) => onChange(e.target.value)}>
        {Object.entries(DATE_WINDOWS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    )
  }
  if (column?.labels?.length) {
    return (
      <select className="select select--sm" value={filter.value || ''} aria-label="Value" onChange={(e) => onChange(e.target.value)}>
        <option value="">choose…</option>
        {column.labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
      </select>
    )
  }
  if (FILTER_OPS[filter.op]?.date) {
    return <input className="input" type="date" aria-label="Date" value={filter.value || ''} onChange={(e) => onChange(e.target.value)} />
  }
  return <input className="input" aria-label="Value" value={filter.value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

function Bell({ count, notifications, onRead, onOpen }) {
  const [open, setOpen] = useState(false)
  return (
    <span className="wbell">
      <button
        type="button" className="btn btn--sm" aria-expanded={open}
        onClick={() => { setOpen((o) => !o); if (!open) onRead() }}
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
      >
        <IconBell width={12} height={12} />
        {count > 0 && <span className="wbell__count">{count}</span>}
      </button>
      {open && (
        <div className="wbell__panel">
          {notifications.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing yet.</p>}
          {notifications.slice(0, 20).map((n) => (
            <button key={n.id} type="button" className="wbell__item" onClick={() => { onOpen(n.itemId); setOpen(false) }}>
              {n.text}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

function BoardActions({ board, onToast, onGone, onCopied }) {
  return (
    <div className="wboard-actions">
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => { const copy = duplicateBoard(board.id, { withItems: true }); if (copy) { onCopied(copy.id); onToast?.('Board duplicated', 'good') } }}>
        Duplicate board
      </button>
      <button
        type="button" className="btn btn--sm btn--ghost"
        onClick={() => { if (confirm(`Delete "${board.name}" and everything on it?`)) { removeBoard(board.id); onGone(); onToast?.('Board deleted', 'warn') } }}
      >
        <IconTrash width={11} height={11} /> Delete board
      </button>
    </div>
  )
}

function TemplateAdd({ onCreate, onToast }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" className="btn btn--sm btn--ghost wboards__add" onClick={() => setOpen(true)}>From a template…</button>
  return (
    <div className="wtemplates">
      {TEMPLATES.map((template) => (
        <button
          key={template.id} type="button" className="wtemplate"
          onClick={() => { const b = createBoard(template.build()); onCreate(b.id); setOpen(false); onToast?.(`${template.name} board created`, 'good') }}
        >
          <strong>{template.name}</strong>
          <span className="muted">{template.blurb}</span>
        </button>
      ))}
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
    </div>
  )
}

function SpreadsheetAdd({ onCreate, onToast }) {
  const read = async (file) => {
    if (!file) return
    try {
      const tables = /\.(xlsx|xlsm)$/i.test(file.name)
        ? (await readWorkbook(await file.arrayBuffer())).map((sheet) => ({ ...toTable(sheet.rows), sheet: sheet.name }))
        : [toTable(parseDelimited(await file.text()))]
      const table = tables.find((t) => t.headers?.length && t.rows?.length)
      if (!table) { onToast?.('No table in that file', 'warn'); return }
      const built = boardFromTable(table, { name: file.name.replace(/\.[^.]+$/, '') })
      if (!built) { onToast?.('No table in that file', 'warn'); return }
      const board = createBoard(built.board)
      createItems(board.id, board.groups[0].id, built.items)
      onCreate(board.id)
      onToast?.(`${built.items.length} rows imported`, 'good')
    } catch (err) {
      onToast?.(`Could not read that file: ${err.message}`, 'bad')
    }
  }
  return (
    <label className="btn btn--sm btn--ghost wboards__add">
      From a spreadsheet…
      <input type="file" accept=".csv,.tsv,.xlsx,.xlsm" hidden onChange={(e) => { read(e.target.files?.[0]); e.target.value = '' }} />
    </label>
  )
}

function FirstBoard({ onPick, onToast }) {
  return (
    <div className="card" style={{ maxWidth: 720, margin: '6vh auto' }}>
      <div className="card__body stack" style={{ padding: 'var(--gap-6)' }}>
        <h2 style={{ fontSize: 'var(--t-2xl)', letterSpacing: '-0.02em', margin: 0 }}>Boards, the way you would run them.</h2>
        <p className="secondary" style={{ margin: 0 }}>
          Typed columns, groups, seven view kinds, rules that fire when something changes, forms that add rows.
          Every row is also a task in the rest of the app, so a board fills Today, Triage and the timeline as you work it.
        </p>
        <div className="wtemplates">
          {TEMPLATES.map((template) => (
            <button
              key={template.id} type="button" className="wtemplate"
              onClick={() => { const b = createBoard(template.build()); onPick(b.id); onToast?.(`${template.name} board created`, 'good') }}
            >
              <strong>{template.name}</strong>
              <span className="muted">{template.blurb}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <SpreadsheetAdd onCreate={onPick} onToast={onToast} />
          <button type="button" className="btn" onClick={() => { const b = createBoard({ name: 'New board' }); onPick(b.id) }}>Start from an empty board</button>
        </div>
      </div>
    </div>
  )
}
