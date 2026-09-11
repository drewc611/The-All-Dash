import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { platformConfig } from '../../platform/client.js'
import { corpus, usage, available } from '../../stash/archive.js'
import { buildIndex, search as runSearch, snippet } from '../../stash/search.js'
import { stripMarkdown } from '../../stash/readable.js'
import { stashKind, stashState, dueForCheck, KIND_LABEL } from '../../stash/schema.js'
import { savePage, saveIdea, forget, setState, toggleStar, recheck } from '../../stash/store.js'
import { formatBytes } from '../../media/schema.js'
import { Empty } from '../components.jsx'
import { Reader } from './Reader.jsx'
import { IconStar, IconEye, IconInbox, IconBulb, IconGlobe, IconArchive, IconRefresh, IconPlus } from '../icons.jsx'

const FILTERS = [
  { id: 'inbox', label: 'To read', Icon: IconInbox },
  { id: 'starred', label: 'Starred', Icon: IconStar },
  { id: 'watching', label: 'Watching', Icon: IconEye },
  { id: 'ideas', label: 'Ideas', Icon: IconBulb },
  { id: 'archived', label: 'Archive', Icon: IconArchive },
  { id: 'all', label: 'Everything', Icon: IconGlobe },
]

const matches = (entity, filter) => {
  const state = stashState(entity)
  if (filter === 'inbox') return state === 'inbox' && stashKind(entity) === 'page'
  if (filter === 'starred') return !!entity.meta?.starred
  if (filter === 'watching') return !!entity.meta?.watching
  if (filter === 'ideas') return stashKind(entity) === 'idea'
  if (filter === 'archived') return state === 'archived'
  return state !== 'archived'
}

/**
 * The stash.
 *
 * Pocket kept a link and a title. This keeps the article, which is why the
 * search box searches the words in the piece rather than its headline, why a
 * page can be compared against the version you read, and why none of it stops
 * working when the site does.
 */
export function Stash({ entities, onToast, onOpen }) {
  const [filter, setFilter] = useState('inbox')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(null)
  const [indexing, setIndexing] = useState(false)
  const [reading, setReading] = useState(null)
  const [meter, setMeter] = useState(null)
  const [saving, setSaving] = useState(false)
  const [url, setUrl] = useState('')
  const [composing, setComposing] = useState(null)
  const [error, setError] = useState('')
  const { configured } = platformConfig()

  const items = useMemo(
    () => entities.filter((e) => e.type === 'page').sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [entities],
  )

  const visible = useMemo(() => items.filter((e) => matches(e, filter)), [items, filter])
  const due = useMemo(() => dueForCheck(items), [items])

  // The index is built from the archive, not from the store: the store holds
  // excerpts, and searching excerpts is what Pocket did.
  const rebuild = useCallback(async () => {
    if (!available() || !items.length) return setIndex(buildIndex([]))
    setIndexing(true)
    try {
      const ids = items.map((e) => e.meta?.snapshotId).filter(Boolean)
      const texts = await corpus(ids)
      const bySnapshot = new Map(texts.map((t) => [t.id, t]))
      // Indexed as prose, not as source: nobody searches for "##", and a
      // snippet that shows heading markers mid-sentence reads as a bug.
      setIndex(buildIndex(items.map((e) => ({
        id: e.id,
        title: e.title,
        text: stripMarkdown(bySnapshot.get(e.meta?.snapshotId)?.text || e.body || ''),
      }))))
    } catch {
      setIndex(buildIndex([]))
    } finally {
      setIndexing(false)
    }
  }, [items])

  useEffect(() => { rebuild() }, [rebuild])
  useEffect(() => { if (available()) usage().then(setMeter).catch(() => setMeter(null)) }, [items.length])

  const results = useMemo(() => {
    if (!query.trim() || !index) return null
    const hits = runSearch(index, query, { limit: 60 })
    const byId = new Map(items.map((e) => [e.id, e]))
    return hits.map((hit) => ({ entity: byId.get(hit.id), doc: hit.doc })).filter((r) => r.entity)
  }, [query, index, items])

  async function onSave(event) {
    event?.preventDefault()
    const target = url.trim()
    if (!target || saving) return
    setSaving(true)
    setError('')
    try {
      const { entity, fresh, changed } = await savePage(target)
      setUrl('')
      onToast?.(fresh ? `Saved “${entity.title}”` : changed ? 'Already saved, and it has changed since' : 'Already saved, nothing has changed')
      if (!fresh) setReading(entity)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onCheckAll() {
    let changed = 0
    for (const entity of due) {
      try {
        const result = await recheck(entity)
        if (result.changed) changed += 1
      } catch { /* one dead site does not stop the round */ }
    }
    onToast?.(changed ? `${changed} page${changed === 1 ? '' : 's'} changed` : 'Nothing has changed')
  }

  async function onForget(entity) {
    await forget(entity)
    setReading(null)
    onToast?.('Deleted, text and all')
  }

  return (
    <div className="stack">
      {!configured && (
        <div className="stash__notice">
          <strong>Saving a page needs the platform tier.</strong>
          <span className="muted">
            A browser cannot fetch another site — CORS forbids it, and most sites refuse to be
            embedded — so the backend fetches it once and hands back the text. Point at it in
            Settings → Platform. Everything you have already saved reads offline without it.
          </span>
        </div>
      )}

      <form className="stash__save" onSubmit={onSave}>
        <input
          className="input stash__url"
          value={url}
          type="url"
          placeholder="Paste a link to save it, text and all"
          aria-label="Link to save"
          disabled={!configured}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!configured || saving || !url.trim()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={() => setComposing({ title: '', body: '' })}>
          <IconPlus width={12} height={12} /> Write an idea
        </button>
      </form>

      {error && <p className="cam__error" role="alert">{error}</p>}

      <div className="row row--wrap stash__filters">
        {FILTERS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className="chip chip--button"
            aria-pressed={filter === id}
            onClick={() => { setFilter(id); setQuery('') }}
          >
            <Icon width={11} height={11} /> {label}
            <span className="muted"> {items.filter((e) => matches(e, id)).length}</span>
          </button>
        ))}

        <span className="spacer" />

        {configured && due.length > 0 && (
          <button type="button" className="btn btn--sm" onClick={onCheckAll}>
            <IconRefresh width={12} height={12} /> Check {due.length} watched page{due.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <div className="row row--wrap">
        <input
          className="input stash__search"
          type="search"
          value={query}
          placeholder={`Search the words inside ${items.length} saved item${items.length === 1 ? '' : 's'}`}
          aria-label="Search saved text"
          onChange={(e) => setQuery(e.target.value)}
        />
        {meter && (
          <span className="muted">
            {formatBytes(meter.bytes)} archived{indexing ? ' · indexing…' : ''}
          </span>
        )}
      </div>

      {results ? (
        results.length ? (
          <div className="stash__list">
            {results.map(({ entity, doc }) => (
              <Row key={entity.id} entity={entity} query={query} text={doc?.text} onRead={() => setReading(entity)} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <Empty title="Nothing matches" hint={`No saved item contains that. Quotes force an exact phrase: "down step".`} />
        )
      ) : visible.length ? (
        <div className="stash__list">
          {visible.map((entity) => (
            <Row key={entity.id} entity={entity} onRead={() => setReading(entity)} onOpen={onOpen} />
          ))}
        </div>
      ) : (
        <Empty
          title={filter === 'inbox' ? 'Nothing left to read' : `Nothing in ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()}`}
          hint="Paste a link above and the whole article is kept here, readable offline, searchable by its words, and still yours if the page goes away."
        />
      )}

      {reading && (
        <Reader entity={items.find((e) => e.id === reading.id) || reading} onClose={() => setReading(null)} onToast={onToast} onForget={onForget} />
      )}

      {composing && (
        <Compose
          draft={composing}
          onCancel={() => setComposing(null)}
          onSave={async (draft) => {
            const entity = await saveIdea(draft)
            setComposing(null)
            setFilter('ideas')
            onToast?.('Saved')
            return entity
          }}
        />
      )}
    </div>
  )
}

function Row({ entity, query, text, onRead, onOpen }) {
  const meta = entity.meta || {}
  const kind = stashKind(entity)
  const state = stashState(entity)
  const found = query && text ? snippet(text, query) : null

  return (
    <article className={`srow${state === 'inbox' ? ' is-unread' : ''}`}>
      <button type="button" className="srow__main" onClick={onRead}>
        <span className="srow__title">{entity.title}</span>

        {found ? (
          <span className="srow__snippet">{mark(found)}</span>
        ) : (
          entity.body && <span className="srow__excerpt">{entity.body}</span>
        )}

        <span className="srow__meta">
          {kind === 'idea' ? <><IconBulb width={11} height={11} /> {KIND_LABEL.idea}</> : meta.site}
          {meta.minutes ? ` · ${meta.minutes} min` : ''}
          {meta.watching ? ' · watching' : ''}
          {meta.versions?.length > 1 ? ` · ${meta.versions.length} versions` : ''}
          {meta.highlights?.length ? ` · ${meta.highlights.length} highlight${meta.highlights.length === 1 ? '' : 's'}` : ''}
        </span>
      </button>

      <div className="srow__tools">
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Star" aria-pressed={!!meta.starred} onClick={() => toggleStar(entity)}><IconStar width={12} height={12} /></button>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label={state === 'archived' ? 'Unarchive' : 'Archive'} onClick={() => setState(entity, state === 'archived' ? 'read' : 'archived')}><IconArchive width={12} height={12} /></button>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Open the record" onClick={() => onOpen?.(entity)}><IconGlobe width={12} height={12} /></button>
      </div>
    </article>
  )
}

/** The matched words, wrapped so they can be highlighted. */
function mark({ text, marks }) {
  if (!marks?.length) return text
  const out = []
  let at = 0
  marks.forEach(([start, end], i) => {
    if (start < at) return
    if (start > at) out.push(text.slice(at, start))
    out.push(<mark key={i}>{text.slice(start, end)}</mark>)
    at = end
  })
  if (at < text.length) out.push(text.slice(at))
  return out
}

function Compose({ draft, onCancel, onSave }) {
  const [title, setTitle] = useState(draft.title)
  const [body, setBody] = useState(draft.body)
  const field = useRef(null)
  useEffect(() => { field.current?.focus() }, [])

  return (
    <div className="stash__compose">
      <input
        ref={field}
        className="input stash__composetitle"
        value={title}
        placeholder="What is the idea?"
        aria-label="Title"
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="textarea"
        rows={6}
        value={body}
        placeholder="The rest of it. This is searched the same way an article is."
        aria-label="Body"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={!title.trim()} onClick={() => onSave({ title: title.trim(), body })}>Save</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
