/*
 * The player.
 *
 * One <audio> element, created here and never mounted into React. That is
 * the whole trick behind "music keeps playing while I work": a component
 * that owns the element stops the music the moment you change view, so the
 * element lives in the module and React only ever reads its state.
 *
 * Queue arithmetic is separated from the element so it can be tested without
 * a browser, and so shuffle does not mean "mutate the list the person built".
 */

import { getBlob } from './blobs.js'

/* --------------------------------------------------------- queue arithmetic */

/** A play order. Shuffle keeps the queue itself untouched and reorders the
    path through it, with the current track pinned first so turning shuffle on
    does not skip what is playing. */
export function buildOrder(length, { shuffle = false, current = 0 } = {}) {
  const order = Array.from({ length }, (_, i) => i)
  if (!shuffle || length < 2) return order
  const rest = order.filter((i) => i !== current)
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return current >= 0 && current < length ? [current, ...rest] : rest
}

/**
 * Where "next" goes. Returns an index, or null when the queue is finished.
 * repeat: 'off' stops at the end, 'all' wraps, 'one' stays put.
 */
export function nextIndex({ order = [], index = 0, repeat = 'off' }, { manual = false } = {}) {
  if (!order.length) return null
  // A person pressing skip on repeat-one means the next track, not this one
  // again; only the track ending naturally repeats.
  if (repeat === 'one' && !manual) return index
  const at = order.indexOf(index)
  const position = at === -1 ? 0 : at
  if (position + 1 < order.length) return order[position + 1]
  return repeat === 'off' ? null : order[0]
}

export function prevIndex({ order = [], index = 0 }) {
  if (!order.length) return null
  const at = order.indexOf(index)
  if (at <= 0) return order[order.length - 1]
  return order[at - 1]
}

/* ------------------------------------------------------------- the element */

const initial = () => ({
  queue: [],
  order: [],
  index: -1,
  playing: false,
  time: 0,
  duration: 0,
  volume: 1,
  muted: false,
  repeat: 'off',
  shuffle: false,
  error: '',
  loading: false,
})

let state = initial()
const listeners = new Set()
let audio = null
let objectUrl = null
let token = 0

const emit = () => { for (const fn of listeners) fn() }
const set = (patch) => { state = { ...state, ...patch }; emit() }

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const getSnapshot = () => state
/** Server render and the initial hydration pass share one frozen value. */
const SERVER = initial()
export const getServerSnapshot = () => SERVER

function element() {
  if (audio || typeof document === 'undefined') return audio
  audio = document.createElement('audio')
  audio.preload = 'metadata'
  audio.addEventListener('timeupdate', () => set({ time: audio.currentTime }))
  audio.addEventListener('durationchange', () => {
    set({ duration: Number.isFinite(audio.duration) ? audio.duration : 0 })
  })
  audio.addEventListener('play', () => { set({ playing: true }); syncSession() })
  audio.addEventListener('pause', () => { set({ playing: false }); syncSession() })
  audio.addEventListener('ended', () => { skip({ manual: false }) })
  audio.addEventListener('error', () => {
    if (state.index >= 0) set({ error: 'That track could not be played.', playing: false, loading: false })
  })
  audio.addEventListener('canplay', () => set({ loading: false }))
  return audio
}

function releaseUrl() {
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null }
}

/** Load the track at an index and start it. Guarded by a token so a fast
    double-skip cannot let a slow IndexedDB read overwrite a newer track. */
async function load(index, { autoplay = true } = {}) {
  const el = element()
  const track = state.queue[index]
  if (!el || !track) return
  const mine = ++token
  set({ index, error: '', loading: true, time: 0 })

  try {
    let src = track.url || ''
    if (!src && track.blobId) {
      const blob = await getBlob(track.blobId)
      if (mine !== token) return
      if (!blob) throw new Error('missing')
      releaseUrl()
      objectUrl = URL.createObjectURL(blob)
      src = objectUrl
    }
    if (!src) throw new Error('missing')
    if (mine !== token) return
    el.src = src
    el.volume = state.volume
    el.muted = state.muted
    if (autoplay) await el.play()
    syncSession()
  } catch (err) {
    if (mine !== token) return
    set({
      loading: false,
      playing: false,
      error: err?.name === 'NotAllowedError'
        ? 'The browser blocked playback until you press play.'
        : 'That track is no longer in storage.',
    })
  }
}

/* ---------------------------------------------------------------- commands */

/** Replace the queue and start at one track. */
export function playNow(tracks, startIndex = 0) {
  const queue = (tracks || []).filter(Boolean)
  if (!queue.length) return
  const index = Math.min(Math.max(0, startIndex), queue.length - 1)
  state = { ...state, queue, index, error: '' }
  set({ order: buildOrder(queue.length, { shuffle: state.shuffle, current: index }) })
  load(index)
}

export function enqueue(tracks) {
  const add = (tracks || []).filter(Boolean)
  if (!add.length) return
  const queue = [...state.queue, ...add]
  set({ queue, order: buildOrder(queue.length, { shuffle: state.shuffle, current: state.index }) })
  if (state.index === -1) load(0)
}

export function removeAt(position) {
  const queue = state.queue.filter((_, i) => i !== position)
  if (!queue.length) return stop()
  let index = state.index
  if (position < index) index -= 1
  else if (position === index) index = Math.min(index, queue.length - 1)
  set({ queue, index, order: buildOrder(queue.length, { shuffle: state.shuffle, current: index }) })
  if (position === state.index) load(index)
}

export function toggle() {
  const el = element()
  if (!el || state.index === -1) return
  if (el.paused) el.play().catch(() => set({ error: 'The browser blocked playback.' }))
  else el.pause()
}

export function skip({ manual = true } = {}) {
  const next = nextIndex(state, { manual })
  if (next === null) return stop()
  // Repeat-one on a natural end: rewind rather than reload the same blob.
  if (next === state.index && !manual) {
    const el = element()
    if (el) { el.currentTime = 0; el.play().catch(() => {}) }
    return
  }
  load(next)
}

export function back() {
  const el = element()
  // The universal convention: back within the first few seconds goes to the
  // previous track, later it restarts this one.
  if (el && el.currentTime > 3) { el.currentTime = 0; return }
  const prev = prevIndex(state)
  if (prev !== null) load(prev)
}

export function seek(seconds) {
  const el = element()
  if (el && Number.isFinite(seconds)) el.currentTime = Math.max(0, seconds)
}

export function setVolume(value) {
  const volume = Math.min(1, Math.max(0, Number(value) || 0))
  const el = element()
  if (el) el.volume = volume
  set({ volume, muted: volume === 0 ? state.muted : false })
}

export function toggleMute() {
  const el = element()
  const muted = !state.muted
  if (el) el.muted = muted
  set({ muted })
}

export function setRepeat(mode) {
  set({ repeat: ['off', 'all', 'one'].includes(mode) ? mode : 'off' })
}

export function cycleRepeat() {
  setRepeat({ off: 'all', all: 'one', one: 'off' }[state.repeat])
}

export function toggleShuffle() {
  const shuffle = !state.shuffle
  set({ shuffle, order: buildOrder(state.queue.length, { shuffle, current: state.index }) })
}

export function stop() {
  token += 1
  const el = element()
  if (el) { el.pause(); el.removeAttribute('src'); el.load() }
  releaseUrl()
  set({ ...initial(), volume: state.volume, muted: state.muted, repeat: state.repeat, shuffle: state.shuffle })
  syncSession()
}

export const currentTrack = () => state.queue[state.index] || null

/* ------------------------------------------------------- OS media controls */

/** Lock screen, media keys and headset buttons, where the browser has them. */
function syncSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  const track = currentTrack()
  const session = navigator.mediaSession
  if (!track) { session.metadata = null; session.playbackState = 'none'; return }
  try {
    session.metadata = new window.MediaMetadata({
      title: track.title || 'Untitled',
      artist: track.artist || 'The All Dash',
      album: track.album || '',
      artwork: track.artwork || [],
    })
    session.playbackState = state.playing ? 'playing' : 'paused'
    const handlers = {
      play: () => toggle(),
      pause: () => toggle(),
      nexttrack: () => skip(),
      previoustrack: () => back(),
      seekto: (e) => seek(e.seekTime),
      stop: () => stop(),
    }
    for (const [action, fn] of Object.entries(handlers)) {
      try { session.setActionHandler(action, fn) } catch { /* unsupported action */ }
    }
  } catch { /* MediaMetadata is missing in older Safari */ }
}

/** A queue entry from a media entity. */
export const trackFrom = (entity) => ({
  id: entity.id,
  title: entity.title,
  artist: entity.people?.[0] || '',
  blobId: entity.meta?.blobId || null,
  url: entity.meta?.url || null,
  kind: entity.meta?.kind || 'audio',
  duration: entity.meta?.duration || 0,
})
