import test from 'node:test'
import assert from 'node:assert/strict'

import { docxToText, pptxToText } from '../src/ingest/parsers/office.js'
import { notesToEntities } from '../src/ingest/parsers/text.js'
import { unescapeXml } from '../src/ingest/xml.js'
import { readZip } from '../src/ingest/zip.js'
import { buildReport } from '../src/engine/report.js'
import { forecast, correlation } from '../src/core/query.js'
import { evaluate, compileCustom } from '../src/engine/metrics.js'
import { buildInsights } from '../src/engine/insights.js'
import { makeEntity } from '../src/data/schema.js'
import { rangeFor, addDays, iso } from '../src/core/time.js'

const at = (offset) => iso(addDays(new Date(), offset))
const p = (style, text, extra = '') =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>` : extra ? `<w:pPr>${extra}</w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`

test('docx: headings, lists and checkboxes become markdown', () => {
  const xml = [
    p('Heading1', 'Weekly sync'),
    p('', 'Attendees: Sam Ojo, Priya Raman'),
    p('Heading2', 'Action items'),
    p('ListParagraph', 'Draft the brief @Sam', '<w:numPr><w:ilvl w:val="0"/></w:numPr>'),
    `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w14:checkbox><w14:checked w14:val="1"/></w14:checkbox><w:t>Send the contract</w:t></w:r></w:p>`,
  ].join('')
  const { text } = docxToText(xml)
  assert.match(text, /^# Weekly sync$/m)
  assert.match(text, /^## Action items$/m)
  assert.match(text, /^- Draft the brief @Sam$/m)
  assert.match(text, /^- \[x\] Send the contract$/m)
})

test('docx: tables are pulled out as rows', () => {
  const cell = (t) => `<w:tc><w:p><w:r><w:t>${t}</w:t></w:r></w:p></w:tc>`
  const xml =
    p('', 'Before') +
    `<w:tbl><w:tr>${cell('Task')}${cell('Owner')}</w:tr><w:tr>${cell('Ship it')}${cell('Sam')}</w:tr></w:tbl>` +
    p('', 'After')
  const { text, tables } = docxToText(xml)
  assert.equal(tables.length, 1)
  assert.deepEqual(tables[0], [['Task', 'Owner'], ['Ship it', 'Sam']])
  assert.match(text, /Before\nAfter/)
})

test('docx: entities survive the &amp; round trip, hex and decimal alike', () => {
  const { text } = docxToText(p('', 'R&amp;D &lt;plan&gt; it&#x2019;s &#8220;done&#8221;'))
  assert.equal(text, 'R&D <plan> it\u2019s \u201cdone\u201d')
  // Invalid or out-of-range entities stay literal rather than vanishing.
  assert.equal(unescapeXml('&#x1F600;&#xZZ;&#x110000;&#55296;'), '\u{1F600}&#xZZ;&#x110000;&#55296;')
})

test('a Word doc gets the same project tag and table handling as Markdown', () => {
  const text = ['# Vendor review', 'Project: Atlas', 'Attendees: Lena Park', '## Action items', '- Chase the SOC2 report @Lena'].join('\n')
  const tables = [[['Task', 'Owner', 'Status'], ['Sign the MSA', 'Lena Park', 'In progress']]]
  const out = notesToEntities({ name: 'review.docx', text, docId: 'd', kind: 'docx', tables })
  const task = out.find((e) => e.type === 'task' && e.title === 'Chase the SOC2 report')
  assert.ok(task.tags.includes('atlas'))
  assert.deepEqual(task.people, ['Lena Park'])
  const fromTable = out.find((e) => e.type === 'task' && e.title === 'Sign the MSA')
  assert.ok(fromTable, 'table rows become tasks')
  assert.ok(fromTable.tags.includes('atlas'))
  assert.equal(fromTable.status, 'doing')
  const note = out.find((e) => e.type === 'note' && e.title === 'Vendor review')
  assert.ok(note.tags.includes('atlas'))
})

test('a truncated or mangled zip fails with a message, not a RangeError', async () => {
  await assert.rejects(readZip(new Uint8Array(10).buffer), /Not a zip archive/)
  // A valid end-of-central-directory record that points outside the file.
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8)
  eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(46, 12)
  eocd.writeUInt32LE(999999, 16)
  await assert.rejects(readZip(eocd.buffer.slice(eocd.byteOffset, eocd.byteOffset + 22)), /Corrupt zip/)
  // A central directory whose entry carries the wrong signature is an error,
  // not an archive with no files in it.
  const bad = Buffer.alloc(46 + 22)
  bad.writeUInt32LE(0xdeadbeef, 0)
  bad.writeUInt32LE(0x06054b50, 46)
  bad.writeUInt16LE(1, 46 + 8)
  bad.writeUInt16LE(1, 46 + 10)
  bad.writeUInt32LE(46, 46 + 12)
  bad.writeUInt32LE(0, 46 + 16)
  await assert.rejects(readZip(bad.buffer.slice(bad.byteOffset, bad.byteOffset + bad.length)), /bad signature/)
})

test('pptx: slides become sections', () => {
  const slide = (title, ...bullets) =>
    `<p:sld><p:txBody><a:p><a:r><a:t>${title}</a:t></a:r></a:p>${bullets.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sld>`
  const text = pptxToText([slide('Roadmap', 'Q3: beta'), slide('Risks', 'Rollback untested')])
  assert.match(text, /^## Roadmap$/m)
  assert.match(text, /^Q3: beta$/m)
  assert.match(text, /^## Risks$/m)
})

test('forecast projects the trend and estimates days to target', () => {
  const rising = [10, 12, 14, 16, 18, 20].map((v, i) => ({ key: String(i), value: v }))
  const f = forecast(rising, { days: 2, target: 30 })
  assert.ok(Math.abs(f.value - 24) < 0.01)
  assert.equal(f.daysToTarget, 5)
  const flat = [5, 5, 5, 5, 5].map((v, i) => ({ key: String(i), value: v }))
  assert.equal(forecast(flat, { target: 10 }).daysToTarget, null)
})

test('correlation reads direction and strength', () => {
  const a = [1, 2, 3, 4, 5, 6].map((v, i) => ({ key: String(i), value: v }))
  const b = [2, 4, 6, 8, 10, 12].map((v, i) => ({ key: String(i), value: v }))
  const c = [6, 5, 4, 3, 2, 1].map((v, i) => ({ key: String(i), value: v }))
  assert.ok(correlation(a, b) > 0.99)
  assert.ok(correlation(a, c) < -0.99)
  assert.equal(correlation(a.slice(0, 3), b.slice(0, 3)), 0)
})

test('evaluate compares against the previous window', () => {
  const rows = []
  for (let i = 0; i < 14; i++) {
    rows.push(makeEntity({ type: 'task', title: `t${i}`, status: 'done', at: at(-i), source: { docId: 'x' } }))
  }
  // Force updatedAt into the past for the older half so the window split is real.
  const entities = Object.fromEntries(rows.map((r, i) => [r.id, { ...r, updatedAt: at(i < 4 ? -i : -(i + 3)) }]))
  const result = evaluate('tasks-completed', entities, rangeFor('7d'))
  assert.equal(result.value, 4)
  assert.equal(result.previous, 7)
  assert.ok(result.change < 0)
})

test('a custom metric with a target reports progress', () => {
  const rows = [10, 20, 30].map((v, i) => makeEntity({ type: 'metric', title: 'S', series: 'S', value: v, at: at(-2 + i) }))
  const entities = Object.fromEntries(rows.map((r) => [r.id, r]))
  const metric = compileCustom({ id: 'c', name: 'Signups', entityType: 'metric', seriesName: 'S', reduce: 'last', target: 60 })
  const result = evaluate(metric, entities, rangeFor('7d'))
  assert.equal(result.value, 30)
  assert.equal(result.target, 60)
  assert.equal(result.progress, 0.5)
  const insights = buildInsights(entities, rangeFor('7d'), [metric.config])
  assert.ok(insights.some((i) => i.id === 'target:c'))
})

test('the status update is assembled from real entities only', () => {
  const rows = [
    makeEntity({ type: 'task', title: 'Shipped the thing', status: 'done', people: ['Sam'] }),
    makeEntity({ type: 'task', title: 'Doing the other thing', status: 'doing', due: at(2) }),
    makeEntity({ type: 'task', title: 'Stuck on legal', status: 'blocked' }),
    makeEntity({ type: 'decision', title: 'Ship behind a flag' }),
    makeEntity({ type: 'event', title: 'Design review', at: at(1), end: at(1) }),
    makeEntity({ type: 'note', title: 'Who owns the runbook', tags: ['question'] }),
  ]
  const entities = Object.fromEntries(rows.map((r) => [r.id, r]))
  const md = buildReport(entities, { range: rangeFor('7d') })
  assert.match(md, /^# Status update/m)
  assert.match(md, /## Done\n- Shipped the thing \(Sam\)/)
  assert.match(md, /## In progress\n- Doing the other thing, due/)
  assert.match(md, /## Blocked and at risk\n- Stuck on legal/)
  assert.match(md, /## Decisions\n- Ship behind a flag/)
  assert.match(md, /## Calendar\n- .*Design review/)
  assert.match(md, /## Open questions\n- Who owns the runbook/)
  assert.doesNotMatch(md, /## Overdue/)
})
