import { useEffect, useRef } from 'react'
import { cycleTaskStatus, nextTaskStatus } from '../core/store.js'
import { formatDate, formatTime, relative } from '../core/time.js'
import { format } from '../core/format.js'
import { IconCheck, IconClose, IconDash } from './icons.jsx'

/** Shared building blocks. Everything visual in the app is made of these. */

export function Card({ title, subtitle, tools, children, flush, footer }) {
  return (
    <section className="card">
      {(title || tools) && (
        <header className="card__head">
          <div style={{ minWidth: 0 }}>
            <h3 className="card__title truncate">{title}</h3>
            {subtitle && <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{subtitle}</div>}
          </div>
          {tools && <div className="card__tools">{tools}</div>}
        </header>
      )}
      <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>
      {footer && <footer className="card__head" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>{footer}</footer>}
    </section>
  )
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => {
        const key = option.value ?? option
        return (
          <button
            key={key}
            type="button"
            aria-pressed={key === value}
            onClick={() => onChange(key)}
          >
            {option.label ?? option}
          </button>
        )
      })}
    </div>
  )
}

export function Empty({ title, hint, action }) {
  return (
    <div className="empty">
      <span className="empty__title">{title}</span>
      {hint && <span style={{ maxWidth: '38ch' }}>{hint}</span>}
      {action}
    </div>
  )
}

const STATUS_MARK = {
  done: IconCheck,
  doing: IconDash,
  blocked: IconClose,
}

const STATUS_WORD = { open: 'open', doing: 'in progress', done: 'done' }

export function TaskRow({ entity, onOpen, showDate = true }) {
  const Mark = STATUS_MARK[entity.status]
  const overdue = entity.due && entity.status !== 'done' && new Date(entity.due) < new Date()
  const next = STATUS_WORD[nextTaskStatus(entity.status)]
  return (
    <div className={`list__item list__item--interactive${entity.status === 'done' ? ' done' : ''}`}>
      <button
        type="button"
        className="check"
        data-status={entity.status}
        aria-label={`Mark "${entity.title}" as ${next}`}
        onClick={(e) => { e.stopPropagation(); cycleTaskStatus(entity.id) }}
      >
        {Mark && <Mark width={12} height={12} />}
      </button>
      <button type="button" className="list__main" onClick={() => onOpen?.(entity)} style={{ background: 'none', textAlign: 'left' }}>
        <span className="list__title">{entity.title}</span>
        <span className="list__meta">
          {entity.people.slice(0, 2).map((p) => <span key={p}>{p}</span>)}
          {entity.priority > 0 && <span className={`chip chip--${entity.priority > 1 ? 'critical' : 'warning'}`}>{entity.priority > 1 ? 'Urgent' : 'High'}</span>}
          {entity.tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}
          {showDate && entity.due && (
            <span style={overdue ? { color: 'var(--critical)', fontWeight: 600 } : undefined}>
              {overdue ? 'Overdue ' : 'Due '}{formatDate(entity.due)}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}

export function EventRow({ entity, onOpen }) {
  const soon = new Date(entity.at) - Date.now()
  return (
    <button type="button" className="list__item list__item--interactive" onClick={() => onOpen?.(entity)}>
      <span className="list__side tabular" style={{ width: 58, flexDirection: 'column', alignItems: 'flex-start', gap: 0, whiteSpace: 'nowrap' }}>
        <strong style={{ color: 'var(--ink)', fontSize: 'var(--t-sm)' }}>{formatTime(entity.at)}</strong>
        <span>{entity.end ? `${Math.round((new Date(entity.end) - new Date(entity.at)) / 60000)}m` : ''}</span>
      </span>
      <span className="list__main">
        <span className="list__title">{entity.title}</span>
        <span className="list__meta">
          {entity.meta?.location && <span className="truncate" style={{ maxWidth: 160 }}>{entity.meta.location}</span>}
          {entity.people.length > 0 && <span>{entity.people.length} attending</span>}
          {soon > 0 && soon < 3600000 && <span className="chip chip--accent">Starts {relative(entity.at)}</span>}
        </span>
      </span>
    </button>
  )
}

export function GenericRow({ entity, onOpen }) {
  return (
    <button type="button" className="list__item list__item--interactive" onClick={() => onOpen?.(entity)}>
      <span className="list__main">
        <span className="list__title clamp-2">
          {entity.title}
          {entity.type === 'metric' && (
            <strong className="tabular" style={{ marginLeft: 8 }}>{format(entity.value, entity.unit)}</strong>
          )}
        </span>
        <span className="list__meta">
          <span className="chip">{entity.type}</span>
          {entity.people.slice(0, 2).map((p) => <span key={p}>{p}</span>)}
          {entity.at && <span>{formatDate(entity.at)}</span>}
          {entity.source?.name && <span className="truncate" style={{ maxWidth: 140 }}>{entity.source.name}</span>}
        </span>
      </span>
    </button>
  )
}

export function EntityList({ entities, onOpen, empty, limit = 50 }) {
  if (!entities.length) return empty || <Empty title="Nothing here yet" />
  return (
    <div className="list">
      {entities.slice(0, limit).map((entity) => {
        if (entity.type === 'task') return <TaskRow key={entity.id} entity={entity} onOpen={onOpen} />
        if (entity.type === 'event') return <EventRow key={entity.id} entity={entity} onOpen={onOpen} />
        return <GenericRow key={entity.id} entity={entity} onOpen={onOpen} />
      })}
    </div>
  )
}

/** Escape-to-close, focus-trapped overlay used by the inspector and pickers. */
export function Overlay({ onClose, children, className = 'sheet', labelledBy }) {
  const ref = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key !== 'Tab' || !ref.current) return
      const focusable = ref.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    ref.current?.querySelector('input, button')?.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className={className} ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </div>
    </>
  )
}
