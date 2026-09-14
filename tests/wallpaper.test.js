import test from 'node:test'
import assert from 'node:assert/strict'

import { BANDS, BAND_IDS, bandAt, fromMedia, msUntilNextBand, nextChangeAfter, pick } from '../src/focus/wallpaper.js'
import { BUNDLED, bundledPictures } from '../src/focus/bundled.js'

/* Local time on purpose - the bands track the light where the person is, so
   these build dates from local components rather than from a UTC string. */
const local = (hour, minute = 0, day = 14) => new Date(2026, 8, day, hour, minute, 0, 0)

/* ------------------------------------------------------------- the bands */

test('each hour lands in the band it should', () => {
  assert.equal(bandAt(local(5)).id, 'dawn')
  assert.equal(bandAt(local(7, 59)).id, 'dawn')
  assert.equal(bandAt(local(8)).id, 'morning')
  assert.equal(bandAt(local(12)).id, 'midday')
  assert.equal(bandAt(local(15)).id, 'afternoon')
  assert.equal(bandAt(local(18)).id, 'golden')
  assert.equal(bandAt(local(20)).id, 'dusk')
  assert.equal(bandAt(local(22)).id, 'night')
})

test('the small hours are night, not a gap', () => {
  // Midnight to five is before the first band opens. Without the wrap this is
  // the hole every table-driven version of this has.
  assert.equal(bandAt(local(0)).id, 'night')
  assert.equal(bandAt(local(3)).id, 'night')
  assert.equal(bandAt(local(4, 59)).id, 'night')
})

test('every hour of the day resolves to a real band', () => {
  for (let h = 0; h < 24; h += 1) {
    const band = bandAt(local(h))
    assert.ok(BAND_IDS.includes(band.id), `hour ${h} gave ${band?.id}`)
  }
})

test('the bands are declared in order and do not overlap', () => {
  for (let i = 1; i < BANDS.length; i += 1) {
    assert.ok(BANDS[i].from > BANDS[i - 1].from, `${BANDS[i].id} does not follow ${BANDS[i - 1].id}`)
  }
})

/* --------------------------------------------------------- the changeover */

test('the next change is the next band opening', () => {
  assert.equal(nextChangeAfter(local(9, 30)).getHours(), 11)
  assert.equal(nextChangeAfter(local(5, 1)).getHours(), 8)
  assert.equal(nextChangeAfter(local(17, 5)).getHours(), 19)
})

test('past the last band the next change is tomorrow morning', () => {
  const next = nextChangeAfter(local(23, 30))
  assert.equal(next.getHours(), 5)
  assert.equal(next.getDate(), 15, 'tomorrow, not today')
})

test('before the first band the next change is today', () => {
  const next = nextChangeAfter(local(2))
  assert.equal(next.getHours(), 5)
  assert.equal(next.getDate(), 14)
})

test('the wait is never zero, so a timer cannot spin', () => {
  // Exactly on the hour a naive subtraction gives 0 and setTimeout(0) would
  // fire in a loop for the whole hour.
  for (const band of BANDS) {
    assert.ok(msUntilNextBand(local(band.from)) >= 1000, `${band.id} at its own hour returned too soon`)
  }
  for (let h = 0; h < 24; h += 1) assert.ok(msUntilNextBand(local(h)) >= 1000)
})

/* ------------------------------------------------------------ the picking */

test('picks a photograph belonging to the current band', () => {
  const pictures = [
    { id: 'a', band: 'night', url: 'a.jpg' },
    { id: 'b', band: 'morning', url: 'b.jpg' },
    { id: 'c', band: 'golden', url: 'c.jpg' },
  ]
  assert.equal(pick(pictures, { now: local(9) }).id, 'b')
  assert.equal(pick(pictures, { now: local(18) }).id, 'c')
  assert.equal(pick(pictures, { now: local(23) }).id, 'a')
})

test('an empty band falls back to something rather than nothing', () => {
  // The common case when the pictures are your own photographs: you have
  // nothing shot at 4am, and a blank screen is worse than a daytime photo.
  const pictures = [{ id: 'a', band: 'morning', url: 'a.jpg' }]
  assert.equal(pick(pictures, { now: local(23) }).id, 'a')
})

test('no pictures means no picture, not a crash', () => {
  assert.equal(pick([], { now: local(9) }), null)
  assert.equal(pick(null, { now: local(9) }), null)
  assert.equal(pick(undefined, { now: local(9) }), null)
  assert.equal(pick([null, undefined], { now: local(9) }), null)
})

test('the pick is stable across a band, and across re-renders', () => {
  // A wallpaper that reshuffles whenever you switch view is a distraction in
  // a screen whose whole job is not being one.
  const pictures = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, band: 'morning', url: `${i}.jpg` }))
  const first = pick(pictures, { now: local(8, 1) })
  for (const minute of [2, 30, 59, 119, 179]) {
    assert.equal(pick(pictures, { now: local(8 + Math.floor(minute / 60), minute % 60) }).id, first.id)
  }
})

test('the pick moves on the next day', () => {
  const pictures = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, band: 'morning', url: `${i}.jpg` }))
  const seen = new Set()
  for (let day = 14; day < 21; day += 1) seen.add(pick(pictures, { now: local(9, 0, day) }).id)
  assert.ok(seen.size > 1, 'the same photograph every day is a static wallpaper')
})

test('two bands on one day do not pick in lockstep', () => {
  const make = (band) => Array.from({ length: 5 }, (_, i) => ({ id: `${band}${i}`, band, url: `${i}.jpg` }))
  const pictures = [...make('morning'), ...make('night')]
  const morning = pick(pictures, { now: local(9) })
  const night = pick(pictures, { now: local(22) })
  assert.notEqual(morning.id.replace('morning', ''), night.id.replace('night', ''))
})

/* ---------------------------------------------------- your own photographs */

test('a photograph is filed by the hour it was taken', () => {
  // Nobody is going to tag their own camera roll by time of day, and they do
  // not have to: the photograph already knows when it was shot.
  const media = [
    { id: 'm1', kind: 'photo', capturedAt: local(18, 30).toISOString(), url: 'sunset.jpg' },
    { id: 'm2', kind: 'photo', capturedAt: local(9).toISOString(), url: 'morning.jpg' },
    { id: 'm3', kind: 'photo', capturedAt: local(23).toISOString(), url: 'night.jpg' },
  ]
  const bands = Object.fromEntries(fromMedia(media).map((p) => [p.id, p.band]))
  assert.equal(bands.m1, 'golden')
  assert.equal(bands.m2, 'morning')
  assert.equal(bands.m3, 'night')
})

test('video is not wallpaper', () => {
  const media = [
    { id: 'v', kind: 'video', capturedAt: local(9).toISOString(), url: 'clip.webm' },
    { id: 'p', kind: 'photo', capturedAt: local(9).toISOString(), url: 'still.jpg' },
  ]
  assert.deepEqual(fromMedia(media).map((p) => p.id), ['p'])
})

test('a photograph with no usable date still gets a band', () => {
  const media = [
    { id: 'a', kind: 'photo', url: 'a.jpg' },
    { id: 'b', kind: 'photo', capturedAt: 'not a date', url: 'b.jpg' },
  ]
  const out = fromMedia(media)
  assert.equal(out.length, 2)
  for (const p of out) assert.ok(BAND_IDS.includes(p.band))
})

test('a photograph with no url is skipped rather than rendered blank', () => {
  const media = [{ id: 'a', kind: 'photo', capturedAt: local(9).toISOString() }]
  assert.deepEqual(fromMedia(media, { urlFor: () => null }), [])
})

test('fromMedia survives rubbish', () => {
  assert.deepEqual(fromMedia(null), [])
  assert.deepEqual(fromMedia([null, undefined]), [])
})

test('falls back to createdAt when a photo was never stamped with a capture time', () => {
  const media = [{ id: 'a', kind: 'photo', createdAt: local(22).toISOString(), url: 'a.jpg' }]
  assert.equal(fromMedia(media)[0].band, 'night')
})

test('a photograph in IndexedDB is carried by blob id, not a url', () => {
  const out = fromMedia([{ id: 'a', kind: 'photo', capturedAt: local(9).toISOString(), blobId: 'blob_1' }])
  assert.equal(out.length, 1)
  assert.equal(out[0].blobId, 'blob_1')
  assert.equal(out[0].url, null)
})

test('a picture with neither a url nor a blob is dropped', () => {
  // Rendering it would give a broken image icon over the whole screen.
  assert.deepEqual(fromMedia([{ id: 'a', kind: 'photo', capturedAt: local(9).toISOString() }]), [])
})

/* ------------------------------------------------ the bundled set */

test('every band has a bundled photograph', () => {
  // The whole point of bundling a set: no band can fall through to "nothing",
  // however empty somebody's Studio is.
  const bands = new Set(BUNDLED.map((p) => p.band))
  for (const id of BAND_IDS) assert.ok(bands.has(id), `no bundled photograph for ${id}`)
})

test('every bundled photograph carries a checkable credit', () => {
  for (const p of BUNDLED) {
    assert.ok(p.credit.author, `${p.band} has no author`)
    assert.match(p.credit.licence, /public domain/i, `${p.band} is "${p.credit.licence}", which cannot be bundled`)
    assert.match(p.credit.page, /^https:\/\/commons\.wikimedia\.org\//, `${p.band} has no source page`)
  }
})

test('every bundled photograph has an inlined placeholder', () => {
  for (const p of BUNDLED) {
    assert.match(p.placeholder, /^data:image\/webp;base64,/, `${p.band} has no placeholder`)
    // Small enough to sit in the bundle without anybody noticing.
    assert.ok(p.placeholder.length < 2000, `${p.band}'s placeholder is ${p.placeholder.length} bytes`)
  }
})

test('bundled pictures resolve to a file path, not a blob', () => {
  const pictures = bundledPictures('avif')
  assert.equal(pictures.length, BUNDLED.length)
  for (const p of pictures) {
    assert.match(p.url, /^wallpapers\/[a-z]+\.avif$/)
    assert.equal(p.own, false)
    assert.equal(p.blobId, undefined)
  }
})

test('your own photograph for this hour beats the bundled one', () => {
  // Putting a picture in Studio is a statement that you want to look at it.
  const pictures = [
    { id: 'mine', band: 'morning', url: 'mine.jpg', own: true },
    { id: 'bundled:morning', band: 'morning', url: 'w/morning.avif', own: false },
  ]
  for (let day = 14; day < 21; day += 1) {
    assert.equal(pick(pictures, { now: local(9, 0, day) }).id, 'mine', `day ${day} chose the bundled one`)
  }
})

test('a band you have no photograph for falls back to the bundled one', () => {
  const pictures = [
    { id: 'mine', band: 'morning', url: 'mine.jpg', own: true },
    { id: 'bundled:night', band: 'night', url: 'w/night.avif', own: false },
  ]
  assert.equal(pick(pictures, { now: local(23) }).id, 'bundled:night')
})

test('several of your own in one band still vary by day', () => {
  const pictures = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `mine${i}`, band: 'morning', url: `${i}.jpg`, own: true })),
    { id: 'bundled:morning', band: 'morning', url: 'w/morning.avif', own: false },
  ]
  const seen = new Set()
  for (let day = 14; day < 21; day += 1) seen.add(pick(pictures, { now: local(9, 0, day) }).id)
  assert.ok(seen.size > 1, 'the same photograph every day is a static wallpaper')
  for (const id of seen) assert.ok(id.startsWith('mine'), `${id} is not one of yours`)
})
