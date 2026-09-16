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


// ------------------------------------------- real archives, end to end

/*
 * Everything above hands XML straight to a parser. That leaves the path a
 * person actually takes - a file on disk, unzipped, the right part found,
 * parsed, turned into entities - with no coverage at all, which is how a bug
 * that cost every HTML and bulleted keyword line its entity lived long enough
 * to ship. These build genuine archives with the repo's own zip writer and run
 * them through `ingestFile`, the same entry point the file picker calls.
 */

import { zipFiles } from '../src/brain/bundle.js'
import { ingestFile } from '../src/ingest/index.js'

const archive = (parts, name) =>
  new File([zipFiles(Object.entries(parts).map(([path, text]) => ({ path, text })))], name)

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const wp = (text, style) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

test('a real .docx becomes entities, not just text', async () => {
  const body = [
    wp('Migration readiness', 'Heading1'),
    wp('- Decided: the rollback script ships first.'),
    wp('- TODO: Marco Bianchi to load test the pilot cohort'),
    wp('- Risk: the cohort was never load tested at full size.'),
  ].join('')
  const file = archive({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    'word/document.xml': `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  }, 'migration.docx')

  const { entities } = await ingestFile(file)
  const types = entities.map((e) => e.type)
  assert.ok(types.includes('decision'), `no decision: ${types.join(',')}`)
  assert.ok(types.includes('task'), `no task: ${types.join(',')}`)
  assert.ok(types.includes('risk'), `no risk: ${types.join(',')}`)
})

test('a real .xlsx becomes one task per row', async () => {
  const strings = ['Title', 'Owner', 'Status', 'Rewrite the rollback script', 'Priya Raman', 'To Do',
    'Load test the pilot cohort', 'Marco Bianchi']
  const si = (v) => strings.indexOf(v)
  const row = (r, vals) =>
    `<row r="${r}">${vals.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r}" t="s"><v>${si(v)}</v></c>`).join('')}</row>`
  const file = archive({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    'xl/workbook.xml': `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Backlog" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${
      row(1, ['Title', 'Owner', 'Status'])}${
      row(2, ['Rewrite the rollback script', 'Priya Raman', 'To Do'])}${
      row(3, ['Load test the pilot cohort', 'Marco Bianchi', 'To Do'])}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `${XML}<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${
      strings.map((t) => `<si><t xml:space="preserve">${t}</t></si>`).join('')}</sst>`,
  }, 'backlog.xlsx')

  const { entities } = await ingestFile(file)
  const titles = entities.filter((e) => e.type === 'task').map((e) => e.title)
  assert.equal(titles.length, 2, `expected both rows, got ${JSON.stringify(titles)}`)
  assert.ok(titles.includes('Rewrite the rollback script'))
})

test('a real .pptx reads every slide, in order', async () => {
  const slide = (lines) => `${XML}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree>${
    lines.map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')}</p:spTree></p:cSld></p:sld>`
  const file = archive({
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    'ppt/slides/slide1.xml': slide(['Migration readiness', 'Rollback first, then tenants']),
    // A slide's first text box is its title, so the body goes underneath it -
    // which is how a deck is actually shaped, and what makes the rest readable
    // as content rather than as five headings in a row.
    'ppt/slides/slide2.xml': slide(['Next steps', '- TODO: Marco Bianchi to load test the pilot cohort']),
  }, 'deck.pptx')

  const { entities } = await ingestFile(file)
  const titles = entities.map((e) => e.title || '')
  // Slide 1 is reached through its title; its body is ordinary prose and
  // belongs in the note, not in an entity of its own.
  assert.ok(titles.some((t) => /Migration readiness/.test(t)), `slide 1 was not read: ${JSON.stringify(titles)}`)
  // Slide 2 proves the reader got past the first slide and that a bullet on a
  // slide still classifies.
  const task = entities.find((e) => e.type === 'task')
  assert.ok(task, `slide 2 produced no task: ${JSON.stringify(titles)}`)
  assert.match(task.title, /load test the pilot cohort/)
})

test('an archive missing the part we want fails as a message, not a crash', async () => {
  // A .docx that is a valid zip but has no word/document.xml - a renamed file,
  // a partial download. The picker hands it straight here, so it must come back
  // as something the person can read.
  const file = archive({ 'random.txt': 'not a word document' }, 'broken.docx')
  await assert.rejects(() => ingestFile(file), (e) => e instanceof Error && typeof e.message === 'string')
})
