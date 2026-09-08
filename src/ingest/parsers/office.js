import { defineParser } from '../../core/registry.js'
import { readZip } from '../zip.js'
import { extractFromText, titleCase, canonicalPeople } from '../extract.js'
import { entitiesFromTable } from '../tabular.js'
import { toTable } from './csv.js'
import { iso } from '../../core/time.js'

/**
 * Word and PowerPoint, through the same ZIP reader that handles Excel.
 *
 * Both formats are XML in a zip. Paragraphs come out as lines (with heading
 * styles turned back into markdown headings and list items back into
 * bullets), tables come out as tables, and then the ordinary note reader
 * takes it from there. That means a Word doc with "Action items" in it
 * produces exactly what the same notes typed in Markdown would.
 */

const unescape = (s) =>
  String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** One Word paragraph -> one line, with its style folded into markdown. */
function paragraphToLine(xml) {
  const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)]
    .map((m) => (m[0] === '<w:tab/>' ? '\t' : m[0] === '<w:br/>' ? '\n' : unescape(m[1])))
    .join('')
    .trim()
  if (!text) return ''

  const style = xml.match(/<w:pStyle w:val="([^"]+)"/)?.[1] || ''
  const heading = style.match(/^(?:Heading|Title)(\d)?/i)
  if (heading) return `${'#'.repeat(Math.min(6, Number(heading[1]) || 1))} ${text}`

  const isList = /<w:numPr>/.test(xml) || /^List/i.test(style)
  const checked = /<w14:checked w14:val="1"\/>|☒|☑/.test(xml)
  const unchecked = /<w14:checkbox>/.test(xml) || /☐/.test(xml)
  const clean = text.replace(/^[☐☒☑]\s*/, '')
  if (checked) return `- [x] ${clean}`
  if (unchecked) return `- [ ] ${clean}`
  if (isList) return `- ${clean}`
  return text
}

export function docxToText(xml) {
  const lines = []
  const tables = []
  // Tables are lifted out whole and read as tables; the prose around them
  // continues without them, since a table's rows make poor sentences.
  const withoutTables = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [...tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) =>
      [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) =>
        [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => paragraphToLine(p[0]).replace(/^#+\s|^- (\[.\] )?/g, '')).join(' ').trim()
      )
    )
    if (rows.length) tables.push(rows)
    return ''
  })
  for (const [para] of withoutTables.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const line = paragraphToLine(para)
    if (line) lines.push(line)
  }
  return { text: lines.join('\n'), tables }
}

export function pptxToText(slides) {
  return slides
    .map((xml, i) => {
      const paragraphs = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
        .map((m) =>
          [...m[1].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((t) => unescape(t[1])).join('').trim()
        )
        .filter(Boolean)
      if (!paragraphs.length) return ''
      const [title, ...rest] = paragraphs
      return [`## ${title}`, ...rest.map((p) => (/^[-•▪]/.test(p) ? p.replace(/^[•▪]\s*/, '- ') : p))].join('\n')
    })
    .filter(Boolean)
    .join('\n\n')
}

function build(text, tables, { name, docId, kind }) {
  const source = { docId, name, kind }
  const { entities, meta, summary } = extractFromText(text, source)
  const at = meta.date || iso(new Date())
  const out = entities.map((e) => ({
    ...e,
    at: e.at || (e.type === 'metric' ? at : null),
    people: e.people?.length ? canonicalPeople(e.people, meta.people) : meta.people.slice(0, 1),
  }))

  tables.forEach((rows, i) => {
    const table = toTable(rows)
    if (table.headers.length && table.rows.length) {
      out.push(...entitiesFromTable({ ...table, sheet: `Table ${i + 1}` }, source))
    }
  })

  const heading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]
  out.push({
    type: 'note',
    title: heading || name.replace(/\.[a-z0-9]+$/i, ''),
    body: summary.slice(0, 4000),
    at,
    people: meta.people,
    tags: ['notes', kind],
    source,
    confidence: 1,
  })
  for (const person of meta.people) {
    out.push({ type: 'person', title: titleCase(person), at, people: [titleCase(person)], tags: ['attendee'], source, confidence: 0.9 })
  }
  return out
}

defineParser({
  id: 'docx',
  name: 'Word documents',
  extensions: ['.docx'],
  priority: 40,
  binary: true,
  match: ({ name }) => /\.docx$/i.test(name || ''),
  parse: async ({ name, buffer, docId, kind }) => {
    const zip = await readZip(buffer)
    const xml = await zip.text('word/document.xml')
    if (!xml) throw new Error('No document body found in this .docx')
    const { text, tables } = docxToText(xml)
    return build(text, tables, { name, docId, kind })
  },
})

defineParser({
  id: 'pptx',
  name: 'PowerPoint decks',
  extensions: ['.pptx'],
  priority: 40,
  binary: true,
  match: ({ name }) => /\.pptx$/i.test(name || ''),
  parse: async ({ name, buffer, docId, kind }) => {
    const zip = await readZip(buffer)
    const names = zip
      .names()
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]))
    const slides = []
    for (const n of names) slides.push(await zip.text(n))
    const text = pptxToText(slides)
    return build(text, [], { name, docId, kind })
  },
})
