import { useEffect, useMemo, useRef, useState } from 'react'
import { cellValue, elapsed, formatDuration, labelOf, typeOf } from '../../work/columns.js'
import { setCell, toggleTimer } from '../../work/store.js'
import { formatDate } from '../../core/time.js'
import { format } from '../../core/format.js'
import { IconCheck, IconClock, IconClose, IconLink, IconPlus, IconStop } from '../icons.jsx'

/**
 * One cell, read and written.
 *
 * Every kind renders its own control rather than a text box that guesses:
 * a status is a menu of that column's own labels, a date is a date input, a
 * timer is a button that starts and stops. Read-only kinds (formula, created,
 * item id) render their text and nothing else.
 */

export function Cell({ item, column, board, readOnly = false, onOpen, people = [], items = [], onWrite }) {
  const type = typeOf(column)
  const value = cellValue(item, column, board)
  // A form edits a draft that is not in the store yet, so it passes onWrite.
  const write = (next) => (onWrite ? onWrite(column, next) : setCell(item.id, column.id, next))
  const locked = readOnly || type.readOnly

  switch (column.kind) {
    case 'status':
    case 'priority':
      return <LabelCell column={column} value={value} onChange={write} readOnly={locked} />
    case 'dropdown':
      return <DropdownCell column={column} value={value} onChange={write} readOnly={locked} />
    case 'person':
      return <ChipCell value={value} onChange={write} readOnly={locked} suggestions={people} placeholder="Assign" avatars />
    case 'tags':
      return <ChipCell value={value} onChange={write} readOnly={locked} placeholder="Add a tag" />
    case 'date':
      return <DateCell value={value} onChange={write} readOnly={locked} overdue={isOverdue(value, item)} />
    case 'timeline':
      return <TimelineCell value={value} onChange={write} readOnly={locked} />
    case 'checkbox':
      return <CheckCell value={value} onChange={write} readOnly={locked} label={column.name} />
    case 'rating':
      return <RatingCell value={value} max={column.max || 5} onChange={write} readOnly={locked} name={column.name} />
    case 'progress':
      return <ProgressCell value={value} onChange={write} readOnly={locked} name={column.name} />
    case 'number':
      return <NumberCell value={value} unit={column.unit} onChange={write} readOnly={locked} name={column.name} />
    case 'time':
      return <TimeCell value={value} onToggle={() => toggleTimer(item.id, column.id)} readOnly={locked || !!onWrite} />
    case 'link':
      return <LinkCell value={value} onChange={write} readOnly={locked} />
    case 'longtext':
      return <LongTextCell value={value} onChange={write} readOnly={locked} name={column.name} onOpen={() => onOpen?.(item)} />
    case 'dependency':
      return <DependencyCell value={value} items={items} onChange={write} readOnly={locked} />
    case 'formula':
    case 'created':
    case 'updated':
    case 'itemid':
      return <span className="cell cell--static mono truncate" title={type.toText(value, column)}>{type.toText(value, column)}</span>
    default:
      return <TextCell value={value} onChange={write} readOnly={locked} name={column.name} kind={column.kind} />
  }
}

const isOverdue = (value, item) =>
  !!value && item.status !== 'done' && item.status !== 'cancelled' && new Date(value) < new Date()

function LabelCell({ column, value, onChange, readOnly }) {
  const label = labelOf(column, value)
  const labels = column.labels || []
  if (readOnly) return <span className={`cell cell--label tone--${label?.tone || 'neutral'}`}>{label?.text || ''}</span>
  return (
    <label className={`cell cell--label tone--${label?.tone || 'neutral'}`}>
      <span className="visually-hidden">{column.name}</span>
      <span className="truncate">{label?.text || '—'}</span>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label={column.name}>
        <option value="">Not set</option>
        {labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
      </select>
    </label>
  )
}

function DropdownCell({ column, value, onChange, readOnly }) {
  const chosen = Array.isArray(value) ? value : []
  const labels = column.labels || []
  if (readOnly || !labels.length) {
    return <span className="cell cell--chips">{chosen.map((id) => <Tag key={id} label={labelOf(column, id)} />)}</span>
  }
  if (column.multi === false) {
    return <LabelCell column={column} value={chosen[0] || ''} onChange={(v) => onChange(v ? [v] : [])} />
  }
  const toggle = (id) => onChange(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id])
  return (
    <div className="cell cell--chips">
      {chosen.map((id) => (
        <button key={id} type="button" className={`tag tone--${labelOf(column, id)?.tone || 'neutral'}`} onClick={() => toggle(id)}>
          {labelOf(column, id)?.text || id}
          <IconClose width={9} height={9} />
        </button>
      ))}
      <select className="cell__add" value="" onChange={(e) => e.target.value && toggle(e.target.value)} aria-label={`Add to ${column.name}`}>
        <option value="">+</option>
        {labels.filter((l) => !chosen.includes(l.id)).map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
      </select>
    </div>
  )
}

const Tag = ({ label }) => (label ? <span className={`tag tone--${label.tone || 'neutral'}`}>{label.text}</span> : null)

function ChipCell({ value, onChange, readOnly, suggestions = [], placeholder, avatars }) {
  const chosen = Array.isArray(value) ? value : []
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const listId = useMemo(() => `sug-${Math.random().toString(36).slice(2, 8)}`, [])

  const commit = () => {
    const name = draft.trim()
    if (name && !chosen.some((c) => c.toLowerCase() === name.toLowerCase())) onChange([...chosen, name])
    setDraft('')
    setAdding(false)
  }

  return (
    <div className="cell cell--chips">
      {chosen.map((name) => (
        <span key={name} className={avatars ? 'person' : 'tag'} title={name}>
          {avatars ? <span className="avatar" aria-hidden="true">{initials(name)}</span> : null}
          <span className="truncate">{name}</span>
          {!readOnly && (
            <button type="button" className="tag__x" aria-label={`Remove ${name}`} onClick={() => onChange(chosen.filter((c) => c !== name))}>
              <IconClose width={9} height={9} />
            </button>
          )}
        </span>
      ))}
      {!readOnly && (adding ? (
        <>
          <input
            className="cell__input"
            autoFocus
            list={suggestions.length ? listId : undefined}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit() }
              if (e.key === 'Escape') { setDraft(''); setAdding(false) }
            }}
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
          )}
        </>
      ) : (
        <button type="button" className="cell__add" onClick={() => setAdding(true)} aria-label={placeholder}>
          <IconPlus width={10} height={10} />
        </button>
      ))}
    </div>
  )
}

export const initials = (name) =>
  String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?'

function DateCell({ value, onChange, readOnly, overdue }) {
  if (readOnly) return <span className="cell cell--static">{value ? formatDate(value) : ''}</span>
  return (
    <input
      type="date"
      className={`cell cell--date${overdue ? ' cell--overdue' : ''}`}
      value={value ? String(value).slice(0, 10) : ''}
      onChange={(e) => onChange(e.target.value ? `${e.target.value}T09:00:00` : null)}
    />
  )
}

function TimelineCell({ value, onChange, readOnly }) {
  const from = value?.from ? String(value.from).slice(0, 10) : ''
  const to = value?.to ? String(value.to).slice(0, 10) : ''
  if (readOnly) return <span className="cell cell--static">{value ? `${formatDate(value.from)} – ${formatDate(value.to)}` : ''}</span>
  return (
    <span className="cell cell--range">
      <input type="date" aria-label="Start" value={from} onChange={(e) => onChange({ from: e.target.value, to: to || e.target.value })} />
      <span aria-hidden="true">–</span>
      <input type="date" aria-label="End" value={to} onChange={(e) => onChange({ from: from || e.target.value, to: e.target.value })} />
    </span>
  )
}

function CheckCell({ value, onChange, readOnly, label }) {
  return (
    <span className="cell cell--check">
      <button
        type="button"
        className="check"
        data-status={value ? 'done' : 'open'}
        aria-pressed={!!value}
        aria-label={label}
        disabled={readOnly}
        onClick={() => onChange(!value)}
      >
        {value && <IconCheck width={12} height={12} />}
      </button>
    </span>
  )
}

function RatingCell({ value, max, onChange, readOnly, name }) {
  const score = Number(value) || 0
  return (
    <span className="cell cell--rating" role="group" aria-label={name}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          className={`star${i < score ? ' star--on' : ''}`}
          disabled={readOnly}
          aria-label={`${i + 1} of ${max}`}
          aria-pressed={i < score}
          onClick={() => onChange(i + 1 === score ? 0 : i + 1)}
        >
          ★
        </button>
      ))}
    </span>
  )
}

function ProgressCell({ value, onChange, readOnly, name }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0))
  // The slider is the bar: one control, filled to the value it holds.
  const track = `linear-gradient(to right, var(--good) ${pct}%, var(--surface-sunken) ${pct}%)`
  return (
    <span className="cell cell--progress">
      {readOnly ? (
        <span className="progress"><span className="progress__fill" style={{ width: `${pct}%` }} /></span>
      ) : (
        <input
          type="range" min="0" max="100" step="5" value={pct} aria-label={name} style={{ background: track }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )}
      <span className="tabular cell__pct">{pct}%</span>
    </span>
  )
}

/** Formatted while it sits there, raw the moment you edit it. */
function NumberCell({ value, unit, onChange, readOnly, name }) {
  const [draft, setDraft] = useState(null)
  const shown = value === null || value === undefined ? '' : format(value, unit)
  if (readOnly) return <span className="cell cell--static tabular">{shown}</span>
  return (
    <input
      className="cell cell--number tabular"
      inputMode="decimal"
      aria-label={name}
      value={draft ?? shown}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => {
        const field = e.currentTarget
        setDraft(value === null || value === undefined ? '' : String(value))
        // Select the raw number once the swap has rendered - but only if the
        // field is still the one being edited. select() refocuses in Chrome,
        // and stealing focus back from whatever the person moved to is worse
        // than not selecting.
        requestAnimationFrame(() => { if (document.activeElement === field) field.select() })
      }}
      onBlur={() => { if (draft !== null) { onChange(draft === '' ? null : draft); setDraft(null) } }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function TimeCell({ value, onToggle, readOnly }) {
  const [, tick] = useState(0)
  const running = value?.running
  useEffect(() => {
    if (!running) return undefined
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [running])
  const seconds = elapsed(value)
  return (
    <span className="cell cell--time">
      <button type="button" className={`btn btn--sm${running ? ' btn--primary' : ''}`} disabled={readOnly} onClick={onToggle} aria-label={running ? 'Stop the timer' : 'Start the timer'}>
        {running ? <IconStop width={10} height={10} /> : <IconClock width={11} height={11} />}
      </button>
      <span className="tabular">{formatDuration(seconds) || '0s'}</span>
    </span>
  )
}

function LinkCell({ value, onChange, readOnly }) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <span className="cell cell--link">
        {value ? (
          <a href={value.url} target="_blank" rel="noreferrer noopener" className="truncate">
            <IconLink width={10} height={10} /> {value.label || hostOf(value.url)}
          </a>
        ) : <span className="muted">—</span>}
        {!readOnly && <button type="button" className="cell__add" onClick={() => setEditing(true)} aria-label="Edit the link">✎</button>}
      </span>
    )
  }
  return (
    <input
      className="cell__input"
      autoFocus
      defaultValue={value?.url || ''}
      placeholder="https://"
      onBlur={(e) => { onChange(e.target.value ? { url: e.target.value, label: value?.label || '' } : null); setEditing(false) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false) }}
    />
  )
}

const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

function TextCell({ value, onChange, readOnly, name, kind }) {
  const [draft, setDraft] = useState(null)
  if (readOnly) return <span className="cell cell--static truncate">{value}</span>
  return (
    <input
      className="cell cell--text"
      type={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'text'}
      aria-label={name}
      value={draft ?? (value || '')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { onChange(draft); setDraft(null) } }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function LongTextCell({ value, onChange, readOnly, name, onOpen }) {
  const [editing, setEditing] = useState(false)
  const ref = useRef(null)
  if (!editing) {
    return (
      <button type="button" className="cell cell--long truncate" onClick={() => (readOnly ? onOpen?.() : setEditing(true))} title={value}>
        {value || <span className="muted">—</span>}
      </button>
    )
  }
  return (
    <textarea
      ref={ref}
      className="cell cell--longedit"
      autoFocus
      aria-label={name}
      defaultValue={value || ''}
      onBlur={(e) => { onChange(e.target.value); setEditing(false) }}
      onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
    />
  )
}

function DependencyCell({ value, items, onChange, readOnly }) {
  const chosen = Array.isArray(value) ? value : []
  const byId = new Map(items.map((i) => [i.id, i]))
  return (
    <div className="cell cell--chips">
      {chosen.map((id) => (
        <span key={id} className="tag" title={byId.get(id)?.title || id}>
          <span className="truncate" style={{ maxWidth: 110 }}>{byId.get(id)?.title || 'gone'}</span>
          {!readOnly && <button type="button" className="tag__x" aria-label="Remove the dependency" onClick={() => onChange(chosen.filter((c) => c !== id))}><IconClose width={9} height={9} /></button>}
        </span>
      ))}
      {!readOnly && (
        <select
          className="cell__add" value=""
          aria-label="Depends on"
          onChange={(e) => e.target.value && onChange([...chosen, e.target.value])}
        >
          <option value="">+</option>
          {items.filter((i) => !chosen.includes(i.id)).slice(0, 200).map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
        </select>
      )}
    </div>
  )
}
