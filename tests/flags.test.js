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

test('every flag is on exactly in the channels its maturity allows', () => {
  // The direction that matters, and stated as the rule rather than about one
  // flag: alpha-quality code must not widen its audience simply because a
  // beta was cut. An earlier version of this test named `focus` and its
  // assertions became false the day that flag was promoted, which tested the
  // registry's current contents rather than the rule.
  for (const [id, flag] of Object.entries(REGISTRY)) {
    for (const channel of CHANNELS) {
      const allowed = rankOf(flag.maturity) >= rankOf(channel)
      assert.equal(
        defaultFor(id, channel), allowed,
        `${id} is ${flag.maturity}-maturity, so on a ${channel} build it should be ${allowed ? 'on' : 'off'}`,
      )
    }
  }
})

test('the rule itself: stricter maturity reaches fewer channels', () => {
  // Proven against every maturity the registry can declare, whether or not a
  // flag currently sits at each one.
  const reach = (maturity) => CHANNELS.filter((c) => rankOf(maturity) >= rankOf(c))
  assert.deepEqual(reach('alpha'), ['alpha'])
  assert.deepEqual(reach('beta'), ['alpha', 'beta'])
  assert.deepEqual(reach('rc'), ['alpha', 'beta', 'rc'])
  assert.deepEqual(reach('stable'), CHANNELS)
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
  // Asserted as the rule, for every flag, against whatever maturity the
  // registry declares today. Writing `isOn('focus', 'stable') === false` here
  // encodes the registry's contents instead, and becomes a lie the moment the
  // flag is promoted - which it has been, twice, on this branch alone.
  for (const [id, flag] of Object.entries(REGISTRY)) {
    for (const channel of CHANNELS) {
      const expected = rankOf(flag.maturity) >= rankOf(channel)
      assert.equal(isOn(id, { channel }), expected, `${id} in ${channel}`)
      assert.equal(isOn(id, { channel, overrides: {} }), expected, `${id} in ${channel}, empty overrides`)
    }
    // A flag is always on in its own maturity's channel, whatever that is.
    assert.equal(isOn(id, { channel: flag.maturity }), true, `${id} off in its own channel`)
  }
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
  // The override is derived as the opposite of whatever the default happens to
  // be, so this keeps testing the three-way separation no matter which way the
  // registry moves. Hardcoding `default: false` only worked while some flag
  // was off in stable, which stopped being true the moment they were promoted.
  const [id, flag] = Object.entries(REGISTRY)[0]
  const channel = 'stable'
  const byDefault = defaultFor(id, channel)

  const rows = describeFlags({ channel, overrides: { [id]: !byDefault } })
  const row = rows.find((r) => r.id === id)
  assert.equal(row.default, byDefault, 'the default is not what the channel says')
  assert.equal(row.override, !byDefault, 'the override is not reported as given')
  assert.equal(row.on, !byDefault, 'the override did not win')
  assert.notEqual(row.on, row.default, 'default and result are the same, so nothing was separated')
  // Whatever the registry says today, not a value copied into the test.
  assert.equal(row.maturity, flag.maturity)

  const untouched = rows.find((r) => r.id !== id && r.override === null)
  assert.ok(untouched, 'expected at least one flag nobody has overridden')
  assert.equal(untouched.on, untouched.default, 'an untouched flag follows its channel')
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
