import { useState } from 'react'
import { getWidget, listWidgets } from '../core/registry.js'
import { moveWidget, removeWidget, updateWidget, addWidget, resetBoard } from '../core/store.js'
import { Card, Overlay, Empty } from './components.jsx'
import { IconUp, IconDown, IconTrash, IconGrid, IconPlus, IconClose } from './icons.jsx'

const SIZES = [
  { value: 'sm', label: 'S' },
  { value: 'md', label: 'M' },
  { value: 'lg', label: 'L' },
  { value: 'xl', label: 'Full' },
]

/**
 * The board renders whatever the saved layout says, and knows nothing about
 * any particular widget. Editing is deliberately buttons rather than drag: it
 * works identically with a mouse, a thumb and a keyboard.
 */
export function Board({ view, items, context, editing }) {
  return (
    <div className="board">
      {items.map((item) => {
        const widget = getWidget(item.widgetId)
        if (!widget) {
          return (
            <div className="board__cell" data-size="sm" key={item.id}>
              <Card title="Missing widget">
                <Empty
                  title={item.widgetId}
                  hint="This widget is not registered. It probably came from a plugin that is no longer loaded."
                  action={<button className="btn btn--sm" onClick={() => removeWidget(view, item.id)}>Remove</button>}
                />
              </Card>
            </div>
          )
        }
        const Component = widget.render
        return (
          <div className="board__cell" data-size={item.size || widget.size} key={item.id}>
            <Card
              title={widget.name}
              tools={
                editing ? (
                  <>
                    <div className="segmented" style={{ marginRight: 4 }}>
                      {SIZES.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          aria-pressed={(item.size || widget.size) === s.value}
                          onClick={() => updateWidget(view, item.id, { size: s.value })}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    <button className="btn btn--icon" title="Move up" onClick={() => moveWidget(view, item.id, -1)}><IconUp /></button>
                    <button className="btn btn--icon" title="Move down" onClick={() => moveWidget(view, item.id, 1)}><IconDown /></button>
                    <button className="btn btn--icon btn--danger" title="Remove" onClick={() => removeWidget(view, item.id)}><IconTrash /></button>
                  </>
                ) : null
              }
            >
              <Component
                {...context}
                widget={widget}
                config={item.config || {}}
                setConfig={(patch) => updateWidget(view, item.id, { config: { ...(item.config || {}), ...patch } })}
              />
            </Card>
          </div>
        )
      })}
    </div>
  )
}

export function BoardControls({ view, editing, onToggleEditing }) {
  const [picking, setPicking] = useState(false)
  return (
    <>
      <button className={`btn btn--sm${editing ? ' btn--primary' : ''}`} onClick={onToggleEditing}>
        <IconGrid width={13} height={13} /> <span className="hide-sm">{editing ? 'Done' : 'Arrange'}</span>
      </button>
      {editing && (
        <>
          <button className="btn btn--sm" onClick={() => setPicking(true)}><IconPlus width={13} height={13} /> Add widget</button>
          <button className="btn btn--sm" onClick={() => resetBoard(view)}>Reset</button>
        </>
      )}
      {picking && <WidgetPicker view={view} onClose={() => setPicking(false)} />}
    </>
  )
}

function WidgetPicker({ view, onClose }) {
  const [query, setQuery] = useState('')
  const widgets = listWidgets().filter((w) =>
    `${w.name} ${w.description} ${w.category}`.toLowerCase().includes(query.toLowerCase())
  )
  const groups = new Map()
  for (const widget of widgets) {
    if (!groups.has(widget.category)) groups.set(widget.category, [])
    groups.get(widget.category).push(widget)
  }

  return (
    <Overlay onClose={onClose} labelledBy="widget-picker-title">
      <header className="sheet__head">
        <h2 id="widget-picker-title" className="card__title">Add a widget</h2>
        <div className="spacer" />
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      <div className="sheet__body">
        <input className="input" placeholder="Search widgets" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        {[...groups.entries()].map(([category, list]) => (
          <div key={category} className="stack" style={{ gap: 'var(--gap-2)' }}>
            <span className="field__label">{category}</span>
            {list.map((widget) => (
              <button
                key={widget.id}
                className="list__item list__item--interactive"
                style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }}
                onClick={() => { addWidget(view, widget.id, widget.size); onClose() }}
              >
                <span className="list__main">
                  <span className="list__title">{widget.name}</span>
                  <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{widget.description}</span>
                </span>
                <IconPlus />
              </button>
            ))}
          </div>
        ))}
        {!widgets.length && <Empty title="No widgets match" />}
      </div>
    </Overlay>
  )
}
