/*
 * YouTube links.
 *
 * Parsing is separated from playing so the hard part - the seven URL shapes
 * Google has shipped over the years - is a pure function with tests, and the
 * player is a thin iframe wrapper around it.
 *
 * Embeds use youtube-nocookie.com. It still contacts Google when a video
 * plays, which is why this whole surface is behind an explicit opt-in, but it
 * does not set tracking cookies for someone who merely opens the view.
 */

const ID = /^[A-Za-z0-9_-]{11}$/
const LIST = /^[A-Za-z0-9_-]{12,42}$/

const HOSTS = new Set([
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be',
])

/**
 * Seconds from a YouTube time string: "90", "1m30s", "1h2m3s", "2:30".
 * Returns 0 for anything it cannot read, never NaN.
 */
export function parseTime(raw) {
  const text = String(raw ?? '').trim().toLowerCase()
  if (!text) return 0
  if (/^\d+$/.test(text)) return Number(text)
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/)
  if (clock) return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  const parts = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!parts || !(parts[1] || parts[2] || parts[3])) return 0
  return Number(parts[1] || 0) * 3600 + Number(parts[2] || 0) * 60 + Number(parts[3] || 0)
}

/**
 * Pull the video id, playlist and start time out of anything a person might
 * paste: a watch URL, a share link, a Shorts link, an embed, a music link,
 * or a bare eleven-character id.
 *
 * Returns null when there is no video in there, so a caller can tell "not a
 * YouTube link" from "a YouTube link I failed to read".
 */
export function parseYouTube(input) {
  const text = String(input ?? '').trim()
  if (!text) return null
  if (ID.test(text)) return { id: text, list: null, start: 0 }

  let url
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
  } catch { return null }

  const host = url.hostname.toLowerCase()
  if (!HOSTS.has(host)) return null

  const segments = url.pathname.split('/').filter(Boolean)
  let id = null

  if (host.endsWith('youtu.be')) {
    id = segments[0] || null
  } else if (segments[0] === 'watch') {
    id = url.searchParams.get('v')
  } else if (['embed', 'v', 'shorts', 'live'].includes(segments[0])) {
    id = segments[1] || null
  } else if (url.searchParams.get('v')) {
    id = url.searchParams.get('v')
  }

  // "/embed/videoseries?list=..." is a playlist with no single video.
  if (id && !ID.test(id)) id = null
  const list = url.searchParams.get('list')
  if (!id && !list) return null

  const start = parseTime(url.searchParams.get('t') || url.searchParams.get('start') || '')
  return { id, list: list && LIST.test(list) ? list : null, start }
}

/** The privacy-enhanced embed URL, with the options the player needs. */
export function embedUrl({ id, list = null, start = 0, autoplay = false, origin = '' } = {}) {
  // Checked here, not only where a link was parsed. A video id can reach this
  // from a restored workspace without ever going through parse(), and
  // thumbnails() has always checked - there is no reason for the frame to be
  // the one place that does not.
  const video = ID.test(String(id || '')) ? String(id) : null
  const playlist = LIST.test(String(list || '')) ? String(list) : null
  if (!video && !playlist) return ''
  const base = video
    ? `https://www.youtube-nocookie.com/embed/${video}`
    : 'https://www.youtube-nocookie.com/embed/videoseries'
  const params = new URLSearchParams({
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
    enablejsapi: '1',
  })
  if (playlist) params.set('list', playlist)
  if (start > 0) params.set('start', String(Math.floor(start)))
  if (autoplay) params.set('autoplay', '1')
  // Without a matching origin the IFrame API refuses postMessage in Chrome.
  if (origin) params.set('origin', origin)
  return `${base}?${params}`
}

/** Thumbnails are on i.ytimg.com and need no key. maxres does not exist for
    every video, so the caller gets a fallback chain, not one URL. */
export function thumbnails(id) {
  if (!ID.test(String(id || ''))) return []
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
  ]
}

export const watchUrl = (id, start = 0) =>
  (ID.test(String(id || ''))
    ? `https://www.youtube.com/watch?v=${id}${start > 0 ? `&t=${Math.floor(start)}` : ''}`
    : '')
