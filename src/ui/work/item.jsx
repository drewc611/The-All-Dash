import { useState } from 'react'
import { Overlay } from '../components.jsx'
import { Cell, initials } from './cells.jsx'
import { subitemsOf } from '../../work/schema.js'
import {
  addSubitem, addUpdate, duplicateItem, likeUpdate, moveItem, moveItemToBoard,
  removeItems, removeUpdate, setItemFields,
} from '../../work/store.js'
import { relative } from '../../core/time.js'
import { IconClose, IconTrash } from '../icons.jsx'

/**
 * One row, opened.
 *
 * Every column, the conversation about it, what changed and when, and its
 * subitems. The updates feed is where @mentions come from; posting one drops a
 * notification in the bell, which is the whole notification system.
 */
export function ItemPanel({ item, board, boards, items, updates, activity, people, onClose, onOpen }) {
  const [tab, setTab] = useState('updates')
  const [draft, setDraft] = useState('')
  const subitems = subitemsOf(items, item.id)
  const parent = item.meta?.parent ? items.find((i) => i.id === item.meta.parent) : null
  const mine = activity.filter((entry) => entry.itemId === item.id)

  const post = () => {
    if (!draft.trim()) return
    addUpdate(item.id, draft)
    setDraft('')
  }

  return (
    <Overlay onClose={onClose} className="sheet sheet--wide witem" labelledBy="witem-title">
      <header className="sheet__head">
        <div className="stack" style={{ gap: 2, minWidth: 0, flex: 1 }}>
          <input
            id="witem-title"
            className="witem__title"
            value={item.title}
            aria-label={`${board.itemNoun} name`}
            onChange={(e) => setItemFields(item.id, { title: e.target.value })}
          />
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            {board.name}
            {parent && <> · subitem of <button type="button" className="linkish" onClick={() => onOpen(parent)}>{parent.title}</button></>}
          </span>
        </div>
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>

      <div className="sheet__body stack">
        <div className="witem__cols">
          <label className="field">
            <span className="field__label">Group</span>
            <select className="select" value={item.meta?.group || ''} onChange={(e) => moveItem(item.id, e.target.value)}>
              {board.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          {board.columns.map((column) => (
            <div key={column.id} className="field">
              <span className="field__label">{column.name}</span>
              <div className="witem__cell">
                <Cell item={item} column={column} board={board} people={people} items={items} onOpen={onOpen} />
              </div>
            </div>
          ))}
        </div>

        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="textarea"
            rows={3}
            value={item.body || ''}
            placeholder="What is this, in a sentence?"
            onChange={(e) => setItemFields(item.id, { body: e.target.value })}
          />
        </label>

        <div className="segmented" role="group" aria-label="Item sections">
          {[['updates', `Updates ${updates.length ? `(${updates.length})` : ''}`], ['subitems', `Subitems ${subitems.length ? `(${subitems.length})` : ''}`], ['activity', 'Activity']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {tab === 'updates' && (
          <div className="stack">
            <div className="witem__compose">
              <textarea
                className="textarea"
                rows={2}
                value={draft}
                placeholder="Write an update. @name mentions someone."
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) post() }}
              />
              <button type="button" className="btn btn--primary" onClick={post} disabled={!draft.trim()}>Post</button>
            </div>
            {updates.length === 0 && <p className="muted" style={{ margin: 0 }}>No updates yet.</p>}
            {updates.map((update) => (
              <article key={update.id} className="wupdate">
                <span className="avatar" aria-hidden="true">{initials(update.author)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row row--between">
                    <strong>{update.author}</strong>
                    <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{relative(update.at)}</span>
                  </div>
                  <p className="wupdate__text">{highlight(update.text)}</p>
                  <div className="row" style={{ gap: 'var(--gap-2)' }}>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => likeUpdate(item.id, update.id)}>♥ {update.likes || 0}</button>
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeUpdate(item.id, update.id)} aria-label="Delete this update"><IconTrash width={11} height={11} /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {tab === 'subitems' && (
          <div className="stack">
            {subitems.map((sub) => (
              <div key={sub.id} className="row row--between wsub">
                <button type="button" className="linkish truncate" onClick={() => onOpen(sub)}>{sub.title}</button>
                <span className="row" style={{ gap: 'var(--gap-2)' }}>
                  <span className="chip">{sub.status}</span>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeItems(sub.id)} aria-label={`Delete ${sub.title}`}><IconTrash width={11} height={11} /></button>
                </span>
              </div>
            ))}
            <AddSubitem onAdd={(title) => addSubitem(item.id, title)} />
          </div>
        )}

        {tab === 'activity' && (
          <div className="stack">
            {mine.length === 0 && <p className="muted" style={{ margin: 0 }}>Nothing has changed yet.</p>}
            {mine.slice(0, 60).map((entry) => (
              <div key={entry.id} className="wactivity">
                <span className="muted tabular">{relative(entry.at)}</span>
                <span><strong>{entry.by}</strong> {entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="sheet__foot">
        <select
          className="select" value="" aria-label="Move to another board"
          onChange={(e) => { if (e.target.value) { moveItemToBoard(item.id, e.target.value); onClose() } }}
        >
          <option value="">Move to board…</option>
          {boards.filter((b) => b.id !== board.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" className="btn" onClick={() => { duplicateItem(item.id); onClose() }}>Duplicate</button>
        <span className="spacer" />
        <button type="button" className="btn btn--danger" onClick={() => { removeItems(item.id); onClose() }}>Delete</button>
      </footer>
    </Overlay>
  )
}

function AddSubitem({ onAdd }) {
  const [value, setValue] = useState('')
  return (
    <div className="row">
      <input
        className="input"
        value={value}
        placeholder="Add a subitem"
        aria-label="Add a subitem"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) { onAdd(value.trim()); setValue('') } }}
      />
      <button type="button" className="btn" disabled={!value.trim()} onClick={() => { onAdd(value.trim()); setValue('') }}>Add</button>
    </div>
  )
}

/** @mentions stand out; everything else is plain text, never HTML. */
function highlight(text) {
  return String(text).split(/(@[\w][\w.'-]{1,40})/g).map((part, i) => (
    part.startsWith('@')
      ? <span key={i} className="mention">{part}</span>
      : <span key={i}>{part}</span>
  ))
}
