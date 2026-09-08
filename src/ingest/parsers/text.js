import { defineParser } from '../../core/registry.js'
import { extractFromText, titleCase, canonicalPeople } from '../extract.js'
import { iso } from '../../core/time.js'

/**
 * Markdown, plain text and HTML. In practice this is the meeting-notes parser:
 * the format barely matters once tags are stripped, the markers people type do.
 */

function build({ name, text, docId, kind }) {
  const source = { docId, name, kind }
  const { entities, meta, summary } = extractFromText(text, source)
  const at = meta.date || iso(new Date())

  const withDate = entities.map((e) => ({
    ...e,
    at: e.at || (e.type === 'metric' ? at : null),
    people: e.people?.length ? canonicalPeople(e.people, meta.people) : meta.people.slice(0, 1),
    tags: meta.project ? [...(e.tags || []), slugish(meta.project)] : e.tags,
  }))

  const title = firstHeading(text) || name.replace(/\.[a-z0-9]+$/i, '')
  withDate.push({
    type: 'note',
    title,
    body: summary.slice(0, 4000),
    at,
    people: meta.people,
    tags: ['notes', ...(meta.project ? [slugish(meta.project)] : [])],
    source,
    confidence: 1,
  })

  for (const person of meta.people) {
    withDate.push({
      type: 'person',
      title: titleCase(person),
      at,
      people: [titleCase(person)],
      tags: ['attendee'],
      source,
      confidence: 0.9,
    })
  }

  return withDate
}

function firstHeading(text) {
  const m = String(text).match(/^#{1,3}\s+(.+)$/m)
  return m ? m[1].replace(/[#*_`]/g, '').trim() : null
}

const slugish = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

defineParser({
  id: 'markdown',
  name: 'Meeting notes and Markdown',
  extensions: ['.md', '.markdown', '.txt', '.text'],
  priority: 10,
  match: ({ name }) => /\.(md|markdown|txt|text)$/i.test(name || ''),
  parse: build,
})

defineParser({
  id: 'html',
  name: 'HTML documents',
  extensions: ['.html', '.htm'],
  priority: 10,
  match: ({ name }) => /\.(html?|xhtml)$/i.test(name || ''),
  parse: (input) => build({ ...input, text: htmlToText(input.text) }),
})

/** Last resort: anything textual we could not place still gets read. */
defineParser({
  id: 'plain',
  name: 'Any text',
  extensions: [],
  priority: -100,
  match: () => true,
  parse: build,
})

export function htmlToText(html) {
  const withBreaks = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<\s*h1[^>]*>/gi, '\n# ')
    .replace(/<\s*h2[^>]*>/gi, '\n## ')
    .replace(/<\s*h3[^>]*>/gi, '\n### ')
    .replace(/<[^>]+>/g, ' ')
  return decodeEntities(withBreaks)
    .split('\n')
    .map((l) => l.replace(/\s{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-' }
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(num) ? String.fromCodePoint(num) : whole
    }
    return named[code.toLowerCase()] ?? whole
  })
}

