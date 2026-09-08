import test from 'node:test'
import assert from 'node:assert/strict'

import { extractFromText, strip, splitPeople } from '../src/ingest/extract.js'
import { parseDelimited, toTable } from '../src/ingest/parsers/csv.js'
import { entitiesFromTable, toNumber, profileColumns } from '../src/ingest/tabular.js'
import { parseIcs, parseIcsDate, expand, unfold } from '../src/ingest/parsers/ics.js'
import { transcriptToTurns } from '../src/ingest/parsers/transcript.js'
import { htmlToText } from '../src/ingest/parsers/text.js'
import { parseSharedStrings, parseSheet, parseDateStyles, columnIndex, serialToDate } from '../src/ingest/parsers/xlsx.js'
import { parseLooseDate, dayKey, rangeFor } from '../src/core/time.js'

const source = { docId: 'd1', name: 'test.md', kind: 'markdown' }

test('meeting notes: checkboxes, owners, due dates and tags', () => {
  const { entities } = extractFromText(
    ['## Action items',
      '- [ ] Draft the brief @Sam by 2026-10-02 #launch',
      '- [x] Send the contract @Priya',
      '- [/] Review the deck'].join('\n'),
    source
  )
  const tasks = entities.filter((e) => e.type === 'task')
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].title, 'Draft the brief')
  assert.deepEqual(tasks[0].people, ['Sam'])
  assert.ok(tasks[0].tags.includes('launch'))
  assert.equal(tasks[0].due.slice(0, 10), '2026-10-02')
  assert.equal(tasks[1].status, 'done')
  assert.equal(tasks[2].status, 'doing')
})

test('meeting notes: sections classify unmarked bullets', () => {
  const { entities } = extractFromText(
    ['## Risks', '- The rollback script is untested', '## Decisions', '- Ship behind a flag'].join('\n'),
    source
  )
  assert.equal(entities.find((e) => e.type === 'risk').title, 'The rollback script is untested')
  assert.equal(entities.find((e) => e.type === 'decision').title, 'Ship behind a flag')
})

test('meeting notes: explicit markers beat section context', () => {
  const { entities } = extractFromText(['## Notes', 'Decision: keep the old cluster warm'].join('\n'), source)
  assert.equal(entities.find((e) => e.type === 'decision').title, 'keep the old cluster warm')
})

test('meeting notes: metrics are read with their unit', () => {
  const { entities } = extractFromText('Revenue: $12,400\nUptime: 99.5%\nSignups: 1,240', source)
  const metrics = entities.filter((e) => e.type === 'metric')
  assert.equal(metrics.length, 3)
  assert.equal(metrics[0].value, 12400)
  assert.equal(metrics[0].unit, '$')
  assert.equal(metrics[1].value, 99.5)
  assert.equal(metrics[1].unit, '%')
  assert.equal(metrics[2].value, 1240)
})

test('meeting notes: metadata lines are not mistaken for metrics', () => {
  const { entities, meta } = extractFromText(
    'Attendees: Sam Ojo, Priya Raman\nDate: 2026-03-04\nDue: 2026-04-01',
    source
  )
  assert.deepEqual(meta.people, ['Sam Ojo', 'Priya Raman'])
  assert.equal(meta.date.slice(0, 10), '2026-03-04')
  assert.equal(entities.filter((e) => e.type === 'metric').length, 0)
})

test('meeting notes: timeline sections produce dated milestones', () => {
  const { entities } = extractFromText(
    ['## Timeline', '- 2026-05-01 - Beta launch', '- Public launch - 2026-06-15'].join('\n'),
    source
  )
  const milestones = entities.filter((e) => e.type === 'milestone')
  assert.equal(milestones.length, 2)
  assert.equal(milestones[0].title, 'Beta launch')
  assert.equal(milestones[0].due.slice(0, 10), '2026-05-01')
  assert.equal(milestones[1].title, 'Public launch')
})

test('strip pulls owner, tag, priority and due out of one line', () => {
  const result = strip('P0 Fix the billing webhook @Dev #payments by 2026-01-09')
  assert.equal(result.title, 'Fix the billing webhook')
  assert.deepEqual(result.people, ['Dev'])
  assert.deepEqual(result.tags, ['payments'])
  assert.equal(result.priority, 2)
  assert.equal(result.due.slice(0, 10), '2026-01-09')
})

test('splitPeople handles separators and drops emails', () => {
  assert.deepEqual(splitPeople('Sam Ojo, Priya Raman and Dev Kaur'), ['Sam Ojo', 'Priya Raman', 'Dev Kaur'])
  assert.deepEqual(splitPeople('sam <sam@example.com>'), ['Sam'])
})

test('loose dates: the formats people actually type', () => {
  const ref = new Date(2026, 2, 4) // Wednesday 4 March 2026
  assert.equal(parseLooseDate('2026-03-09', ref).slice(0, 10), '2026-03-09')
  assert.equal(dayKey(parseLooseDate('tomorrow', ref)), '2026-03-05')
  assert.equal(dayKey(parseLooseDate('by friday', ref)), '2026-03-06')
  assert.equal(dayKey(parseLooseDate('in 2 weeks', ref)), '2026-03-18')
  assert.equal(dayKey(parseLooseDate('Mar 20', ref)), '2026-03-20')
  assert.equal(dayKey(parseLooseDate('20 March 2026', ref)), '2026-03-20')
  assert.equal(dayKey(parseLooseDate('3/20/2026', ref)), '2026-03-20')
  assert.equal(dayKey(parseLooseDate('end of week', ref)), '2026-03-06')
  assert.equal(parseLooseDate('sometime soon', ref), null)
})

test('csv: quoted fields, embedded separators and newlines', () => {
  const rows = parseDelimited('a,b\n"x,1","line\nbreak"\n')
  assert.deepEqual(rows, [['a', 'b'], ['x,1', 'line\nbreak']])
})

test('csv: delimiter is sniffed', () => {
  assert.deepEqual(parseDelimited('a\tb\n1\t2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited('a;b\n1;2'), [['a', 'b'], ['1', '2']])
})

test('csv: preamble rows above the header are skipped', () => {
  const table = toTable(parseDelimited('Quarterly export\n\nDate,Revenue\n2026-01-01,100'))
  assert.deepEqual(table.headers, ['Date', 'Revenue'])
  assert.equal(table.rows.length, 1)
})

test('toNumber understands currency, percent and parenthesised negatives', () => {
  assert.deepEqual(toNumber('$1,240.50'), { value: 1240.5, unit: '$' })
  assert.deepEqual(toNumber('4.2%'), { value: 4.2, unit: '%' })
  assert.deepEqual(toNumber('(30)'), { value: -30, unit: '' })
  assert.equal(toNumber('not a number'), null)
  assert.equal(toNumber(''), null)
})

test('column profiling separates dates, numbers and roles', () => {
  const cols = profileColumns(
    ['Date', 'Revenue', 'Owner'],
    [['2026-01-01', '100', 'Sam'], ['2026-01-02', '120', 'Priya']]
  )
  assert.equal(cols[0].kind, 'date')
  assert.equal(cols[1].kind, 'number')
  assert.equal(cols[1].unit, '$')
  assert.equal(cols[2].role, 'owner')
})

test('a task-shaped sheet produces tasks with mapped statuses', () => {
  const table = toTable(parseDelimited(
    'Task,Owner,Status,Due,Priority\nShip the API,Dev Kaur,In progress,2026-02-01,P1\nWrite docs,Sam Ojo,Done,2026-01-10,'
  ))
  const entities = entitiesFromTable(table, { docId: 'd', name: 'backlog.csv', kind: 'csv' })
  const tasks = entities.filter((e) => e.type === 'task')
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].status, 'doing')
  assert.equal(tasks[0].priority, 1)
  assert.deepEqual(tasks[0].people, ['Dev Kaur'])
  assert.equal(tasks[1].status, 'done')
})

test('a metrics sheet produces one metric per numeric column per row', () => {
  const table = toTable(parseDelimited('Date,Signups,Churn\n2026-01-01,10,1\n2026-01-02,14,2'))
  const metrics = entitiesFromTable(table, { docId: 'd', name: 'm.csv', kind: 'csv' })
    .filter((e) => e.type === 'metric')
  assert.equal(metrics.length, 4)
  assert.deepEqual([...new Set(metrics.map((m) => m.series))].sort(), ['Churn', 'Signups'])
  assert.equal(metrics.find((m) => m.series === 'Signups').value, 10)
})

test('every table keeps its raw rows for inspection', () => {
  const table = toTable(parseDelimited('A,B\n1,2'))
  const note = entitiesFromTable(table, { docId: 'd', name: 't.csv', kind: 'csv' }).find((e) => e.type === 'note')
  assert.deepEqual(note.meta.table.headers, ['A', 'B'])
  assert.deepEqual(note.meta.table.rows, [['1', '2']])
})

test('ics: folded lines are rejoined before parsing', () => {
  assert.deepEqual(unfold('SUMMARY:A very\n  long title'), ['SUMMARY:A very long title'])
})

test('ics: events carry attendees, location and duration', () => {
  const [event] = parseIcs([
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'UID:1', 'SUMMARY:Design review', 'LOCATION:Room 4',
    'DTSTART:20260304T090000Z', 'DTEND:20260304T100000Z',
    'ORGANIZER;CN=Sam Ojo:mailto:sam@example.com',
    'ATTENDEE;CN=Priya Raman:mailto:priya@example.com',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'))
  assert.equal(event.summary, 'Design review')
  assert.equal(event.location, 'Room 4')
  assert.equal(event.organizer, 'Sam Ojo')
  assert.deepEqual(event.attendees, ['Priya Raman'])
  assert.equal(event.start.date.toISOString(), '2026-03-04T09:00:00.000Z')
})

test('ics: escaped commas and newlines are decoded', () => {
  const [event] = parseIcs(['BEGIN:VEVENT', 'SUMMARY:Sync\\, weekly', 'DESCRIPTION:One\\nTwo', 'END:VEVENT'].join('\n'))
  assert.equal(event.summary, 'Sync, weekly')
  assert.equal(event.description, 'One\nTwo')
})

test('ics: all-day dates are flagged rather than given a fake time', () => {
  assert.equal(parseIcsDate('20260304').allDay, true)
  assert.equal(parseIcsDate('20260304T090000').allDay, false)
})

test('ics: weekly recurrence expands inside the window only', () => {
  const event = { start: parseIcsDate('20260302T090000'), rrule: { FREQ: 'WEEKLY', COUNT: '10' } }
  const dates = expand(event, new Date(2026, 2, 1), new Date(2026, 2, 31))
  assert.equal(dates.length, 5)
  assert.equal(dayKey(dates[1]), '2026-03-09')
})

test('transcript: cue timings go, speaker turns merge', () => {
  const turns = transcriptToTurns([
    'WEBVTT', '', '1', '00:00:02.000 --> 00:00:09.400',
    "Priya Raman: I'll rewrite the rollback script today.",
    'It should land before lunch.', '', '2', '00:00:09.400 --> 00:00:16.900',
    'Dev Kaur: I am blocked on the staging database.',
  ].join('\n'))
  assert.equal(turns.length, 2)
  assert.equal(turns[0].speaker, 'Priya Raman')
  assert.match(turns[0].text, /before lunch/)
  assert.equal(turns[1].speaker, 'Dev Kaur')
})

test('html is flattened to markdown-ish text', () => {
  const text = htmlToText('<h2>Actions</h2><ul><li>Ship it &amp; tell Sam</li></ul><script>evil()</script>')
  assert.match(text, /## Actions/)
  assert.match(text, /- Ship it & tell Sam/)
  assert.doesNotMatch(text, /evil/)
})

test('xlsx: shared strings, cell refs and date styles', () => {
  assert.deepEqual(parseSharedStrings('<sst><si><t>Date</t></si><si><t>Rev</t></si></sst>'), ['Date', 'Rev'])
  assert.equal(columnIndex('A1'), 0)
  assert.equal(columnIndex('AA12'), 26)
  assert.equal(serialToDate(45658).toISOString().slice(0, 10), '2025-01-01')

  const styles = parseDateStyles('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>')
  assert.equal(styles.has(0), false)
  assert.equal(styles.has(1), true)

  const rows = parseSheet(
    '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" s="1"><v>45658</v></c><c r="B2"><v>120.5</v></c></row></sheetData>',
    ['Date', 'Rev'],
    styles
  )
  assert.deepEqual(rows, [['Date', 'Rev'], ['2025-01-01', 120.5]])
})

test('ranges are inclusive of today', () => {
  const range = rangeFor('7d', new Date(2026, 2, 10))
  assert.equal(dayKey(range.from), '2026-03-04')
  assert.equal(dayKey(range.to), '2026-03-10')
})
