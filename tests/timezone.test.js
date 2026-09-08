import test from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, formatDate, isSameDay, startOfDay, addDays, relative, toDate } from '../src/core/time.js'

/**
 * Day keys are "YYYY-MM-DD" strings. `new Date("2026-03-04")` parses that as
 * UTC midnight, which is the previous evening anywhere west of Greenwich, so
 * the "Today" highlight and every day label would drift by one. These
 * assertions hold only if a key is treated as a local date; CI runs the whole
 * suite under UTC, America/Los_Angeles and Pacific/Auckland to prove it.
 */
test('a day key round-trips as a local calendar date', () => {
  assert.equal(dayKey('2026-03-04'), '2026-03-04')
  // Whatever this machine's locale prints, it must print the same thing for
  // the key as for a Date built from the same local parts.
  const opts = { month: 'numeric', day: 'numeric' }
  assert.equal(formatDate('2026-03-04', opts), new Date(2026, 2, 4).toLocaleDateString(undefined, opts))
  assert.equal(isSameDay('2026-03-04', new Date(2026, 2, 4, 15)), true)
  assert.equal(toDate('2026-03-04').getHours(), 0)
  assert.equal(dayKey(startOfDay('2026-12-31')), '2026-12-31')
  assert.ok(typeof relative('2026-03-04') === 'string')
})

test('adding days crosses a DST change without losing an hour', () => {
  // The US springs forward on 8 March 2026; a day is still a day either side.
  assert.equal(dayKey(addDays('2026-03-04', 1)), '2026-03-05')
  assert.equal(dayKey(addDays('2026-03-10', -6)), '2026-03-04')
  assert.equal(dayKey(addDays('2026-03-07', 2)), '2026-03-09')
})

test('a full ISO timestamp is still an absolute instant', () => {
  assert.equal(toDate('2026-03-04T12:00:00.000Z').toISOString(), '2026-03-04T12:00:00.000Z')
})
