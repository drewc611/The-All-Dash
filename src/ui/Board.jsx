import { useMemo, useState } from 'react'
import { getWidget, listWidgets } from '../core/registry.js'
import { moveWidget, removeWidget, updateWidget, addWidget, resetBoard } from '../core/store.js'
import { availableMetrics } from '../engine/metrics.js'
import { q } from '../core/query.js'
import { Card, Overlay, Empty } from './components.jsx'
import { IconUp, IconDown, IconTrash, IconGrid, IconPlus, IconClose, IconSettings } from './icons.jsx'

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
  const [configuring, setConfiguring] = useState(null)

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
        const hasOptions = widget.options?.length > 0
        return (
          <div className="board__cell" data-size={item.size || widget.size} key={item.id}>
            <Card
              title={item.config?.title || widget.name}
              tools={
                <>
                  {hasOptions && (
                    <button className="btn btn--icon" title="Widget settings" onClick={() => setConfiguring(item)}>
                      <IconSettings />
                    </button>
                  )}
                  {editing && (
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
                  )}
                </>
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

      {configuring && (
        <WidgetSettings
          view={view}
          item={items.find((i) => i.id === configuring.id) || configuring}
          widget={getWidget(configuring.widgetId)}
          context={context}
          onClose={() => setConfiguring(null)}
        />
      )}
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

/**
 * Settings for one widget, generated from the `options` it declared. A plugin
 * widget gets this panel for free by describing its fields - no UI to write.
 *
 * Supported option types: text, number, boolean, select (with `choices`),
 * metric (any metric known right now), table (any imported table), tags,
 * people.
 */
function WidgetSettings({ view, item, widget, context, onClose }) {
  const config = item.config || {}
  const set = (key, value) => updateWidget(view, item.id, { config: { ...config, [key]: value } })

  const metrics = useMemo(() => availableMetrics(context.entities, context.state.customMetrics), [context.entities, context.state.customMetrics])
  const tables = useMemo(() => q(context.entityList).type('note').tagged('table').all().filter((e) => e.meta?.table), [context.entityList])
  const tags = useMemo(() => topValues(context.entityList, (e) => e.tags), [context.entityList])
  const people = useMemo(() => topValues(context.entityList, (e) => e.people), [context.entityList])

  return (
    <Overlay onClose={onClose} labelledBy="widget-settings-title">
      <header className="sheet__head">
        <h2 id="widget-settings-title" className="card__title">{widget.name}</h2>
        <div className="spacer" />
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      <div className="sheet__body">
        <p className="muted" style={{ margin: 0 }}>{widget.description}</p>

        <div className="field">
          <label className="field__label" htmlFor="opt-title">Title</label>
          <input
            id="opt-title"
            className="input"
            placeholder={widget.name}
            value={config.title || ''}
            onChange={(e) => set('title', e.target.value)}
          />
        </div>

        {widget.options.map((option) => {
          const id = `opt-${option.key}`
          const value = config[option.key] ?? option.default ?? ''
          const label = <label className="field__label" htmlFor={id}>{option.label || option.key}</label>

          if (option.type === 'boolean') {
            return (
              <label key={option.key} className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(option.key, e.target.checked)} />
                <span>{option.label || option.key}</span>
                {option.hint && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{option.hint}</span>}
              </label>
            )
          }

          if (option.type === 'number') {
            return (
              <div key={option.key} className="field">
                {label}
                <input
                  id={id}
                  className="input"
                  type="number"
                  min={option.min}
                  max={option.max}
                  step={option.step || 1}
                  value={value}
                  onChange={(e) => set(option.key, e.target.value === '' ? null : Number(e.target.value))}
                />
                {option.hint && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{option.hint}</span>}
              </div>
            )
          }

          let choices = null
          if (option.type === 'select') choices = option.choices || []
          if (option.type === 'metric') choices = metrics.map((m) => ({ value: m.id, label: m.name }))
          if (option.type === 'table') choices = tables.map((t) => ({ value: t.id, label: t.title.replace('Table: ', '') }))
          if (option.type === 'tags') choices = tags.map((t) => ({ value: t, label: t }))
          if (option.type === 'people') choices = people.map((p) => ({ value: p, label: p }))

          if (choices) {
            return (
              <div key={option.key} className="field">
                {label}
                <select id={id} className="select" value={value} onChange={(e) => set(option.key, e.target.value)}>
                  <option value="">{option.placeholder || 'Automatic'}</option>
                  {choices.map((c) => <option key={c.value ?? c} value={c.value ?? c}>{c.label ?? c}</option>)}
                </select>
                {option.hint && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{option.hint}</span>}
              </div>
            )
          }

          return (
            <div key={option.key} className="field">
              {label}
              <input id={id} className="input" value={value} placeholder={option.placeholder} onChange={(e) => set(option.key, e.target.value)} />
              {option.hint && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{option.hint}</span>}
            </div>
          )
        })}
      </div>
      <footer className="sheet__foot">
        <button className="btn" onClick={() => updateWidget(view, item.id, { config: {} })}>Reset to defaults</button>
        <div className="spacer" />
        <button className="btn btn--primary" onClick={onClose}>Done</button>
      </footer>
    </Overlay>
  )
}

function topValues(list, pick, limit = 40) {
  const counts = new Map()
  for (const e of list) for (const v of pick(e) || []) counts.set(v, (counts.get(v) || 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([v]) => v)
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
