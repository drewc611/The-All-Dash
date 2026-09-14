/*
 * Which photograph, and when it changes.
 *
 * "Rotates through the day" is doing real work in that sentence. A rotation
 * on a timer is a slideshow and would show you a midnight photograph at
 * eleven in the morning; the useful version tracks the light outside, so the
 * screen and the window roughly agree. So the day is cut into bands, each
 * picture belongs to a band, and the picture changes when the band does.
 *
 * The bands are solar-ish rather than solar. Real sunrise needs a latitude, a
 * longitude and a date, which means either asking for location - for a
 * wallpaper - or being wrong in a way that is worse than a fixed table. Fixed
 * hours are wrong by an hour or two in summer and honest about being a table.
 *
 * Nothing here touches the DOM or loads anything. It answers "which band is
 * it" and "which picture in this band", and the view does the rest.
 */

/**
 * The bands, in the order they run. `from` is the local hour the band opens;
 * it runs until the next one opens, and `night` wraps past midnight.
 */
export const BANDS = [
  { id: 'dawn', from: 5, label: 'Dawn' },
  { id: 'morning', from: 8, label: 'Morning' },
  { id: 'midday', from: 11, label: 'Midday' },
  { id: 'afternoon', from: 14, label: 'Afternoon' },
  { id: 'golden', from: 17, label: 'Golden hour' },
  { id: 'dusk', from: 19, label: 'Dusk' },
  { id: 'night', from: 21, label: 'Night' },
]

export const BAND_IDS = BANDS.map((b) => b.id)

/**
 * The band a moment falls in.
 *
 * Local hours on purpose: the person's morning is the one where they are, not
 * the one in UTC. Anything before the first band belongs to `night`, which is
 * what wraps midnight to five without a special case.
 */
export function bandAt(now = new Date()) {
  const hour = now.getHours()
  let current = BANDS[BANDS.length - 1]
  for (const band of BANDS) {
    if (hour >= band.from) current = band
    else break
  }
  return hour < BANDS[0].from ? BANDS[BANDS.length - 1] : current
}

/** When the current band gives way to the next, as a Date. */
export function nextChangeAfter(now = new Date()) {
  const hour = now.getHours()
  const upcoming = BANDS.find((b) => b.from > hour)
  const next = new Date(now)
  next.setMinutes(0, 0, 0)
  if (upcoming) {
    next.setHours(upcoming.from)
  } else {
    // Past the last band, so the next change is the first band tomorrow.
    next.setDate(next.getDate() + 1)
    next.setHours(BANDS[0].from)
  }
  return next
}

/** Milliseconds until the band changes. Never zero, so a timer cannot spin. */
export const msUntilNextBand = (now = new Date()) =>
  Math.max(1000, nextChangeAfter(now).getTime() - now.getTime())

/**
 * Pick a picture for a band.
 *
 * Two rules. A picture that declares this band wins; if none does, anything
 * available is better than a blank screen, because an empty band is the
 * common case when the pictures are somebody's own photographs rather than a
 * curated set with one for every hour.
 *
 * The choice within a band is by day, not random: reopening the app at two in
 * the afternoon should show the same photograph it showed at one, and a
 * wallpaper that reshuffles every time you switch view is a distraction in a
 * screen whose entire job is not being one.
 */
export function pick(pictures, { now = new Date(), band = null } = {}) {
  const list = Array.isArray(pictures) ? pictures.filter(Boolean) : []
  if (!list.length) return null
  const id = band || bandAt(now).id
  const matching = list.filter((p) => p.band === id)
  const pool = matching.length ? matching : list
  // Day number since the epoch, in local terms, so the pick is stable for a
  // calendar day and moves on the next one.
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000)
  return pool[Math.abs(day + hash(id)) % pool.length]
}

/** A small stable spread so two bands on the same day do not pick in lockstep. */
function hash(text) {
  let h = 0
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0
  return h
}

/**
 * Sort somebody's own media into bands by when it was taken.
 *
 * A photograph carries the hour it was shot, so a picture taken at sunset
 * lands in the golden band without anybody tagging it. That is the whole
 * reason this reads `capturedAt` rather than asking the person to file their
 * own photographs, which nobody would do.
 */
export function fromMedia(items, { urlFor = (m) => m.url || null } = {}) {
  const out = []
  for (const item of items || []) {
    if (!item || item.kind === 'video') continue
    const when = item.capturedAt || item.createdAt
    const date = when ? new Date(when) : null
    const band = date && Number.isFinite(date.getTime()) ? bandAt(date).id : 'midday'
    // Either an address the view can put straight in an <img>, or a blob id
    // for it to resolve out of IndexedDB. A picture with neither has nothing
    // to render and is dropped rather than shown as a broken image.
    const url = urlFor(item)
    const blobId = item.blobId || null
    if (!url && !blobId) continue
    out.push({ id: item.id, url: url || null, blobId, band, title: item.title || '', credit: item.credit || null, own: true })
  }
  return out
}
