/*
 * Search over everything you saved.
 *
 * Pocket searched titles and tags. The point of keeping the whole article is
 * that you can search the article, so this is a real inverted index with BM25
 * ranking rather than a substring scan: "the page about the rollback script"
 * finds it by a phrase in the body, and the best match sorts first.
 *
 * It is built in memory from the stash on load. A few thousand articles is
 * well inside what a browser can hold, and a person who has saved more than
 * that has bigger problems than index size.
 */

// Words carrying no signal. Kept short on purpose: an aggressive stop list
// makes phrase searches like "the who" impossible.
const STOP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'has',
  'have', 'he', 'her', 'his', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or',
  'she', 'that', 'the', 'they', 'this', 'to', 'was', 'were', 'will', 'with',
])

const K1 = 1.2
const B = 0.75

/** Words, lowercased, with punctuation and possessives removed. Keeps digits,
    because "CVE-2024" and "99.9" are exactly what someone searches for. */
export function tokenise(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .split(/[^a-z0-9.+#-]+/)
    // Leading punctuation is always noise; trailing + and # are not - "c++"
    // and "c#" are exactly the strings someone types into the box.
    .map((word) => word.replace(/^[.+#-]+/, '').replace(/[.-]+$/, ''))
    .filter((word) => word.length > 1 && word.length < 40)
}

const meaningful = (words) => words.filter((w) => !STOP.has(w))

/**
 * Build the index. Each document is { id, title, text, ...anything }.
 * Title terms count triple: a word in the headline is a stronger signal than
 * the same word buried in paragraph forty.
 */
export function buildIndex(documents) {
  const postings = new Map()
  const lengths = new Map()
  const docs = new Map()
  let total = 0

  for (const doc of documents || []) {
    if (!doc?.id) continue
    const body = tokenise(doc.text)
    const title = tokenise(doc.title)
    const terms = [...body, ...title, ...title, ...title]
    const useful = meaningful(terms)
    lengths.set(doc.id, useful.length)
    docs.set(doc.id, doc)
    total += useful.length

    const counts = new Map()
    for (const term of useful) counts.set(term, (counts.get(term) || 0) + 1)
    for (const [term, tf] of counts) {
      if (!postings.has(term)) postings.set(term, [])
      postings.get(term).push({ id: doc.id, tf })
    }
  }

  return {
    postings,
    lengths,
    docs,
    count: docs.size,
    averageLength: docs.size ? total / docs.size : 0,
  }
}

/**
 * A query splits into loose terms and quoted phrases. A phrase has to appear
 * verbatim, which is the difference between finding the page and finding
 * forty pages that mention both words somewhere.
 */
export function parseQuery(raw) {
  const text = String(raw ?? '').trim()
  const phrases = []
  const rest = text.replace(/"([^"]+)"/g, (_, phrase) => {
    const cleaned = phrase.trim().toLowerCase()
    if (cleaned) phrases.push(cleaned)
    return ' '
  })
  return { terms: meaningful(tokenise(rest)), phrases }
}

/** BM25. Returns [{ id, score, doc }], best first. */
export function search(index, query, { limit = 50 } = {}) {
  const { terms, phrases } = parseQuery(query)
  if (!terms.length && !phrases.length) return []
  if (!index?.count) return []

  const scores = new Map()

  for (const term of terms) {
    const posting = index.postings.get(term)
    if (!posting) continue
    // Rarer words say more. The +1 keeps the log positive when a term is in
    // every document, which would otherwise score negative.
    const idf = Math.log(1 + (index.count - posting.length + 0.5) / (posting.length + 0.5))
    for (const { id, tf } of posting) {
      const length = index.lengths.get(id) || 0
      const norm = 1 - B + (B * length) / (index.averageLength || 1)
      scores.set(id, (scores.get(id) || 0) + idf * ((tf * (K1 + 1)) / (tf + K1 * norm)))
    }
  }

  // A phrase is checked against the raw text, because the index has thrown
  // away word order by design.
  if (phrases.length) {
    const candidates = scores.size ? [...scores.keys()] : [...index.docs.keys()]
    for (const id of candidates) {
      const doc = index.docs.get(id)
      const haystack = `${doc?.title || ''}\n${doc?.text || ''}`.toLowerCase()
      const hits = phrases.filter((phrase) => haystack.includes(phrase)).length
      if (hits < phrases.length) scores.delete(id)
      else scores.set(id, (scores.get(id) || 0) + hits * 4)
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score, doc: index.docs.get(id) }))
    .sort((a, b) => b.score - a.score || String(a.doc?.title).localeCompare(String(b.doc?.title)))
    .slice(0, limit)
}

/**
 * The line to show under a result: the densest window of text around the
 * words that matched, with those words marked for the UI to highlight.
 * Returns { text, marks: [[start, end], ...] } in the window's coordinates.
 */
export function snippet(text, query, { length = 220 } = {}) {
  const body = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!body) return { text: '', marks: [] }

  const { terms, phrases } = parseQuery(query)
  const needles = [...new Set([...phrases, ...terms])].filter(Boolean)
  if (!needles.length) return { text: body.slice(0, length), marks: [] }

  const lower = body.toLowerCase()
  const hits = []
  for (const needle of needles) {
    let at = lower.indexOf(needle)
    while (at !== -1 && hits.length < 400) {
      hits.push([at, at + needle.length])
      at = lower.indexOf(needle, at + needle.length)
    }
  }
  if (!hits.length) return { text: body.slice(0, length), marks: [] }
  hits.sort((a, b) => a[0] - b[0])

  // Slide a window and keep the position with the most hits inside it.
  let best = hits[0][0]
  let bestCount = 0
  for (const [start] of hits) {
    const inside = hits.filter(([s]) => s >= start && s < start + length).length
    if (inside > bestCount) { bestCount = inside; best = start }
  }

  let from = Math.max(0, best - 40)
  // Do not start mid-word.
  if (from > 0) {
    const space = body.indexOf(' ', from)
    if (space !== -1 && space - from < 20) from = space + 1
  }
  const to = Math.min(body.length, from + length)
  const window = body.slice(from, to)

  const marks = hits
    .filter(([s, e]) => s >= from && e <= to)
    .map(([s, e]) => [s - from, e - from])

  return {
    text: `${from > 0 ? '…' : ''}${window}${to < body.length ? '…' : ''}`,
    // The leading ellipsis shifts every offset by one.
    marks: from > 0 ? marks.map(([s, e]) => [s + 1, e + 1]) : marks,
  }
}
