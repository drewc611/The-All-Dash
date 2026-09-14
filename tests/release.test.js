import test from 'node:test'
import assert from 'node:assert/strict'

import { parseVersion, canFollow, channelFor, suggestions } from '../scripts/version.mjs'
import { channelOf } from '../src/core/flags.js'

const ok = (from, to) => assert.equal(canFollow(from, to).ok, true, `${from} → ${to} should be legal`)
const no = (from, to) => assert.equal(canFollow(from, to).ok, false, `${from} → ${to} should be refused`)

/* ------------------------------------------------------------- parsing */

test('parses stable and prerelease versions', () => {
  assert.deepEqual(parseVersion('0.2.0'), { major: 0, minor: 2, patch: 0, phase: 3, iteration: 0 })
  assert.equal(parseVersion('0.2.0-alpha.1').phase, 0)
  assert.equal(parseVersion('0.2.0-beta.4').iteration, 4)
})

test('rejects shapes that are not versions', () => {
  for (const bad of ['', 'v0.2.0', '0.2', '0.2.0-alpha', '0.2.0-nightly.1', '0.2.0-alpha.x', null, undefined]) {
    assert.equal(parseVersion(bad), null, `${bad} should not parse`)
  }
})

/* --------------------------------------------------- the legal progression */

test('walks forward through the phases', () => {
  ok('0.1.0', '0.2.0-alpha.1')
  ok('0.2.0-alpha.1', '0.2.0-alpha.2')
  ok('0.2.0-alpha.2', '0.2.0-beta.1')
  ok('0.2.0-beta.1', '0.2.0-beta.2')
  ok('0.2.0-beta.2', '0.2.0-rc.1')
  ok('0.2.0-rc.1', '0.2.0')
  ok('0.2.0', '0.3.0-alpha.1')
})

test('a phase may be skipped forwards but never reopened', () => {
  ok('0.2.0-alpha.1', '0.2.0-rc.1')
  ok('0.2.0-alpha.1', '0.2.0')
  no('0.2.0-beta.1', '0.2.0-alpha.3')
  no('0.2.0-rc.1', '0.2.0-beta.1')
})

test('a new version cannot start from an unfinished one', () => {
  // The rule that matters: 0.2.0 reached rc and was abandoned. Starting 0.3.0
  // would quietly bury a release nobody ever shipped.
  no('0.2.0-rc.1', '0.3.0-alpha.1')
  no('0.2.0-beta.1', '0.3.0-alpha.1')
  assert.match(canFollow('0.2.0-rc.1', '0.3.0-alpha.1').why, /still a prerelease/)
})

test('a new version starts at alpha.1, not partway through', () => {
  no('0.2.0', '0.3.0-alpha.2')
  no('0.2.0', '0.3.0-beta.1')
  ok('0.2.0', '0.3.0-alpha.1')
  ok('0.2.0', '0.3.0')
})

test('a released version cannot be released again', () => {
  no('0.2.0', '0.2.0')
  assert.match(canFollow('0.2.0', '0.2.0').why, /0\.2\.1/)
})

test('an iteration must move forwards', () => {
  no('0.2.0-alpha.3', '0.2.0-alpha.3')
  no('0.2.0-alpha.3', '0.2.0-alpha.2')
  ok('0.2.0-alpha.3', '0.2.0-alpha.4')
})

test('versions cannot go backwards', () => {
  no('0.2.0', '0.1.0')
  no('0.2.0', '0.1.0-alpha.1')
  no('1.0.0', '0.9.0-alpha.1')
})

test('a patch release is a legal next version', () => {
  ok('0.2.0', '0.2.1-alpha.1')
  ok('0.2.0', '0.2.1')
})

test('refusals explain themselves', () => {
  // An error that just says "invalid" leaves whoever typed it guessing which
  // of several rules they tripped.
  for (const [from, to] of [['0.2.0-rc.1', '0.2.0-beta.1'], ['0.2.0', '0.2.0'], ['0.2.0', '0.3.0-beta.1']]) {
    const why = canFollow(from, to).why
    assert.ok(why && why.length > 20, `${from} → ${to} gave a thin reason: ${why}`)
  }
})

test('an unparseable current version refuses rather than throwing', () => {
  const verdict = canFollow('not-a-version', '0.2.0-alpha.1')
  assert.equal(verdict.ok, false)
  assert.match(verdict.why, /cannot be parsed/)
})

/* -------------------------------------------------------------- suggestions */

test('every suggestion offered is actually legal', () => {
  for (const from of ['0.1.0', '0.2.0-alpha.1', '0.2.0-beta.2', '0.2.0-rc.1', '1.0.0']) {
    const list = suggestions(from)
    assert.ok(list.length, `${from} suggested nothing`)
    for (const to of list) ok(from, to)
  }
})

/* ------------------------------------------------- the two channel readers */

test('the release script and the app agree on every channel', () => {
  // channelFor runs in node at release time; channelOf runs in the browser
  // off the stamped version. If they ever disagree, a build would advertise
  // one channel and gate its flags on another.
  for (const v of ['0.1.0', '0.2.0-alpha.1', '0.2.0-beta.3', '0.2.0-rc.1', '0.2.0', '1.4.2']) {
    assert.equal(channelFor(v), channelOf(v), `disagreed about ${v}`)
  }
})
