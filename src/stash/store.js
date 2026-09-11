/*
 * Stash operations.
 *
 * One place where the fetch, the archive and the workspace are composed, so a
 * view never has to know that saving a page is three writes that can each
 * fail on their own.
 */

import { getState, mutate, addEntity, updateEntity, removeEntity } from '../core/store.js'
import { webScrape } from '../platform/client.js'
import { uid } from '../core/id.js'
import { putSnapshot, getSnapshot, deleteSnapshot } from './archive.js'
import { readablePage, canonicalUrl } from './readable.js'
import { fingerprint, diffBlocks } from './diff.js'
import { stashEntity, addVersion, makeHighlight, isStash, liveSnapshotIds } from './schema.js'

const all = (state = getState()) => Object.values(state.entities || {})

export const stashItems = (state = getState()) => all(state).filter(isStash)

/** Already saved? Matching on the canonical url means the same article from a
    newsletter and from a chat is recognised as one thing. */
export function findByUrl(url, state = getState()) {
  const target = canonicalUrl(url)
  if (!target) return null
  return stashItems(state).find((e) => e.meta?.url === target) || null
}

/**
 * Save a page.
 *
 * The platform tier fetches it once. Everything after that is local: the text
 * lands in IndexedDB and the record points at it, so the page reads offline
 * forever even if the backend, the site or this app goes away.
 *
 * Saving something already saved does not duplicate it - it takes a new
 * version, which is what makes the change view work.
 */
export async function savePage(url, { signal, tags = [] } = {}) {
  const target = canonicalUrl(url)
  if (!target) throw new Error('That is not a web address.')

  const existing = findByUrl(target)
  const page = await webScrape(target, { signal })
  const markdown = String(page?.markdown || '').trim()
  if (!markdown) throw new Error('That page came back empty. It may need JavaScript to render.')

  const readable = readablePage({
    url: page.final_url || target,
    markdown,
    title: page.title,
    byline: page.metadata?.author || page.metadata?.byline || '',
  })
  const print = fingerprint(markdown)
  const snapshotId = uid('snap')

  if (existing) {
    // Nothing changed: record that it was checked and leave the text alone.
    const previous = existing.meta?.versions?.[0]
    if (previous?.fingerprint === print) {
      updateEntity(existing.id, { meta: { ...existing.meta, checkedAt: new Date().toISOString() } })
      return { entity: existing, changed: false, fresh: false }
    }
    await putSnapshot(snapshotId, { entityId: existing.id, url: target, markdown, title: readable.title, fingerprint: print })
    const versions = addVersion(existing.meta?.versions, { id: snapshotId, at: new Date().toISOString(), bytes: markdown.length, fingerprint: print })
    updateEntity(existing.id, {
      meta: {
        ...existing.meta,
        snapshotId,
        versions,
        words: readable.words,
        minutes: readable.minutes,
        checkedAt: new Date().toISOString(),
      },
    })
    return { entity: getState().entities[existing.id], changed: !!previous, fresh: false }
  }

  const id = uid('stash')
  await putSnapshot(snapshotId, { entityId: id, url: target, markdown, title: readable.title, fingerprint: print })
  const entity = stashEntity({
    id,
    kind: 'page',
    title: readable.title,
    url: target,
    site: readable.site,
    byline: readable.byline,
    excerpt: readable.excerpt,
    words: readable.words,
    snapshotId,
    versions: [{ id: snapshotId, at: new Date().toISOString(), bytes: markdown.length, fingerprint: print }],
    checkedAt: new Date().toISOString(),
    tags,
  })
  addEntity(entity)
  return { entity, changed: false, fresh: true }
}

/** Something you wrote, kept the same way as something you read. */
export async function saveIdea({ title, body = '', tags = [] }) {
  const text = String(body || '').trim()
  const id = uid('stash')
  const snapshotId = uid('snap')
  const markdown = `# ${String(title || 'Untitled').trim()}\n\n${text}`
  await putSnapshot(snapshotId, { entityId: id, url: '', markdown, title, fingerprint: fingerprint(markdown) })
  const entity = stashEntity({
    id,
    kind: 'idea',
    title,
    excerpt: text.slice(0, 400),
    words: text.split(/\s+/).filter(Boolean).length,
    snapshotId,
    versions: [{ id: snapshotId, at: new Date().toISOString(), bytes: markdown.length }],
    tags,
  })
  addEntity(entity)
  return entity
}

/** The text of a saved item, for reading or for the search index. */
export async function readText(entity, versionId = null) {
  const id = versionId || entity?.meta?.snapshotId
  const snapshot = await getSnapshot(id)
  return snapshot?.markdown || ''
}

/**
 * Fetch a watched page again and say what changed.
 *
 * Returns the diff without writing anything when nothing moved, so a page
 * that has not changed does not grow a version every twelve hours.
 */
export async function recheck(entity, { signal } = {}) {
  const url = entity?.meta?.url
  if (!url) throw new Error('There is nothing to re-check: this item has no address.')

  const page = await webScrape(url, { signal })
  const markdown = String(page?.markdown || '').trim()
  if (!markdown) throw new Error('That page came back empty this time.')

  const print = fingerprint(markdown)
  const now = new Date().toISOString()
  const previous = entity.meta?.versions?.[0]

  if (previous?.fingerprint === print) {
    updateEntity(entity.id, { meta: { ...entity.meta, checkedAt: now } })
    return { changed: false, diff: null }
  }

  const before = await readText(entity)
  const diff = diffBlocks(before, markdown)
  const snapshotId = uid('snap')
  await putSnapshot(snapshotId, { entityId: entity.id, url, markdown, title: entity.title, fingerprint: print })

  updateEntity(entity.id, {
    meta: {
      ...entity.meta,
      snapshotId,
      versions: addVersion(entity.meta?.versions, { id: snapshotId, at: now, bytes: markdown.length, fingerprint: print }),
      checkedAt: now,
      changedAt: diff.changed ? now : entity.meta?.changedAt || null,
      // Something you had read that has since moved is worth seeing again.
      state: diff.changed && entity.meta?.state === 'read' ? 'inbox' : entity.meta?.state,
    },
  })
  return { changed: diff.changed, diff }
}

/** The diff between two stored versions, for the history list. */
export async function diffVersions(entity, olderId, newerId) {
  const [older, newer] = await Promise.all([getSnapshot(olderId), getSnapshot(newerId)])
  return diffBlocks(older?.markdown || '', newer?.markdown || '')
}

/* ------------------------------------------------------------- small edits */

const patchMeta = (entity, patch) => updateEntity(entity.id, { meta: { ...entity.meta, ...patch } })

export const setState = (entity, state) =>
  patchMeta(entity, { state, readAt: state === 'read' ? new Date().toISOString() : entity.meta?.readAt || null })

export const toggleStar = (entity) => patchMeta(entity, { starred: !entity.meta?.starred })
export const toggleWatch = (entity) => patchMeta(entity, { watching: !entity.meta?.watching })

export function addHighlight(entity, { quote, note = '' }) {
  const highlight = makeHighlight({ id: uid('hl'), quote, note })
  if (!highlight.quote) return null
  patchMeta(entity, { highlights: [...(entity.meta?.highlights || []), highlight] })
  return highlight
}

export const removeHighlight = (entity, highlightId) =>
  patchMeta(entity, { highlights: (entity.meta?.highlights || []).filter((h) => h.id !== highlightId) })

/** Delete the record and the text behind every version of it. */
export async function forget(entity) {
  for (const version of entity.meta?.versions || []) {
    if (version?.id) await deleteSnapshot(version.id).catch(() => {})
  }
  if (entity.meta?.snapshotId) await deleteSnapshot(entity.meta.snapshotId).catch(() => {})
  removeEntity(entity.id)
}

/** Bulk state change, in one store write rather than one per item. */
export function setStateMany(ids, state) {
  const when = new Date().toISOString()
  mutate((s) => {
    const entities = { ...s.entities }
    for (const id of ids) {
      const entity = entities[id]
      if (!entity || !isStash(entity)) continue
      entities[id] = {
        ...entity,
        meta: { ...entity.meta, state, readAt: state === 'read' ? when : entity.meta?.readAt || null },
        updatedAt: when,
      }
    }
    return { ...s, entities }
  })
}

export { liveSnapshotIds }
