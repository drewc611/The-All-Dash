/*
 * What changed since you last looked.
 *
 * Every save keeps the text, so a re-fetch can be compared against the
 * version you read rather than replacing it. That is the whole feature: a
 * changelog that gained three entries, a status page where the number moved,
 * a policy that quietly lost a paragraph.
 *
 * The diff is over blocks, not lines. Prose rewraps, and a line diff of
 * rewrapped prose reports that the entire article changed, which is true and
 * useless.
 */

/** Paragraphs, headings, list items and code fences as single units. */
export function blocks(markdown) {
  return String(markdown ?? '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
}

/** Compare on shape, not on whitespace: a reflowed paragraph is the same
    paragraph, and a site that switched to smart quotes changed nothing. */
export function normalise(block) {
  return String(block ?? '')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

// Above this, the quadratic table is too big to be worth building, so the
// diff degrades to set membership: still correct about what is new and what
// is gone, just not about where it moved to.
const LCS_LIMIT = 1200

/**
 * A diff of two versions.
 *
 * Returns rows of { type: 'same' | 'added' | 'removed', text }, in reading
 * order, plus counts. `approximate` says the cheap path was taken.
 */
export function diffBlocks(before, after) {
  const a = blocks(before)
  const b = blocks(after)
  const keyA = a.map(normalise)
  const keyB = b.map(normalise)

  if (a.length * b.length > LCS_LIMIT * LCS_LIMIT) return roughDiff(a, b, keyA, keyB)

  // Longest common subsequence, iterative and row-by-row so the table is
  // (n+1) x (m+1) numbers rather than a graph of objects.
  const n = a.length
  const m = b.length
  const table = new Uint32Array((n + 1) * (m + 1))
  const at = (i, j) => i * (m + 1) + j

  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[at(i, j)] = keyA[i] === keyB[j]
        ? table[at(i + 1, j + 1)] + 1
        : Math.max(table[at(i + 1, j)], table[at(i, j + 1)])
    }
  }

  const rows = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (keyA[i] === keyB[j]) { rows.push({ type: 'same', text: b[j] }); i += 1; j += 1 }
    else if (table[at(i + 1, j)] >= table[at(i, j + 1)]) { rows.push({ type: 'removed', text: a[i] }); i += 1 }
    else { rows.push({ type: 'added', text: b[j] }); j += 1 }
  }
  while (i < n) { rows.push({ type: 'removed', text: a[i] }); i += 1 }
  while (j < m) { rows.push({ type: 'added', text: b[j] }); j += 1 }

  return summarise(rows, false)
}

function roughDiff(a, b, keyA, keyB) {
  const inA = new Set(keyA)
  const inB = new Set(keyB)
  const rows = []
  for (let i = 0; i < a.length; i += 1) if (!inB.has(keyA[i])) rows.push({ type: 'removed', text: a[i] })
  for (let j = 0; j < b.length; j += 1) rows.push({ type: inA.has(keyB[j]) ? 'same' : 'added', text: b[j] })
  return summarise(rows, true)
}

function summarise(rows, approximate) {
  let added = 0
  let removed = 0
  let same = 0
  for (const row of rows) {
    if (row.type === 'added') added += 1
    else if (row.type === 'removed') removed += 1
    else same += 1
  }
  return { rows, added, removed, same, changed: added > 0 || removed > 0, approximate }
}

/** Only the changes, with a little context, for a "what moved" panel. */
export function changesOnly(diff, { context = 1 } = {}) {
  const rows = diff?.rows || []
  const keep = new Set()
  rows.forEach((row, index) => {
    if (row.type === 'same') return
    for (let i = index - context; i <= index + context; i += 1) {
      if (i >= 0 && i < rows.length) keep.add(i)
    }
  })
  const out = []
  let lastKept = -1
  for (let i = 0; i < rows.length; i += 1) {
    if (!keep.has(i)) continue
    if (lastKept !== -1 && i > lastKept + 1) out.push({ type: 'gap', text: '' })
    out.push(rows[i])
    lastKept = i
  }
  return out
}

/** One sentence for a list row: "3 added, 1 removed". */
export function describeChange(diff) {
  if (!diff || !diff.changed) return 'Nothing changed'
  const parts = []
  if (diff.added) parts.push(`${diff.added} added`)
  if (diff.removed) parts.push(`${diff.removed} removed`)
  return parts.join(', ')
}

/**
 * A cheap fingerprint of a version, so two saves can be compared without
 * holding both texts. FNV-1a: not a security hash, and not used as one.
 */
export function fingerprint(markdown) {
  const text = blocks(markdown).map(normalise).join('\n')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
