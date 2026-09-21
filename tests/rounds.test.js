import test from 'node:test'
import assert from 'node:assert/strict'

import { isDue, nextDueAt, periodKey, dueNow, isWeekend, CADENCES } from '../src/rounds/due.js'
import { makeRound, normaliseRounds, makeBrief, makeFinding, isVerified } from '../src/rounds/schema.js'
import { runRound, briefFrom, priceRun, summarise } from '../src/rounds/run.js'
import { iso, addDays, startOfDay } from '../src/core/time.js'

// A fixed local moment: a Wednesday, mid-afternoon, wherever the test runs.
const wednesday = () => {
  const d = startOfDay(new Date())
  d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7))
  d.setHours(15, 0, 0, 0)
  return d
}
const round = (over = {}) => makeRound({ question: 'What is late?', cadence: 'daily', ...over })

// ---------------------------------------------------------------- cadence

test('a round that has never run is owed', () => {
  for (const cadence of CADENCES) {
    const r = round({ cadence })
    // Wednesday, so the weekday cadence is not excluded by the weekend rule.
    assert.equal(isDue(r, wednesday()), true, `${cadence} was not owed`)
  }
})

test('a round is owed once per period, not once per opening', () => {
  const now = wednesday()
  const r = round({ lastRunAt: iso(now) })
  assert.equal(isDue(r, now), false, 'owed again in the period it just ran in')
  const laterSameDay = new Date(now)
  laterSameDay.setHours(23, 30, 0, 0)
  assert.equal(isDue(r, laterSameDay), false, 'owed again later the same local day')
  assert.equal(isDue(r, addDays(now, 1)), true, 'not owed the next day')
})

test('a week away does not produce a week of briefs', () => {
  // The difference between a cadence and a queue. Seven briefs about days that
  // are over is nobody's idea of catching up, and each one costs money.
  const now = wednesday()
  const r = round({ cadence: 'daily', lastRunAt: iso(addDays(now, -7)) })
  assert.equal(isDue(r, now), true)
  // Running it now clears the whole gap: there is no backlog left behind.
  const after = { ...r, lastRunAt: iso(now) }
  assert.equal(isDue(after, now), false)
})

test('the period is the local one', () => {
  // 23:30 and 00:30 are different days where the person is. Measured in UTC
  // they can be the same day, or two days apart, depending on the zone - which
  // is how a daily round skips a day for somebody in Auckland.
  const late = startOfDay(new Date())
  late.setHours(23, 30, 0, 0)
  const earlyNext = addDays(startOfDay(new Date()), 1)
  earlyNext.setHours(0, 30, 0, 0)
  assert.notEqual(periodKey('daily', late), periodKey('daily', earlyNext))

  const sameDayApart = startOfDay(new Date())
  sameDayApart.setHours(1, 0, 0, 0)
  const alsoSameDay = startOfDay(new Date())
  alsoSameDay.setHours(22, 0, 0, 0)
  assert.equal(periodKey('daily', sameDayApart), periodKey('daily', alsoSameDay))
})

test('weekdays does not run at the weekend, and does not fold into Friday', () => {
  const sunday = startOfDay(new Date())
  sunday.setDate(sunday.getDate() - sunday.getDay())
  assert.equal(isWeekend(sunday), true)

  const r = round({ cadence: 'weekdays' })
  assert.equal(isDue(r, sunday), false, 'ran at the weekend')

  // Ran Friday; Monday is a new day and is owed. If Saturday keyed back to
  // Friday, Monday would look already done.
  const friday = addDays(sunday, -2)
  const monday = addDays(sunday, 1)
  const ranFriday = round({ cadence: 'weekdays', lastRunAt: iso(friday) })
  assert.equal(isDue(ranFriday, monday), true, 'Monday was not owed after a Friday run')
})

test('weekly and monthly key by their own period', () => {
  const now = wednesday()
  const weekly = round({ cadence: 'weekly', lastRunAt: iso(now) })
  assert.equal(isDue(weekly, addDays(now, 1)), false, 'owed again the next day')
  assert.equal(isDue(weekly, addDays(now, 7)), true, 'not owed a week later')

  const monthly = round({ cadence: 'monthly', lastRunAt: iso(now) })
  assert.equal(isDue(monthly, addDays(now, 1)), false)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 2, 12)
  assert.equal(isDue(monthly, nextMonth), true, 'not owed the next month')
})

test('a disabled round is never owed', () => {
  assert.equal(isDue(round({ enabled: false }), wednesday()), false)
  assert.equal(nextDueAt(round({ enabled: false }), wednesday()), null)
})

test('the next opening a monthly round could run in is the first, not 31 days on', () => {
  // A 31st plus a month is not the same as a 31st plus 31 days; setMonth on a
  // 31st lands in the month after next.
  const jan31 = new Date(2026, 0, 31, 12)
  const r = round({ cadence: 'monthly', lastRunAt: iso(jan31) })
  const next = nextDueAt(r, jan31)
  assert.equal(next.getMonth(), 1, 'did not land in February')
  assert.equal(next.getDate(), 1)
})

test('weekdays skips the weekend when saying when it could next run', () => {
  const friday = startOfDay(new Date())
  friday.setDate(friday.getDate() - ((friday.getDay() - 5 + 7) % 7))
  friday.setHours(12, 0, 0, 0)
  const r = round({ cadence: 'weekdays', lastRunAt: iso(friday) })
  const next = nextDueAt(r, friday)
  assert.equal(isWeekend(next), false, 'pointed at a weekend')
  assert.equal(next.getDay(), 1, 'did not point at Monday')
})

test('dueNow picks out only what is owed', () => {
  const now = wednesday()
  const rounds = [
    round({ cadence: 'daily' }),
    round({ cadence: 'daily', lastRunAt: iso(now) }),
    round({ cadence: 'weekly', enabled: false }),
  ]
  assert.equal(dueNow(rounds, now).length, 1)
})

// ----------------------------------------------------------------- schema

test('a round with no question is not a round', () => {
  assert.equal(makeRound({ name: 'Monday' }), null)
  assert.equal(makeRound({ question: '   ' }), null)
})

test('an unknown cadence falls back rather than never coming due', () => {
  assert.equal(makeRound({ question: 'x', cadence: 'hourly' }).cadence, 'weekly')
})

test('one unreadable row does not empty the list', () => {
  const rows = [{ question: 'What is late?' }, null, { name: 'no question' }, { question: 'What is blocked?' }]
  assert.equal(normaliseRounds(rows).length, 2)
})

test('the ceiling is a number of dollars, and defaults to none', () => {
  assert.equal(makeRound({ question: 'x' }).ceiling, 0)
  assert.equal(makeRound({ question: 'x', ceiling: '2.50' }).ceiling, 2.5)
  assert.equal(makeRound({ question: 'x', ceiling: -5 }).ceiling, 0, 'a negative ceiling is not a rebate')
  assert.equal(makeRound({ question: 'x', ceiling: 1e9 }).ceiling, 100, 'uncapped')
})

test('a finding is verified by having sources, not by being told it is', () => {
  assert.equal(isVerified(makeFinding('Something happened.', ['task_1'])), true)
  assert.equal(isVerified(makeFinding('Something happened.')), false)
  // The same id twice is one source.
  assert.deepEqual(makeFinding('x', ['a', 'a', 'b']).sources, ['a', 'b'])
})

// -------------------------------------------------------------------- run

const critique = (kept = [], cut = []) => ({ critique: { kept, cut } })

test('a brief keeps what could not be traced, and marks it', () => {
  // The cuts are the most interesting part: they are where the answer wanted
  // to say something it could not stand up. Dropping them is how a report
  // with the doubtful half removed comes to look trustworthy.
  const brief = briefFrom(round(), critique(
    ['Three tasks are overdue. [[task_1]] [[task_2]]'],
    [{ claim: 'The team is behind schedule.', reason: 'States something without citing anything.' }],
  ))
  assert.equal(brief.findings.length, 2)
  assert.equal(brief.verified, 1)
  assert.equal(brief.unverified, 1)
  assert.deepEqual(brief.findings[0].sources, ['task_1', 'task_2'])
  assert.deepEqual(brief.findings[1].sources, [])
})

test('a run over its ceiling does not happen, and says why', () => {
  const r = round({ ceiling: 0.5 })
  const priced = priceRun(r, { estimate: 2 })
  assert.equal(priced.allowed, false)
  assert.match(priced.reason, /over this round's \$0\.50 ceiling/)
})

test('no ceiling means no spending, not unlimited spending', () => {
  // The default that surprises nobody. Unlimited-by-default is how a standing
  // report quietly becomes the largest line on a bill.
  const r = round({ ceiling: 0 })
  assert.equal(priceRun(r, { estimate: 1.5 }).allowed, false)
  assert.equal(priceRun(r, { estimate: 0 }).allowed, true, 'a free run was refused')
})

test('a refused run still produces a brief', async () => {
  // Silence and "found nothing" look identical, and only one of them is true.
  const brief = await runRound(round({ ceiling: 0.1 }), { ask: async () => critique(['x [[a]]']), estimate: 5 })
  assert.ok(brief.skipped, 'no reason given')
  assert.equal(brief.findings.length, 0)
  assert.equal(brief.cost, 0, 'charged for a run that did not happen')
})

test('a round that throws reports the failure rather than going quiet', async () => {
  const brief = await runRound(round(), {
    ask: async () => { throw new Error('index is empty') },
    estimate: 0,
  })
  assert.match(brief.skipped, /index is empty/)
})

test('a run with no model still produces a real brief', async () => {
  // Retrieval and the Critic are local. Most standing questions about your own
  // workspace do not need a model at all, and a round that costs nothing is
  // one you can leave running.
  const brief = await runRound(round(), {
    ask: async () => critique(['Two tasks are blocked. [[task_9]]']),
    estimate: 0,
  })
  assert.equal(brief.skipped, null)
  assert.equal(brief.verified, 1)
  assert.equal(brief.cost, 0)
})

test('the one-line summary says what is in the brief', () => {
  assert.equal(summarise(makeBrief({ findings: [] })), 'Nothing to report.')
  assert.equal(summarise(makeBrief({ skipped: 'Over its ceiling.' })), 'Over its ceiling.')
  const mixed = briefFrom(round(), critique(['One task is blocked. [[task_4]]'], [{ claim: 'The rest is fine.' }]))
  assert.equal(summarise(mixed), '1 finding, 1 unverified')
})

test('a finding is a line, not a passage', () => {
  // Without a model writing the answer, a finding is whatever passage was
  // retrieved - and a passage can be a whole CSV row. A brief is a list you
  // scan. The source chip opens the record, where the rest of it lives.
  const long = `Backfill the audit log ${'and every row of it '.repeat(40)}`
  const f = makeFinding(long, ['doc_1'])
  assert.ok(f.text.length <= 220, `${f.text.length} characters`)
  assert.match(f.text, /…$/, 'cut mid-word with no sign it was cut')
  assert.doesNotMatch(f.text, /\s…$/, 'left a space before the ellipsis')
})

test('citation markup never reaches a person', () => {
  const f = makeFinding('Dev is blocked on the restore. [[doc_hwsyn5cekcw3]]', ['doc_hwsyn5cekcw3'])
  assert.equal(f.text, 'Dev is blocked on the restore.')
  assert.deepEqual(f.sources, ['doc_hwsyn5cekcw3'])
})

test('a passage that starts mid-sentence does not start with an ellipsis', () => {
  assert.equal(makeFinding('…blocking phase two.', ['x_1']).text, 'blocking phase two.')
})
