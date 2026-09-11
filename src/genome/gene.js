/*
 * A gene: one claim, in a Markdown file, that knows where it came from.
 *
 * The brain writes Markdown about the person already. This is the same idea
 * pushed one step: instead of regenerating a file from scratch every time,
 * each claim is a file with a history. It has a generation, the gene it
 * descended from, the records it was drawn from, and a tally of how often it
 * has been cited, confirmed and contradicted since.
 *
 * That tally is the point. A claim nobody ever cites and nothing ever
 * confirms decays and is eventually retired; a claim that keeps earning
 * citations survives and outranks its neighbours in retrieval. Nothing about
 * that needs a model - it is arithmetic over things that actually happened.
 *
 * The file is the artifact, not a serialisation of one. It is plain Markdown
 * with front matter, it opens in any editor, and the export carries it. If
 * this app disappears you still have a directory of readable notes with their
 * provenance attached, which is the only version of "your data is yours" that
 * survives the app being abandoned.
 */

import { hashId } from '../core/id.js'
import { iso } from '../core/time.js'

export const GENE_VERSION = 1

/* Keys that must never be written onto a parsed object. An imported file set
   the prototype of the entity map once already; front matter is another file
   somebody else can write. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])

/* A front-matter document is small by nature. These caps mean a hostile or
   corrupt file costs a bounded amount of work rather than the tab. */
const MAX_KEYS = 64
const MAX_LINE = 4096
const MAX_LIST = 256

const NUMERIC = new Set(['generation', 'cited', 'confirmed', 'contradicted'])
const BOOLEAN = new Set(['retired'])
const LIST = new Set(['sources', 'tags', 'parents'])

/** The empty gene, so every field has a known shape. */
export const emptyGene = () => ({
  id: '',
  version: GENE_VERSION,
  claim: '',
  topic: '',
  body: '',
  generation: 1,
  parents: [],
  sources: [],
  tags: [],
  cited: 0,
  confirmed: 0,
  contradicted: 0,
  retired: false,
  born: '',
  changed: '',
})

const asNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

const asList = (value) => {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).slice(0, MAX_LIST)
  const text = String(value ?? '').trim()
  if (!text) return []
  const inner = text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  return inner.split(',').map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean).slice(0, MAX_LIST)
}

/**
 * Parse the front matter of a gene file.
 *
 * Deliberately not YAML. A gene's front matter is flat scalars and flat
 * lists, and every YAML feature beyond that - anchors, nested maps, type
 * tags - is a way for a file to say something this app has no business
 * acting on. Anything unrecognised is kept as a string and ignored.
 */
export function parseGene(text) {
  const raw = String(text ?? '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { ...emptyGene(), body: raw.trim() }

  const gene = emptyGene()
  const lines = match[1].split(/\r?\n/).slice(0, MAX_KEYS)
  for (const line of lines) {
    if (line.length > MAX_LINE) continue
    const at = line.indexOf(':')
    if (at < 1) continue
    const key = line.slice(0, at).trim()
    if (!key || FORBIDDEN.has(key) || !Object.hasOwn(gene, key)) continue
    const value = line.slice(at + 1).trim()

    if (NUMERIC.has(key)) gene[key] = asNumber(value, gene[key])
    else if (BOOLEAN.has(key)) gene[key] = value === 'true'
    else if (LIST.has(key)) gene[key] = asList(value)
    else gene[key] = value.replace(/^["']|["']$/g, '')
  }
  gene.generation = Math.max(1, gene.generation)
  gene.body = match[2].trim()
  if (!gene.claim) gene.claim = gene.body.split('\n')[0].slice(0, 200)
  return gene
}

const scalar = (value) => {
  const text = String(value ?? '')
  // Quote anything that would otherwise read as a list, a number or a break.
  return /^[[\d-]|[:#]|^\s|\s$/.test(text) ? JSON.stringify(text) : text
}

/** The gene as the file it is. */
export function serialiseGene(gene) {
  const g = { ...emptyGene(), ...gene }
  const front = [
    `id: ${g.id}`,
    `version: ${GENE_VERSION}`,
    `claim: ${scalar(g.claim)}`,
    `topic: ${scalar(g.topic)}`,
    `generation: ${g.generation}`,
    `parents: [${g.parents.join(', ')}]`,
    `sources: [${g.sources.join(', ')}]`,
    `tags: [${g.tags.join(', ')}]`,
    `cited: ${g.cited}`,
    `confirmed: ${g.confirmed}`,
    `contradicted: ${g.contradicted}`,
    `retired: ${g.retired ? 'true' : 'false'}`,
    `born: ${g.born}`,
    `changed: ${g.changed}`,
  ]
  return `---\n${front.join('\n')}\n---\n\n${g.body.trim()}\n`
}

/** A new gene from evidence. The id is derived from the claim, so the same
    claim learned twice is the same gene rather than a duplicate. */
export function makeGene({ claim, topic = '', body = '', sources = [], tags = [], now = new Date() }) {
  const text = String(claim || '').trim()
  if (!text) return null
  const at = iso(now)
  return {
    ...emptyGene(),
    id: hashId('gene', `${topic}:${text.toLowerCase()}`),
    claim: text,
    topic: String(topic || '').trim(),
    body: String(body || text).trim(),
    sources: [...new Set(sources.map(String).filter(Boolean))].slice(0, MAX_LIST),
    tags: [...new Set(tags.map(String).filter(Boolean))].slice(0, MAX_LIST),
    born: at,
    changed: at,
  }
}

/** The path this gene would occupy in an exported directory of Markdown. */
export const genePath = (gene) => {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const topic = slug(gene.topic) || 'general'
  return `genome/${topic}/${slug(gene.claim).slice(0, 60) || gene.id}.md`
}
