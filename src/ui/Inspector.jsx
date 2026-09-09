import { useState, useEffect } from 'react'
import { updateEntity, removeEntity } from '../core/store.js'
import { STATUSES, TYPE_LABEL } from '../data/schema.js'
import { formatDate, formatTime, relative } from '../core/time.js'
import { format } from '../core/format.js'
import { Overlay } from './components.jsx'
import { IconClose, IconTrash, IconDoc } from './icons.jsx'

/** One panel for every entity type. Edits write straight through to the store. */
export function Inspector({ entity, onClose, onOpen, related = [] }) {
  const [draft, setDraft] = useState(entity)

  useEffect(() => setDraft(entity), [entity])
  if (!entity) return null

  const commit = (patch) => {
    setDraft((d) => ({ ...d, ...patch }))
    updateEntity(entity.id, patch)
  }

  const isTask = draft.type === 'task' || draft.type === 'milestone' || draft.type === 'risk'

  return (
    <Overlay onClose={onClose} labelledBy="inspector-title">
      <header className="sheet__head">
        <span className="chip">{TYPE_LABEL[draft.type] || draft.type}</span>
        <div className="spacer" />
        <button className="btn btn--icon btn--danger" title="Delete" aria-label="Delete this item" onClick={() => { removeEntity(entity.id); onClose() }}>
          <IconTrash />
        </button>
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>

      <div className="sheet__body">
        <div className="field">
          <label className="field__label" htmlFor="inspector-title">Title</label>
          <textarea
            id="inspector-title"
            className="textarea"
            style={{ minHeight: 56, fontSize: 'var(--t-lg)', fontWeight: 560 }}
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onBlur={() => commit({ title: draft.title })}
          />
        </div>

        {isTask && (
          <div className="row row--wrap">
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <span className="field__label">Status</span>
              <select className="select" value={draft.status || 'open'} onChange={(e) => commit({ status: e.target.value })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 130 }}>
              <span className="field__label">Priority</span>
              <select className="select" value={draft.priority} onChange={(e) => commit({ priority: Number(e.target.value) })}>
                <option value={0}>Normal</option>
                <option value={1}>High</option>
                <option value={2}>Urgent</option>
              </select>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 150 }}>
              <span className="field__label">Due</span>
              <input
                className="input"
                type="date"
                value={draft.due ? draft.due.slice(0, 10) : ''}
                onChange={(e) => commit({ due: e.target.value ? new Date(`${e.target.value}T17:00`).toISOString() : null })}
              />
            </div>
          </div>
        )}

        {draft.type === 'event' && (
          <div className="row row--wrap">
            <span className="chip">{formatDate(draft.at, { weekday: 'long' })}</span>
            <span className="chip">{formatTime(draft.at)}{draft.end ? ` - ${formatTime(draft.end)}` : ''}</span>
            {draft.meta?.location && <span className="chip">{draft.meta.location}</span>}
          </div>
        )}

        {draft.type === 'metric' && (
          <div className="stat">
            <span className="stat__label">{draft.series}</span>
            <span className="stat__value">{format(draft.value, draft.unit)}</span>
            <span className="stat__foot">recorded {formatDate(draft.at)}</span>
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="inspector-people">People</label>
          <input
            id="inspector-people"
            className="input"
            value={draft.people.join(', ')}
            placeholder="Comma separated"
            onChange={(e) => setDraft({ ...draft, people: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            onBlur={() => commit({ people: draft.people })}
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="inspector-tags">Tags</label>
          <input
            id="inspector-tags"
            className="input"
            value={draft.tags.join(', ')}
            placeholder="Comma separated"
            onChange={(e) => setDraft({ ...draft, tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
            onBlur={() => commit({ tags: draft.tags })}
          />
        </div>

        {draft.body && (
          <div className="field">
            <span className="field__label">Detail</span>
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'var(--t-md)', color: 'var(--ink-2)', maxHeight: 260, overflow: 'auto' }}>
              {draft.body}
            </pre>
          </div>
        )}

        {draft.meta?.table && <TablePreview table={draft.meta.table} />}

        <div className="field">
          <span className="field__label">Source</span>
          <div className="row" style={{ color: 'var(--ink-2)' }}>
            <IconDoc width={13} height={13} />
            <span className="truncate">{draft.source?.name}</span>
            {draft.source?.line ? <span className="muted">line {draft.source.line}</span> : null}
          </div>
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            Added {relative(draft.createdAt)}
            {draft.confidence < 1 ? ` - parser confidence ${Math.round(draft.confidence * 100)}%` : ''}
          </span>
        </div>

        {related.length > 0 && (
          <div className="field">
            <span className="field__label">From the same document</span>
            <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              {dedupe(related).slice(0, 8).map((r) => (
                <button key={r.id} className="list__item list__item--interactive" onClick={() => onOpen?.(r)}>
                  <span className="list__main">
                    <span className="list__title truncate">{r.title}</span>
                    <span className="list__meta">
                      <span className="chip">{r.type}</span>
                      {(r.at || r.due) && <span>{formatDate(r.at || r.due)}</span>}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Overlay>
  )
}

/** A recurring meeting produces one entity per occurrence; the panel only
    needs to show it once. */
function dedupe(rows) {
  const seen = new Set()
  return rows.filter((r) => {
    const key = `${r.type}:${r.title}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function TablePreview({ table }) {
  return (
    <div className="field">
      <span className="field__label">Rows</span>
      <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}>
        <table className="table">
          <thead><tr>{table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {table.rows.slice(0, 25).map((row, i) => (
              <tr key={i}>{row.map((cell, ci) => <td key={ci}>{String(cell ?? '')}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
