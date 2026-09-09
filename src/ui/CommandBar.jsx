import { useEffect, useMemo, useRef, useState } from 'react'
import { listCommands } from '../core/registry.js'
import { q } from '../core/query.js'
import { Overlay } from './components.jsx'
import { IconSearch, IconChevron } from './icons.jsx'
import { formatDate } from '../core/time.js'

/**
 * Command bar: actions and content in one list.
 *
 * Typing searches every entity you have as well as every registered command,
 * so "revenue" finds the metric and "add task" finds the action without any
 * mode switch.
 */
export function CommandBar({ entities, onClose, onOpen, navigate }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  const results = useMemo(() => {
    const commands = listCommands()
      .filter((c) => match(`${c.name} ${c.hint || ''} ${(c.keywords || []).join(' ')}`, query))
      .map((c) => ({ kind: 'command', id: c.id, group: c.group, label: c.name, hint: c.hint, run: c }))

    const found = query.trim()
      ? q(entities).search(query).sort('updatedAt', 'desc').take(12).map((e) => ({
        kind: 'entity',
        id: e.id,
        group: 'Results',
        label: e.title,
        hint: `${e.type}${e.at ? ` - ${formatDate(e.at)}` : ''}`,
        entity: e,
      }))
      : []

    return [...commands.slice(0, query.trim() ? 6 : 20), ...found]
  }, [entities, query])

  useEffect(() => setIndex(0), [query])

  const choose = (result) => {
    if (!result) return
    if (result.kind === 'command') result.run.run({ navigate, close: onClose })
    else onOpen(result.entity)
    onClose()
  }

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
    if (event.key === 'Enter') { event.preventDefault(); choose(results[index]) }
  }

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  let lastGroup = null

  return (
    <Overlay onClose={onClose} className="palette" labelledBy="palette-label">
      <span id="palette-label" className="visually-hidden">Command bar</span>
      <div className="row" style={{ padding: '0 var(--gap-4)', borderBottom: '1px solid var(--line)' }}>
        <IconSearch className="muted" />
        <input
          className="palette__input"
          style={{ borderBottom: 0 }}
          placeholder="Search everything, or run a command"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
      </div>
      <div className="palette__results" ref={listRef}>
        {results.map((result, i) => {
          const header = result.group !== lastGroup ? result.group : null
          lastGroup = result.group
          return (
            <div key={`${result.kind}:${result.id}`}>
              {header && <div className="palette__group">{header}</div>}
              <button
                type="button"
                className="palette__item"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(result)}
              >
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span className="truncate" style={{ display: 'block', fontWeight: 520 }}>{result.label}</span>
                  {result.hint && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{result.hint}</span>}
                </span>
                <IconChevron className="muted" width={13} height={13} />
              </button>
            </div>
          )
        })}
        {!results.length && <div className="empty"><span>Nothing matches &ldquo;{query}&rdquo;</span></div>}
      </div>
    </Overlay>
  )
}

function match(haystack, needle) {
  const text = String(needle).trim().toLowerCase()
  if (!text) return true
  return text.split(/\s+/).every((term) => haystack.toLowerCase().includes(term))
}
