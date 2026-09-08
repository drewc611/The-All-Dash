import { useMemo } from 'react'
import { updateUi } from '../core/store.js'
import { IconClose } from './icons.jsx'

/**
 * Scope the whole board to a person or a tag with one tap. Chips are derived
 * from what is actually in the data, most common first, so a project with
 * three people shows three chips and nothing else.
 */
export function FilterBar({ entityList, ui }) {
  const people = useMemo(() => top(entityList, (e) => e.people, 8), [entityList])
  const tags = useMemo(() => {
    const fileTags = fileDerivedTags(entityList)
    return top(entityList, (e) => e.tags.filter((t) => !NOISE.has(t) && !fileTags.has(t)), 8)
  }, [entityList])
  if (!people.length && !tags.length) return null

  const toggle = (key, value) => {
    const current = ui[key] || []
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value]
    updateUi({ [key]: next })
  }
  const active = (ui.filterPeople?.length || 0) + (ui.filterTags?.length || 0)

  return (
    <div className="filterbar" role="group" aria-label="Filters">
      {people.map((p) => (
        <button
          key={`p:${p}`}
          className="chip chip--button"
          aria-pressed={ui.filterPeople?.includes(p) || false}
          onClick={() => toggle('filterPeople', p)}
        >
          {p}
        </button>
      ))}
      {people.length > 0 && tags.length > 0 && <span className="filterbar__sep" />}
      {tags.map((t) => (
        <button
          key={`t:${t}`}
          className="chip chip--button"
          aria-pressed={ui.filterTags?.includes(t) || false}
          onClick={() => toggle('filterTags', t)}
        >
          #{t}
        </button>
      ))}
      {active > 0 && (
        <button className="chip chip--button chip--accent" onClick={() => updateUi({ filterPeople: [], filterTags: [] })}>
          <IconClose width={11} height={11} /> Clear
        </button>
      )}
    </div>
  )
}

const NOISE = new Set(['notes', 'calendar', 'transcript', 'attendee', 'table', 'action-items', 'metrics', 'decisions', 'risks', 'timeline', 'open-questions', 'all-day', 'json', 'question', 'docx', 'pptx', 'markdown'])

/** Tags that are just the slug of the file they came from - "atlas-backlog"
    from Atlas backlog.csv - identify a source, not a topic. */
function fileDerivedTags(list) {
  const out = new Set()
  for (const e of list) {
    const name = e.source?.name
    if (!name) continue
    const slug = name.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    for (const t of e.tags) if (t === slug || t.startsWith(`${slug}-`)) out.add(t)
  }
  return out
}

function top(list, pick, limit) {
  const counts = new Map()
  for (const e of list) {
    if (e.type === 'person' || e.type === 'doc') continue
    for (const v of pick(e) || []) counts.set(v, (counts.get(v) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v)
}

/** Apply the active filters. A filter with nothing selected passes everything. */
export function applyFilters(entityList, ui) {
  const people = (ui.filterPeople || []).map((p) => p.toLowerCase())
  const tags = (ui.filterTags || []).map((t) => t.toLowerCase())
  if (!people.length && !tags.length) return entityList
  return entityList.filter((e) => {
    if (e.type === 'doc') return true
    const personOk = !people.length || e.people.some((p) => people.includes(p.toLowerCase()))
    const tagOk = !tags.length || e.tags.some((t) => tags.includes(t.toLowerCase()))
    return personOk && tagOk
  })
}
