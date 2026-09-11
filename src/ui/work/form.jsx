import { useState } from 'react'
import { typeOf, writeCell } from '../../work/columns.js'
import { createItem, updateView } from '../../work/store.js'
import { Cell } from './cells.jsx'
import { makeEntity } from '../../data/schema.js'
import { itemDraft } from '../../work/schema.js'

/**
 * A fillable form that adds a row.
 *
 * It reuses the same cell editors the table uses, against a draft item held in
 * component state, so a form field behaves exactly like the column it writes.
 * Everything stays in this browser: the link opens this app, on this device.
 */
export function FormView({ board, view, people, editing, onToast }) {
  const [draft, setDraft] = useState(() => blank(board))
  const [done, setDone] = useState(false)
  const fields = (view.config.fields?.length ? view.config.fields : board.columns.map((c) => c.id))
    .map((id) => board.columns.find((c) => c.id === id))
    .filter((c) => c && !typeOf(c).readOnly)

  const submit = (event) => {
    event.preventDefault()
    const title = draft.title.trim()
    if (!title) return
    const created = createItem(board.id, view.config.groupId || board.groups[0]?.id, {
      title,
      status: draft.status,
      priority: draft.priority,
      people: draft.people,
      tags: draft.tags,
      due: draft.due,
      at: draft.at,
      end: draft.end,
      meta: { columns: draft.meta.columns },
    })
    if (created) {
      setDraft(blank(board))
      setDone(true)
      onToast?.(`Added "${title}"`, 'good')
    }
  }

  return (
    <div className="wform-wrap">
      {editing && (
        <div className="card">
          <div className="card__body stack">
            <span className="field__label">Fields on this form</span>
            <div className="row row--wrap">
              {board.columns.filter((c) => !typeOf(c).readOnly).map((column) => {
                const on = fields.some((f) => f.id === column.id)
                return (
                  <label key={column.id} className="chip chip--button">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const current = fields.map((f) => f.id)
                        updateView(board.id, view.id, {
                          config: { fields: on ? current.filter((id) => id !== column.id) : [...current, column.id] },
                        })
                      }}
                    />
                    {column.name}
                  </label>
                )
              })}
            </div>
            <label className="field">
              <span className="field__label">New submissions land in</span>
              <select
                className="select"
                value={view.config.groupId || board.groups[0]?.id || ''}
                onChange={(e) => updateView(board.id, view.id, { config: { groupId: e.target.value } })}
              >
                {board.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}

      <form className="card wform" onSubmit={submit}>
        <div className="card__body stack">
          <h2 className="wform__title">{view.name}</h2>
          {board.description && <p className="secondary" style={{ margin: 0 }}>{board.description}</p>}
          <label className="field">
            <span className="field__label">{board.itemNoun} name</span>
            <input
              className="input"
              value={draft.title}
              required
              placeholder={`What is the ${board.itemNoun.toLowerCase()}?`}
              onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDone(false) }}
            />
          </label>
          {fields.map((column) => (
            <div key={column.id} className="field">
              <span className="field__label">{column.name}</span>
              <div className="wform__cell">
                <Cell
                  item={draft}
                  column={column}
                  board={board}
                  people={people}
                  items={[]}
                  onOpen={() => {}}
                  onWrite={(col, value) => {
                    const patch = writeCell(draft, col, value, board)
                    if (!patch) return
                    setDraft({ ...draft, ...patch, meta: { ...draft.meta, ...(patch.meta || {}), columns: { ...draft.meta.columns, ...(patch.meta?.columns || {}) } } })
                  }}
                  key={`${column.id}-${draft.id}`}
                />
              </div>
            </div>
          ))}
          <div className="row">
            <button type="submit" className="btn btn--primary">Submit</button>
            {done && <span className="chip chip--good">Added</span>}
          </div>
        </div>
      </form>
    </div>
  )
}

/**
 * The draft is a real entity, so the cell editors work unchanged - but it must
 * not reach the store until submit, so its writes are held in local state.
 */
function blank(board) {
  const entity = makeEntity(itemDraft(board, board.groups[0]?.id, { title: '' }))
  return { ...entity, title: '' }
}
