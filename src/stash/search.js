/*
 * Search over everything you saved.
 *
 * Pocket searched titles and tags. The point of keeping the whole article is
 * that you can search the article, so this is a real inverted index with BM25
 * ranking rather than a substring scan: "the page about the rollback script"
 * finds it by a phrase in the body, and the best match sorts first.
 *
 * It is built in memory from the stash. A few thousand articles is well inside
 * what a browser can hold, and a person who has saved more than that has
 * bigger problems than index size.
 *
 * Building it is the expensive part - a thousand articles is a third of a
 * second, which is a third of a second the tab is not painting - so the index
 * is incremental. `syncIndex` keeps an existing index level with a document
 * list by touching only what moved: a page you saved is added, a page you
 * forgot is dropped, and the nine hundred that did not change are not
 * re-tokenised. Re-reading an unchanged archive from scratch every time
 * somebody opens the view is the thing this exists to avoid.
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
  const raw = String(text ?? '').toLowerCase().replace(/['’]s\b/g, '').split(/[^a-z0-9.+#-]+/)
  // One pass rather than split-map-filter: this runs over every word of every
  // article, so the two intermediate arrays are worth not allocating.
  const out = []
  for (let i = 0; i < raw.length; i += 1) {
    // Leading punctuation is always noise; trailing + and # are not - "c++"
    // and "c#" are exactly the strings someone types into the box.
    const word = raw[i].replace(/^[.+#-]+/, '').replace(/[.-]+$/, '')
    if (word.length > 1 && word.length < 40) out.push(word)
  }
  return out
}

const meaningful = (words) => words.filter((w) => !STOP.has(w))

/** What a document is worth re-reading over: the snapshot it points at and
    the last time the record changed. Highlighting a passage does not change
    a word of the article, so it does not change this. */
export const revisionOf = (doc) => `${doc?.rev ?? ''}`

/** An index with nothing in it. */
export function emptyIndex() {
  return { postings: new Map(), lengths: new Map(), docs: new Map(), revs: new Map(), count: 0, total: 0, averageLength: 0 }
}

function measure(index) {
  index.count = index.docs.size
  index.averageLength = index.count ? index.total / index.count : 0
  return index
}

/** Add one document, or replace the version already there. */
export function indexDoc(index, doc) {
  if (!doc?.id) return index
  dropDoc(index, doc.id, false)

  // Counted straight into a map. The obvious version concatenates the body
  // with three copies of the title and filters that, which allocates four
  // arrays per document to arrive at the same tally.
  const counts = new Map()
  let length = 0
  const tally = (words, weight) => {
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i]
      if (STOP.has(word)) continue
      counts.set(word, (counts.get(word) || 0) + weight)
      length += weight
    }
  }
  tally(tokenise(doc.text), 1)
  // Title terms count triple: a word in the headline is a stronger signal
  // than the same word buried in paragraph forty.
  tally(tokenise(doc.title), 3)

  for (const [term, tf] of counts) {
    let posting = index.postings.get(term)
    if (!posting) { posting = new Map(); index.postings.set(term, posting) }
    posting.set(doc.id, tf)
  }
  index.lengths.set(doc.id, length)
  index.docs.set(doc.id, doc)
  index.revs.set(doc.id, revisionOf(doc))
  index.total += length
  return measure(index)
}

/**
 * Remove documents. One pass over the vocabulary however many are going,
 * because the alternative - storing every document's term list a second time
 * so a removal can be surgical - doubles the memory of the whole index to
 * speed up the rarest thing anybody does to it.
 */
export function dropDocs(index, ids, remeasure = true) {
  const going = new Set([...ids].filter((id) => index.docs.has(id)))
  if (!going.size) return index
  for (const [term, posting] of index.postings) {
    for (const id of going) posting.delete(id)
    if (posting.size === 0) index.postings.delete(term)
  }
  for (const id of going) {
    index.total -= index.lengths.get(id) || 0
    index.lengths.delete(id)
    index.docs.delete(id)
    index.revs.delete(id)
  }
  return remeasure ? measure(index) : index
}

/** Remove one document. */
export const dropDoc = (index, id, remeasure = true) => dropDocs(index, [id], remeasure)

/**
 * Work out what an index needs to change to match a document list, without
 * changing anything. Returns the ids leaving, the documents to write, and the
 * counts, so a caller that cares about frame budget can apply it in pieces.
 */
export function planSync(index, documents) {
  const wanted = new Map()
  for (const doc of documents || []) if (doc?.id) wanted.set(doc.id, doc)

  // Everything leaving - forgotten pages and the old copy of anything that
  // changed - goes together, then the new copies go in. Doing it per document
  // would walk the vocabulary once per document.
  const gone = []
  const write = []
  let refreshed = 0
  for (const id of index.docs.keys()) if (!wanted.has(id)) gone.push(id)
  for (const [id, doc] of wanted) {
    const known = index.revs.get(id)
    if (known === revisionOf(doc)) continue
    if (known !== undefined) { gone.push(id); refreshed += 1 }
    write.push(doc)
  }
  return { gone, write, added: write.length - refreshed, removed: gone.length - refreshed, refreshed }
}

/**
 * Bring an index level with a document list, touching only what moved.
 * Returns { index, added, removed, refreshed } so a caller can say what it did.
 *
 * This does the whole thing at once. A first build over a large archive is
 * worth slicing instead - see `applySync`, which the view uses so that
 * indexing a thousand articles does not hold the frame for a second.
 */
export function syncIndex(index, documents) {
  const target = index || emptyIndex()
  const plan = planSync(target, documents)
  if (plan.gone.length) dropDocs(target, plan.gone, false)
  for (const doc of plan.write) indexDoc(target, doc)
  return { index: measure(target), added: plan.added, removed: plan.removed, refreshed: plan.refreshed }
}

/**
 * Apply a plan in time slices, yielding to the browser between them.
 *
 * The work is real - a thousand articles have to be tokenised once - but it
 * does not have to happen in one frame. Slices are measured rather than
 * counted, because articles differ in length by two orders of magnitude and a
 * fixed batch size is either too slow on long ones or pointless on short ones.
 */
export async function applySync(index, plan, { slice = 8, yieldTo = nextFrame, onProgress } = {}) {
  if (plan.gone.length) dropDocs(index, plan.gone, false)
  let done = 0
  let mark = now()
  for (const doc of plan.write) {
    indexDoc(index, doc)
    done += 1
    if (now() - mark < slice) continue
    onProgress?.(done, plan.write.length)
    await yieldTo()
    mark = now()
  }
  return measure(index)
}

const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

// scheduler.yield hands control back and resumes with priority, rather than
// going to the back of the task queue the way a zero timeout does.
const nextFrame = () => (typeof scheduler !== 'undefined' && scheduler.yield
  ? scheduler.yield()
  : new Promise((resolve) => { setTimeout(resolve, 0) }))

/**
 * Build an index from nothing. Each document is { id, title, text, rev? }.
 * Prefer `syncIndex` where an index already exists - this throws away work
 * that was already done.
 */
export function buildIndex(documents) {
  const index = emptyIndex()
  for (const doc of documents || []) indexDoc(index, doc)
  return index
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
    const idf = Math.log(1 + (index.count - posting.size + 0.5) / (posting.size + 0.5))
    for (const [id, tf] of posting) {
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
