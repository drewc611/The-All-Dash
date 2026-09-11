/*
 * Media records.
 *
 * A recording, a photo and a YouTube link are all entities of type "media".
 * That is the whole integration: they show up in the Library, on the
 * Timeline, in search, in the command bar and on a board, and none of those
 * had to learn what a video is. meta.blobId points into IndexedDB for local
 * files; meta.youtubeId names a remote one.
 */

import { makeEntity } from '../data/schema.js'

export const MEDIA_KINDS = ['video', 'audio', 'photo', 'youtube']

export const KIND_LABEL = {
  video: 'Video',
  audio: 'Audio',
  photo: 'Photo',
  youtube: 'YouTube',
}

/** Bytes, at the precision a person actually reads. */
export function formatBytes(n) {
  const bytes = Number(n)
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1 }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** Seconds as clock time: 9:05, or 1:09:05 once it runs past an hour. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** "68% smaller", or "12% bigger" when a re-encode went the wrong way. */
export function savings(before, after) {
  const from = Number(before)
  const to = Number(after)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0) return null
  const ratio = (from - to) / from
  return {
    ratio,
    percent: Math.round(Math.abs(ratio) * 100),
    smaller: to < from,
    label: to < from ? `${Math.round(ratio * 100)}% smaller` : `${Math.round(-ratio * 100)}% bigger`,
  }
}

const clean = (s) => String(s ?? '').trim()

/**
 * Build the entity for a piece of media.
 *
 * The id is explicit rather than content-hashed: two photos taken a second
 * apart share a title and would otherwise collide into one record.
 */
export function mediaEntity({
  id,
  kind,
  title,
  blobId = null,
  youtubeId = null,
  mimeType = '',
  size = 0,
  duration = 0,
  width = 0,
  height = 0,
  poster = null,
  at = null,
  tags = [],
  people = [],
  body = '',
  meta = {},
  source = null,
}) {
  const type = MEDIA_KINDS.includes(kind) ? kind : 'video'
  const when = at || new Date().toISOString()
  return makeEntity({
    id,
    type: 'media',
    title: clean(title) || `${KIND_LABEL[type]} ${when.slice(0, 10)}`,
    body: clean(body),
    at: when,
    tags: [type, ...tags],
    people,
    meta: {
      ...meta,
      kind: type,
      blobId,
      youtubeId,
      mimeType,
      size: Number(size) || 0,
      duration: Number(duration) || 0,
      width: Number(width) || 0,
      height: Number(height) || 0,
      poster,
    },
    source: source || {
      docId: blobId || youtubeId || id,
      name: youtubeId ? 'YouTube' : 'Recorded here',
      kind: youtubeId ? 'youtube' : 'capture',
      url: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : null,
    },
  })
}

export const isMedia = (e) => e?.type === 'media'
export const mediaKind = (e) => (MEDIA_KINDS.includes(e?.meta?.kind) ? e.meta.kind : 'video')
export const isPlayableAudio = (e) => isMedia(e) && (mediaKind(e) === 'audio' || mediaKind(e) === 'video')

/** Every blob id the workspace still refers to, for garbage collection. */
export function liveBlobIds(entities) {
  const ids = []
  for (const e of entities || []) {
    if (!isMedia(e)) continue
    if (e.meta?.blobId) ids.push(e.meta.blobId)
    if (e.meta?.posterId) ids.push(e.meta.posterId)
  }
  return ids
}
