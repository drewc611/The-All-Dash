import { defineParser } from '../../core/registry.js'
import { readZip } from '../zip.js'
import { unescapeXml as unescape } from '../xml.js'
import { notesToEntities } from './text.js'

/**
 * Word and PowerPoint, through the same ZIP reader that handles Excel.
 *
 * Both formats are XML in a zip. Paragraphs come out as lines (with heading
 * styles turned back into markdown headings and list items back into
 * bullets), tables come out as tables, and then the ordinary note reader
 * takes it from there. That means a Word doc with "Action items" in it
 * produces exactly what the same notes typed in Markdown would.
 */

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
    return notesToEntities({ name, text, docId, kind, tables })
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
    return notesToEntities({ name, text, docId, kind })
  },
})
