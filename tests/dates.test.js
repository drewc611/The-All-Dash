import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { q } from '../src/core/query.js'
import { makeEntity } from '../src/data/schema.js'

/*
 * A board writes a bare "2026-09-21" into an entity's due, at and end: the Date
 * column's coerce is isoDay, and a timeline cell writes its two ends the same
 * way. `new Date("2026-09-21")` reads that as UTC midnight, which is the
 * previous evening anywhere west of Greenwich and midday in Auckland. So every
 * task made on a board was a day out for half the world, and only in the
 * zones the developer was not sitting in.
 *
 * core/time.js has exactly one place a value becomes a Date - toDate - and its
 * comment describes this failure. These tests hold the rest of the app to it.
 */

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min)

test('a bare due date is that day in the reader\'s own zone', () => {
  const rows = [makeEntity({ type: 'task', title: 'Renew the certificate', status: 'open', due: '2026-09-21' })]

  // The whole of the 21st, morning: local midnight belongs inside it. Read as
  // UTC midnight this falls outside in Los Angeles (evening of the 20th) and
  // outside in Auckland (midday on the 21st), and only passes in UTC.
  const found = q(rows).due({ after: local(2026, 9, 21, 0, 0), before: local(2026, 9, 21, 6, 0) }).all()
  assert.equal(found.length, 1, 'a task due on the 21st is not on the 21st in this zone')

  // And it is not on the 20th, wherever the reader is.
  assert.equal(q(rows).due({ after: local(2026, 9, 20, 0, 0), before: local(2026, 9, 20, 23, 59) }).all().length, 0)
})

test('a full timestamp still means the instant it names', () => {
  // toDate must not change what a real timestamp does - an imported calendar
  // gives "2026-09-30T17:00:00.000Z" and that is one moment everywhere.
  const rows = [makeEntity({ type: 'task', title: 'Timed', status: 'open', due: '2026-09-30T17:00:00.000Z' })]
  const at = new Date('2026-09-30T17:00:00.000Z')
  assert.equal(q(rows).due({ after: at, before: at }).all().length, 1)
})

// ------------------------------------------------------------------ the guard

const SRC = new URL('../src/', import.meta.url).pathname

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(js|jsx)$/.test(name) ? [path] : []
  })
}

// `new Date(x.due)`, `new Date(x.at)`, `new Date(x.end)` and the `|| fallback`
// spellings of the same. A line that is deliberately about an instant rather
// than a calendar day says so with `// date-ok` and is left alone.
const RAW = /new Date\(\s*[\w$.?[\]]*\.(?:due|at|end)\b/

test('nothing in src reads a due, at or end with a bare new Date()', () => {
  const offenders = []
  for (const file of walk(SRC)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (RAW.test(line) && !line.includes('date-ok')) {
        offenders.push(`${relative(SRC, file)}:${i + 1}  ${line.trim().slice(0, 90)}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    `these read a board's bare day key as UTC midnight - use toDate from core/time.js:\n${offenders.join('\n')}`)
})
