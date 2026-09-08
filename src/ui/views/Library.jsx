import { useMemo, useState } from 'react'
import { q } from '../../core/query.js'
import { removeDoc } from '../../core/store.js'
import { ENTITY_TYPES, TYPE_LABEL } from '../../data/schema.js'
import { relative } from '../../core/time.js'
import { EntityList, Empty } from '../components.jsx'
import { FilePicker } from '../Intake.jsx'
import { IconTrash, IconUpload, IconDoc, IconSearch } from '../icons.jsx'

/**
 * Everything that has been read, and everything it produced. This is the
 * accountability view: if a widget shows something surprising, you come here
 * to find which file it came from and delete it if it was wrong.
 */
export function Library({ entityList, docs, onOpen, onFiles }) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [docFilter, setDocFilter] = useState(null)

  const rows = useMemo(() => {
    let query = q(entityList).where((e) => e.type !== 'doc')
    if (type !== 'all') query = query.type(type)
    if (docFilter) query = query.where((e) => e.source?.docId === docFilter)
    return query.search(search).sort('createdAt', 'desc').take(200)
  }, [entityList, search, type, docFilter])

  const counts = useMemo(() => {
    const map = new Map()
    for (const e of entityList) {
      if (e.type === 'doc') continue
      map.set(e.type, (map.get(e.type) || 0) + 1)
    }
    return map
  }, [entityList])

  return (
    <div className="stack">
      <div className="row row--wrap">
        <div className="row" style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <IconSearch className="muted" style={{ position: 'absolute', left: 9, pointerEvents: 'none' }} />
          <input
            className="input"
            style={{ paddingLeft: 30 }}
            placeholder="Search every item"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Type">
          <option value="all">All types</option>
          {ENTITY_TYPES.filter((t) => t !== 'doc' && counts.get(t)).map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]} ({counts.get(t)})</option>
          ))}
        </select>
        <FilePicker onFiles={onFiles} className="btn btn--primary"><IconUpload width={13} height={13} /> Import</FilePicker>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 280px) minmax(0, 1fr)', gap: 'var(--gap-4)', alignItems: 'start' }} className="library-split">
        <section className="card">
          <header className="card__head"><h3 className="card__title">Documents</h3></header>
          {!docs.length ? (
            <Empty title="Nothing imported yet" hint="Drop a file anywhere on this page." />
          ) : (
            <div className="list">
              <button
                className="list__item list__item--interactive"
                onClick={() => setDocFilter(null)}
                style={docFilter === null ? { background: 'var(--accent-soft)' } : undefined}
              >
                <span className="list__main"><span className="list__title">Everything</span></span>
                <span className="list__side">{entityList.filter((e) => e.type !== 'doc').length}</span>
              </button>
              {docs.map((doc) => (
                <div key={doc.id} className="list__item" style={docFilter === doc.id ? { background: 'var(--accent-soft)' } : undefined}>
                  <IconDoc className="muted" style={{ marginTop: 3, flex: 'none' }} />
                  <button className="list__main" onClick={() => setDocFilter(doc.id)} style={{ textAlign: 'left' }}>
                    <span className="list__title truncate">{doc.title}</span>
                    <span className="list__meta">
                      <span className="chip">{doc.meta?.kind}</span>
                      <span>{doc.meta?.produced} items</span>
                      <span>{relative(doc.at)}</span>
                    </span>
                  </button>
                  <button
                    className="btn btn--icon btn--danger btn--sm"
                    title={`Remove ${doc.title} and everything it produced`}
                    aria-label={`Remove ${doc.title} and everything it produced`}
                    onClick={() => { removeDoc(doc.id); if (docFilter === doc.id) setDocFilter(null) }}
                  >
                    <IconTrash width={13} height={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <header className="card__head">
            <h3 className="card__title">{rows.length} {rows.length === 1 ? 'item' : 'items'}</h3>
            {docFilter && (
              <button className="btn btn--sm" style={{ marginLeft: 'auto' }} onClick={() => setDocFilter(null)}>Clear document filter</button>
            )}
          </header>
          <EntityList
            entities={rows}
            onOpen={onOpen}
            limit={200}
            empty={<Empty title="No items match" hint="Try a different type or clear the search." />}
          />
        </section>
      </div>
    </div>
  )
}
