/*
 * Saved things.
 *
 * A saved article and an idea you typed are the same kind of record: an
 * entity of type "page", with the text in IndexedDB and a pointer here. That
 * makes a saved article an ordinary item everywhere else in the app - it can
 * be triaged, put on a board, cited by the assistant - which is the part
 * Pocket never had. A saved link there was a dead end.
 */

import { makeEntity } from '../data/schema.js'
import { canonicalUrl, siteName, readingMinutes } from './readable.js'

export const STASH_KINDS = ['page', 'idea']

export const KIND_LABEL = { page: 'Saved page', idea: 'Idea' }

/** Where a saved item sits in the flow: unread, read, or put away. */
export const STASH_STATES = ['inbox', 'read', 'archived']

const clean = (s, n = 400) => String(s ?? '').trim().slice(0, n)

/**
 * A stash record.
 *
 * `versions` is the history that makes watching work: every re-fetch appends
 * one, and the newest is what you read. `snapshotId` always names the newest.
 */
export function stashEntity({
  id,
  kind = 'page',
  title,
  url = '',
  site = '',
  byline = '',
  excerpt = '',
  words = 0,
  snapshotId = null,
  versions = [],
  state = 'inbox',
  starred = false,
  watching = false,
  highlights = [],
  tags = [],
  people = [],
  at = null,
  readAt = null,
  checkedAt = null,
  meta = {},
  source = null,
}) {
  const type = STASH_KINDS.includes(kind) ? kind : 'page'
  const when = at || new Date().toISOString()
  const canonical = type === 'page' ? canonicalUrl(url) || clean(url, 2000) : ''
  const host = site || siteName(canonical)
  return makeEntity({
    id,
    type: 'page',
    title: clean(title) || host || 'Untitled',
    body: clean(excerpt, 2000),
    at: when,
    tags: [type === 'idea' ? 'idea' : 'saved', ...tags],
    people,
    meta: {
      ...meta,
      kind: type,
      url: canonical,
      site: host,
      byline: clean(byline, 200),
      words: Number(words) || 0,
      minutes: readingMinutes(words),
      snapshotId,
      versions,
      state: STASH_STATES.includes(state) ? state : 'inbox',
      starred: !!starred,
      watching: !!watching,
      highlights,
      readAt,
      checkedAt,
    },
    source: source || {
      docId: canonical || id,
      name: type === 'idea' ? 'Written here' : host || 'Saved page',
      kind: type === 'idea' ? 'manual' : 'stash',
      url: canonical || null,
    },
  })
}

export const isStash = (e) => e?.type === 'page'
export const stashKind = (e) => (STASH_KINDS.includes(e?.meta?.kind) ? e.meta.kind : 'page')
export const stashState = (e) => (STASH_STATES.includes(e?.meta?.state) ? e.meta.state : 'inbox')
export const isUnread = (e) => isStash(e) && stashState(e) === 'inbox'

/** Newest version first, so `versions[0]` is always what you would read. */
export function addVersion(versions, version) {
  const list = [version, ...(versions || [])]
  // Twenty is already more history than anyone reads, and each one is text.
  return list.slice(0, 20)
}

/** Every snapshot id this record still refers to, for garbage collection. */
export function liveSnapshotIds(entities) {
  const ids = []
  for (const e of entities || []) {
    if (!isStash(e)) continue
    if (e.meta?.snapshotId) ids.push(e.meta.snapshotId)
    for (const version of e.meta?.versions || []) if (version?.id) ids.push(version.id)
  }
  return [...new Set(ids)]
}

/** A highlight is a quote plus an optional note, anchored by its text rather
    than an offset: offsets do not survive the page being re-fetched. */
export function makeHighlight({ id, quote, note = '', at = null }) {
  return {
    id,
    quote: clean(quote, 2000),
    note: clean(note, 1000),
    at: at || new Date().toISOString(),
  }
}

/** How long since a watched page was last checked, in hours. */
export function hoursSince(iso, now = Date.now()) {
  const then = Date.parse(iso || '')
  if (!Number.isFinite(then)) return Infinity
  return (now - then) / 3_600_000
}

/** Which watched pages are due a re-check. Deliberately gentle: this hits
    someone else's server, and nothing here is urgent. */
export function dueForCheck(entities, { everyHours = 12, now = Date.now(), limit = 5 } = {}) {
  return (entities || [])
    .filter((e) => isStash(e) && e.meta?.watching && e.meta?.url)
    .filter((e) => hoursSince(e.meta.checkedAt, now) >= everyHours)
    .sort((a, b) => hoursSince(b.meta?.checkedAt, now) - hoursSince(a.meta?.checkedAt, now))
    .slice(0, limit)
}
