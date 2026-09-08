import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * Day keys are "YYYY-MM-DD" strings. `new Date("2026-03-04")` parses that as
 * UTC midnight, which is the previous evening anywhere west of Greenwich and
 * the same morning anywhere east - so the "Today" highlight and every day
 * label would drift by one. These run under a far-west and a far-east zone
 * to prove the key round-trips as a local date.
 */
for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles']) {
  test(`day keys are local dates in ${zone}`, async () => {
    process.env.TZ = zone
    const { dayKey, formatDate, isSameDay, startOfDay, addDays, relative, toDate } = await import(
      `../src/core/time.js?tz=${encodeURIComponent(zone)}`
    )
    assert.equal(dayKey('2026-03-04'), '2026-03-04')
    assert.equal(formatDate('2026-03-04', { month: 'numeric', day: 'numeric' }), '3/4')
    assert.equal(isSameDay('2026-03-04', new Date(2026, 2, 4, 15)), true)
    assert.equal(toDate('2026-03-04').getHours(), 0)
    assert.equal(dayKey(addDays('2026-03-04', 1)), '2026-03-05')
    assert.equal(dayKey(startOfDay('2026-12-31')), '2026-12-31')
    // Across the US spring-forward (8 March 2026) a day is still a day.
    assert.equal(dayKey(addDays('2026-03-10', -6)), '2026-03-04')
    assert.equal(dayKey(addDays('2026-03-07', 2)), '2026-03-09')
    assert.ok(typeof relative('2026-03-04') === 'string')
    // Full ISO timestamps are still absolute instants, not reinterpreted.
    assert.equal(toDate('2026-03-04T12:00:00.000Z').toISOString(), '2026-03-04T12:00:00.000Z')
  })
}
