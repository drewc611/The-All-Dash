import { useState } from 'react'
import { COLUMN_TYPES, LABEL_TONES, typeOf } from '../../work/columns.js'
import { ACTIONS, TRIGGERS, describeAutomation, makeAutomation, recipeCatalogue } from '../../work/automations.js'
import { FILTER_OPS, SUMMARY_NAMES, opsFor } from '../../work/query.js'
import { VIEW_KINDS } from '../../work/schema.js'
import {
  addAutomation, addColumn, addView, removeAutomation, removeColumn, removeView,
  moveColumn, updateAutomation, updateBoard, updateColumn, updateView,
} from '../../work/store.js'
import { Overlay } from '../components.jsx'
import { IconClose, IconPlus, IconTrash } from '../icons.jsx'

/** Everything about a board that is not a row: columns, views, rules. */
export function BoardSettings({ board, boards, view, onClose, onToast }) {
  const [tab, setTab] = useState('columns')
  return (
    <Overlay onClose={onClose} className="sheet sheet--wide" labelledBy="wsettings-title">
      <header className="sheet__head">
        <h2 id="wsettings-title" className="truncate">{board.name}</h2>
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      <div className="sheet__body stack">
        <div className="segmented" role="group" aria-label="Board settings">
          {[['columns', 'Columns'], ['views', 'Views'], ['automations', `Automations (${(board.automations || []).length})`], ['board', 'Board']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === 'columns' && <Columns board={board} view={view} />}
        {tab === 'views' && <Views board={board} />}
        {tab === 'automations' && <Automations board={board} boards={boards} onToast={onToast} />}
        {tab === 'board' && <BoardFields board={board} />}
      </div>
    </Overlay>
  )
}

function Columns({ board, view }) {
  const [kind, setKind] = useState('text')
  const grouped = Object.entries(COLUMN_TYPES).reduce((map, [id, type]) => {
    (map[type.group || 'Other'] ||= []).push([id, type])
    return map
  }, {})
  return (
    <div className="stack">
      {board.columns.map((column, index) => (
        <div key={column.id} className="wsetting">
          <div className="row row--between">
            <span className="row" style={{ gap: 'var(--gap-2)', minWidth: 0 }}>
              <span className="chip mono">{COLUMN_TYPES[column.kind]?.name || column.kind}</span>
              <input
                className="input" value={column.name} aria-label="Column name"
                onChange={(e) => updateColumn(board.id, column.id, { name: e.target.value })}
              />
            </span>
            <span className="row" style={{ gap: 'var(--gap-1)' }}>
              <button type="button" className="btn btn--sm btn--ghost" disabled={index === 0} onClick={() => moveColumn(board.id, column.id, -1)} aria-label="Move left">←</button>
              <button type="button" className="btn btn--sm btn--ghost" disabled={index === board.columns.length - 1} onClick={() => moveColumn(board.id, column.id, 1)} aria-label="Move right">→</button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeColumn(board.id, column.id)} aria-label={`Delete ${column.name}`}><IconTrash width={11} height={11} /></button>
            </span>
          </div>

          <div className="row row--wrap" style={{ gap: 'var(--gap-3)' }}>
            {view && (
              <label className="field">
                <span className="field__label">Summary</span>
                <select
                  className="select select--sm"
                  value={view.config.summaries?.[column.id] || typeOf(column).summaries?.[0] || ''}
                  onChange={(e) => updateView(board.id, view.id, { config: { summaries: { ...(view.config.summaries || {}), [column.id]: e.target.value } } })}
                >
                  <option value="">None</option>
                  {(typeOf(column).summaries || []).map((s) => <option key={s} value={s}>{SUMMARY_NAMES[s] || s}</option>)}
                </select>
              </label>
            )}
            <label className="field">
              <span className="field__label">Width</span>
              <input
                className="input" type="number" min="80" max="480" step="10" value={column.width || 160} style={{ width: 90 }}
                onChange={(e) => updateColumn(board.id, column.id, { width: Number(e.target.value) || 160 })}
              />
            </label>
            {column.kind === 'number' && (
              <label className="field">
                <span className="field__label">Unit</span>
                <select className="select select--sm" value={column.unit || ''} onChange={(e) => updateColumn(board.id, column.id, { unit: e.target.value })}>
                  {['', '$', '%', 'h', 'd', 'pts'].map((u) => <option key={u} value={u}>{u || 'none'}</option>)}
                </select>
              </label>
            )}
            {column.kind === 'formula' && (
              <label className="field" style={{ flex: 1, minWidth: 240 }}>
                <span className="field__label">Formula — {'{Column name}'} references another column</span>
                <input
                  className="input mono" value={column.formula || ''} placeholder="{Budget} * 1.2"
                  onChange={(e) => updateColumn(board.id, column.id, { formula: e.target.value })}
                />
              </label>
            )}
            {column.kind === 'dependency' && (
              <label className="field">
                <span className="field__label">When a predecessor moves</span>
                <select className="select select--sm" value={board.dependencyMode || 'none'} onChange={(e) => updateBoard(board.id, { dependencyMode: e.target.value })}>
                  <option value="none">Do nothing</option>
                  <option value="push">Push the dependent dates</option>
                </select>
              </label>
            )}
          </div>

          {(column.kind === 'status' || column.kind === 'dropdown' || column.kind === 'priority') && (
            <Labels board={board} column={column} />
          )}
        </div>
      ))}

      <div className="row">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="New column type">
          {Object.entries(grouped).map(([group, entries]) => (
            <optgroup key={group} label={group}>
              {entries.map(([id, type]) => <option key={id} value={id}>{type.name}</option>)}
            </optgroup>
          ))}
        </select>
        <button type="button" className="btn btn--primary" onClick={() => addColumn(board.id, kind, COLUMN_TYPES[kind].name)}>
          <IconPlus width={11} height={11} /> Add a column
        </button>
      </div>
    </div>
  )
}

function Labels({ board, column }) {
  const labels = column.labels || []
  const set = (next) => updateColumn(board.id, column.id, { labels: next })
  return (
    <div className="stack" style={{ gap: 'var(--gap-2)' }}>
      <span className="field__label">Labels</span>
      {labels.map((label, i) => (
        <div key={label.id} className="row" style={{ gap: 'var(--gap-2)' }}>
          <input
            className="input" value={label.text} aria-label="Label text"
            onChange={(e) => set(labels.map((l, j) => (j === i ? { ...l, text: e.target.value } : l)))}
          />
          <select
            className="select select--sm" value={label.tone} aria-label="Label colour"
            onChange={(e) => set(labels.map((l, j) => (j === i ? { ...l, tone: e.target.value } : l)))}
          >
            {LABEL_TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {column.kind === 'status' && (
            <select
              className="select select--sm" value={label.maps || 'open'} aria-label="Means"
              onChange={(e) => set(labels.map((l, j) => (j === i ? { ...l, maps: e.target.value } : l)))}
            >
              {['open', 'doing', 'done', 'blocked', 'cancelled'].map((m) => <option key={m} value={m}>means {m}</option>)}
            </select>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => set(labels.filter((_, j) => j !== i))} aria-label={`Delete label ${label.text}`}><IconTrash width={11} height={11} /></button>
        </div>
      ))}
      <button
        type="button" className="btn btn--sm"
        onClick={() => set([...labels, { id: `l${Date.now().toString(36)}`, text: 'New label', tone: 'neutral', maps: 'open', value: 0 }])}
      >
        <IconPlus width={10} height={10} /> Add a label
      </button>
    </div>
  )
}

function Views({ board }) {
  const [kind, setKind] = useState('table')
  return (
    <div className="stack">
      {board.views.map((view) => (
        <div key={view.id} className="row row--between wsetting">
          <span className="row" style={{ gap: 'var(--gap-2)', minWidth: 0 }}>
            <span className="chip mono">{VIEW_KINDS[view.kind]?.name}</span>
            <input className="input" value={view.name} aria-label="View name" onChange={(e) => updateView(board.id, view.id, { name: e.target.value })} />
          </span>
          <button type="button" className="btn btn--sm btn--ghost" disabled={board.views.length < 2} onClick={() => removeView(board.id, view.id)} aria-label={`Delete the view ${view.name}`}><IconTrash width={11} height={11} /></button>
        </div>
      ))}
      <div className="row">
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="New view type">
          {Object.entries(VIEW_KINDS).map(([id, spec]) => <option key={id} value={id}>{spec.name} — {spec.hint}</option>)}
        </select>
        <button type="button" className="btn btn--primary" onClick={() => addView(board.id, kind, VIEW_KINDS[kind].name)}>
          <IconPlus width={11} height={11} /> Add a view
        </button>
      </div>
    </div>
  )
}

function Automations({ board, boards, onToast }) {
  const [building, setBuilding] = useState(null)
  const recipes = recipeCatalogue(board)
  return (
    <div className="stack">
      {(board.automations || []).map((automation) => (
        <div key={automation.id} className="wsetting">
          <div className="row row--between">
            <label className="row" style={{ gap: 'var(--gap-2)' }}>
              <input
                type="checkbox" checked={automation.enabled !== false}
                onChange={(e) => updateAutomation(board.id, automation.id, { enabled: e.target.checked })}
                aria-label="Enabled"
              />
              <span>{describeAutomation(board, automation, boards)}</span>
            </label>
            <span className="row" style={{ gap: 'var(--gap-1)' }}>
              <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{automation.runs || 0} runs</span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setBuilding(automation)}>Edit</button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeAutomation(board.id, automation.id)} aria-label="Delete this rule"><IconTrash width={11} height={11} /></button>
            </span>
          </div>
        </div>
      ))}

      {building ? (
        <Builder
          board={board}
          boards={boards}
          automation={building}
          onCancel={() => setBuilding(null)}
          onSave={(next) => {
            if ((board.automations || []).some((a) => a.id === next.id)) updateAutomation(board.id, next.id, next)
            else addAutomation(board.id, next)
            setBuilding(null)
            onToast?.('Rule saved', 'good')
          }}
        />
      ) : (
        <>
          <span className="field__label">Start from a recipe</span>
          {recipes.map((recipe) => (
            <button
              key={recipe.id} type="button" className="btn btn--ghost wrecipe"
              onClick={() => { addAutomation(board.id, recipe.build()); onToast?.('Rule added', 'good') }}
            >
              <IconPlus width={11} height={11} /> {recipe.title}
            </button>
          ))}
          <button type="button" className="btn" onClick={() => setBuilding(makeAutomation({ trigger: { kind: 'item-created' } }))}>
            Build one from scratch
          </button>
        </>
      )}
    </div>
  )
}

function Builder({ board, boards, automation, onSave, onCancel }) {
  const [draft, setDraft] = useState(automation)
  const patch = (next) => setDraft({ ...draft, ...next })
  const trigger = draft.trigger || {}
  const triggerColumn = board.columns.find((c) => c.id === trigger.columnId)

  return (
    <div className="wsetting stack">
      <span className="field__label">When</span>
      <div className="row row--wrap">
        <select className="select" value={trigger.kind} aria-label="Trigger" onChange={(e) => patch({ trigger: { kind: e.target.value } })}>
          {Object.entries(TRIGGERS).map(([id, spec]) => <option key={id} value={id}>{spec.name}</option>)}
        </select>
        {(TRIGGERS[trigger.kind]?.needs || []).map((need) => (
          <NeedField
            key={need} need={need} board={board} boards={boards} value={trigger}
            onChange={(next) => patch({ trigger: { ...trigger, ...next } })}
            column={triggerColumn}
          />
        ))}
      </div>

      <span className="field__label">Only if</span>
      {(draft.conditions || []).map((condition, i) => {
        const column = board.columns.find((c) => c.id === condition.columnId)
        return (
          <div key={i} className="row row--wrap">
            <select
              className="select" value={condition.columnId || ''} aria-label="Condition column"
              onChange={(e) => patch({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, columnId: e.target.value } : c)) })}
            >
              {board.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="select" value={condition.op || 'is'} aria-label="Condition test"
              onChange={(e) => patch({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, op: e.target.value } : c)) })}
            >
              {opsFor(column).map((op) => <option key={op} value={op}>{FILTER_OPS[op].name}</option>)}
            </select>
            {FILTER_OPS[condition.op || 'is']?.needsValue && (
              <ValueField
                column={column} value={condition.value}
                onChange={(value) => patch({ conditions: draft.conditions.map((c, j) => (j === i ? { ...c, value } : c)) })}
              />
            )}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => patch({ conditions: draft.conditions.filter((_, j) => j !== i) })} aria-label="Remove this condition"><IconTrash width={11} height={11} /></button>
          </div>
        )
      })}
      <button type="button" className="btn btn--sm" onClick={() => patch({ conditions: [...(draft.conditions || []), { columnId: board.columns[0]?.id, op: 'is', value: '' }] })}>
        <IconPlus width={10} height={10} /> Add a condition
      </button>

      <span className="field__label">Then</span>
      {(draft.actions || []).map((action, i) => {
        const column = board.columns.find((c) => c.id === action.columnId)
        return (
          <div key={i} className="row row--wrap">
            <select
              className="select" value={action.kind} aria-label="Action"
              onChange={(e) => patch({ actions: draft.actions.map((a, j) => (j === i ? { kind: e.target.value } : a)) })}
            >
              {Object.entries(ACTIONS).map(([id, spec]) => <option key={id} value={id}>{spec.name}</option>)}
            </select>
            {(ACTIONS[action.kind]?.needs || []).map((need) => (
              <NeedField
                key={need} need={need} board={board} boards={boards} value={action} column={column}
                onChange={(next) => patch({ actions: draft.actions.map((a, j) => (j === i ? { ...a, ...next } : a)) })}
              />
            ))}
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })} aria-label="Remove this action"><IconTrash width={11} height={11} /></button>
          </div>
        )
      })}
      <button type="button" className="btn btn--sm" onClick={() => patch({ actions: [...(draft.actions || []), { kind: 'notify', text: '{item} changed' }] })}>
        <IconPlus width={10} height={10} /> Add an action
      </button>

      <div className="row">
        <button type="button" className="btn btn--primary" onClick={() => onSave(draft)}>Save the rule</button>
        <button type="button" className="btn btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>{describeAutomation(board, draft, boards)}</p>
    </div>
  )
}

/** One input for one thing a trigger or action still needs. */
function NeedField({ need, board, boards, value, onChange, column }) {
  if (need.startsWith('column')) {
    const kind = need.split(':')[1]
    const choices = kind ? board.columns.filter((c) => c.kind === kind) : board.columns
    return (
      <select className="select" value={value.columnId || ''} aria-label="Column" onChange={(e) => onChange({ columnId: e.target.value })}>
        <option value="">any column</option>
        {choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    )
  }
  if (need === 'label') {
    return (
      <select className="select" value={value.value || ''} aria-label="Label" onChange={(e) => onChange({ value: e.target.value })}>
        <option value="">any label</option>
        {(column?.labels || []).map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
      </select>
    )
  }
  if (need === 'group') {
    return (
      <select className="select" value={value.groupId || ''} aria-label="Group" onChange={(e) => onChange({ groupId: e.target.value })}>
        <option value="">any group</option>
        {board.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    )
  }
  if (need === 'board') {
    return (
      <select className="select" value={value.boardId || board.id} aria-label="Board" onChange={(e) => onChange({ boardId: e.target.value })}>
        {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    )
  }
  if (need === 'offset') {
    return (
      <label className="field">
        <span className="field__label">Days before (negative) or after</span>
        <input className="input" type="number" style={{ width: 90 }} value={value.offset ?? 0} onChange={(e) => onChange({ offset: Number(e.target.value) || 0 })} />
      </label>
    )
  }
  if (need === 'days') {
    return <input className="input" type="number" style={{ width: 90 }} aria-label="Days" value={value.days ?? 1} onChange={(e) => onChange({ days: Number(e.target.value) || 0 })} />
  }
  if (need === 'person') {
    return <input className="input" aria-label="Person" placeholder="Name" value={value.person || ''} onChange={(e) => onChange({ person: e.target.value })} />
  }
  if (need === 'value') {
    return <ValueField column={column} value={value.value} onChange={(next) => onChange({ value: next })} />
  }
  return (
    <input
      className="input" style={{ flex: 1, minWidth: 180 }} aria-label="Text"
      placeholder="Text — {item}, {board}, {value}"
      value={value.text || ''} onChange={(e) => onChange({ text: e.target.value })}
    />
  )
}

function ValueField({ column, value, onChange }) {
  if (column?.labels?.length) {
    return (
      <select className="select" value={value || ''} aria-label="Value" onChange={(e) => onChange(e.target.value)}>
        <option value="">empty</option>
        {column.labels.map((l) => <option key={l.id} value={l.id}>{l.text}</option>)}
      </select>
    )
  }
  if (column?.kind === 'checkbox') {
    return (
      <select className="select" value={String(value ?? 'true')} aria-label="Value" onChange={(e) => onChange(e.target.value === 'true')}>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    )
  }
  return <input className="input" aria-label="Value" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
}

function BoardFields({ board }) {
  return (
    <div className="stack">
      <label className="field">
        <span className="field__label">Board name</span>
        <input className="input" value={board.name} onChange={(e) => updateBoard(board.id, { name: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">What is it for?</span>
        <textarea className="textarea" rows={2} value={board.description} onChange={(e) => updateBoard(board.id, { description: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">A row is called a…</span>
        <input className="input" value={board.itemNoun} onChange={(e) => updateBoard(board.id, { itemNoun: e.target.value })} />
      </label>
      <label className="field">
        <span className="field__label">Colour</span>
        <select className="select" value={board.tone} onChange={(e) => updateBoard(board.id, { tone: e.target.value })}>
          {['accent', 'good', 'warning', 'serious', 'critical', 'neutral'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>
    </div>
  )
}
