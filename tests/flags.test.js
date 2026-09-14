import test from 'node:test'
import assert from 'node:assert/strict'

import { CHANNELS, REGISTRY, channelOf, defaultFor, isOn, describe as describeFlags, normaliseFlags, rankOf } from '../src/core/flags.js'
import { normaliseSettings } from '../src/core/settings-schema.js'

/* ------------------------------------------------------- channel parsing */

test('a bare version is stable, a prerelease is its tag', () => {
  assert.equal(channelOf('0.2.0'), 'stable')
  assert.equal(channelOf('1.0.0'), 'stable')
  assert.equal(channelOf('0.2.0-alpha.1'), 'alpha')
  assert.equal(channelOf('0.2.0-beta.12'), 'beta')
  assert.equal(channelOf('0.2.0-rc.2'), 'rc')
})

test('an unrecognised prerelease is alpha, not stable', () => {
  // Guessing "finished" about a build nobody labelled is the expensive
  // direction to be wrong in: it would expose unfinished work by accident.
  assert.equal(channelOf('0.2.0-nightly.4'), 'alpha')
  assert.equal(channelOf('0.2.0-canary'), 'alpha')
})

test('a missing or malformed version does not throw', () => {
  assert.equal(channelOf(undefined), 'stable')
  assert.equal(channelOf(''), 'stable')
  assert.equal(channelOf(null), 'stable')
})

test('an unknown channel ranks as the strictest one', () => {
  assert.equal(rankOf('nonsense'), rankOf('stable'))
})

/* ------------------------------------------------------ the maturity gate */

test('an alpha feature reaches alpha builds and stops there', () => {
  // The direction that matters. Alpha-quality code must not widen its
  // audience simply because a beta was cut.
  assert.equal(defaultFor('focus', 'alpha'), true)
  assert.equal(defaultFor('focus', 'beta'), false)
  assert.equal(defaultFor('focus', 'rc'), false)
  assert.equal(defaultFor('focus', 'stable'), false)
})

test('a beta feature reaches alpha and beta', () => {
  assert.equal(defaultFor('glass.app', 'alpha'), true)
  assert.equal(defaultFor('glass.app', 'beta'), true)
  assert.equal(defaultFor('glass.app', 'stable'), false)
})

test('promoting a flag only ever widens its audience', () => {
  // Whatever the registry says today, no flag may be on in a wider channel
  // and off in a narrower one - that would mean stable users seeing something
  // alpha users do not, which is never what a maturity level means.
  for (const id of Object.keys(REGISTRY)) {
    const on = CHANNELS.map((c) => defaultFor(id, c))
    for (let i = 1; i < on.length; i += 1) {
      if (on[i]) assert.equal(on[i - 1], true, `${id} is on in ${CHANNELS[i]} but off in ${CHANNELS[i - 1]}`)
    }
  }
})

test('an unknown flag is off in every channel', () => {
  for (const channel of CHANNELS) assert.equal(defaultFor('no.such.flag', channel), false)
  assert.equal(isOn('no.such.flag', { channel: 'alpha' }), false)
})

test('an unknown flag stays off even when overridden on', () => {
  assert.equal(isOn('no.such.flag', { channel: 'alpha', overrides: { 'no.such.flag': true } }), false)
})

/* ---------------------------------------------------------- the overrides */

test('an override wins in both directions', () => {
  assert.equal(isOn('focus', { channel: 'stable', overrides: { focus: true } }), true)
  assert.equal(isOn('focus', { channel: 'alpha', overrides: { focus: false } }), false)
})

test('no override means the channel decides', () => {
  assert.equal(isOn('focus', { channel: 'alpha' }), true)
  assert.equal(isOn('focus', { channel: 'stable' }), false)
  assert.equal(isOn('focus', { channel: 'alpha', overrides: {} }), true)
})

test('a non-boolean override is ignored rather than coerced', () => {
  // 'false' and 0 are the shapes a hand-edited file arrives in, and guessing
  // what somebody meant by them is how a flag ends up in the wrong state.
  const { flags } = normaliseFlags({ focus: 'false', 'focus.glass': 0, 'focus.wallpaper': true })
  assert.deepEqual(flags, { 'focus.wallpaper': true })
})

test('normalising reports unknown ids rather than keeping them', () => {
  const { flags, dropped } = normaliseFlags({ focus: true, 'flag.from.a.future.build': true })
  assert.deepEqual(flags, { focus: true })
  assert.deepEqual(dropped, ['flag.from.a.future.build'])
})

test('normalising survives rubbish', () => {
  assert.deepEqual(normaliseFlags(null).flags, {})
  assert.deepEqual(normaliseFlags('nope').flags, {})
  assert.deepEqual(normaliseFlags(42).flags, {})
})

/* ------------------------------------------------------------- describing */

test('describe reports the default, the override and the result apart', () => {
  const rows = describeFlags({ channel: 'stable', overrides: { focus: true } })
  const focus = rows.find((r) => r.id === 'focus')
  assert.equal(focus.default, false, 'stable would not turn this on by itself')
  assert.equal(focus.override, true)
  assert.equal(focus.on, true)
  assert.equal(focus.maturity, 'alpha')

  const untouched = rows.find((r) => r.id === 'glass.app')
  assert.equal(untouched.override, null, 'an untouched flag has no override, not a false one')
  assert.equal(untouched.on, untouched.default)
})

test('describe covers the whole registry', () => {
  const rows = describeFlags({ channel: 'alpha' })
  assert.deepEqual(rows.map((r) => r.id).sort(), Object.keys(REGISTRY).sort())
})

/* -------------------------------------------- flags through a restored file */

test('a restored file may carry flag overrides', () => {
  // Unlike the platform URL and the media consents, a flag is neither a
  // secret nor permission to talk to somebody's server.
  const base = { theme: 'system', flags: {}, platform: { url: '' }, assistant: {}, media: { youtube: false, ffmpeg: false } }
  const { settings } = normaliseSettings({ flags: { focus: true } }, base, { trusted: false })
  assert.equal(settings.flags.focus, true)
})

test('a restored file cannot invent a flag', () => {
  const base = { flags: {}, platform: { url: '' }, assistant: {}, media: { youtube: false, ffmpeg: false } }
  const { settings, dropped } = normaliseSettings({ flags: { 'evil.flag': true } }, base, { trusted: false })
  assert.deepEqual(settings.flags, {})
  assert.ok(dropped.some((d) => d.includes('evil.flag')), dropped.join(', '))
})

test('flags do not weaken the three fields a file may never set', () => {
  const base = { flags: {}, platform: { url: '' }, assistant: { baseUrl: '' }, media: { youtube: false, ffmpeg: false } }
  const { settings, dropped } = normaliseSettings(
    { flags: { focus: true }, platform: { url: 'https://evil.example' }, media: { youtube: true } },
    base,
    { trusted: false },
  )
  assert.equal(settings.platform.url, '')
  assert.equal(settings.media.youtube, false)
  assert.equal(settings.flags.focus, true)
  assert.ok(dropped.length >= 2)
})
