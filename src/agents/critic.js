/*
 * The Critic: nothing leaves here that cannot be traced back.
 *
 * This is the agent that makes the other four safe to use. Every claim in an
 * answer must carry a citation, every citation must resolve to a passage the
 * Librarian actually returned, and every quoted span must appear in the
 * passage it is attributed to. A claim that fails any of those is cut from
 * the answer rather than softened, because an answer with one invented
 * citation in it is not a slightly worse answer - it is an answer you now
 * have to check line by line, which is the work you were trying to avoid.
 *
 * It runs deterministically and always, whether the sentence above it was
 * assembled by rules or written by a model. A model that is allowed to mark
 * its own work will eventually mark it generously.
 */

const CITATION = /\[\[([a-z0-9_-]{2,64})\]\]/gi

/** Every id an answer cites, in order, with duplicates kept. */
export function citationsIn(text) {
  const out = []
  let match = CITATION.exec(String(text ?? ''))
  while (match) {
    out.push(match[1])
    match = CITATION.exec(String(text ?? ''))
  }
  CITATION.lastIndex = 0
  return out
}

/*
 * Sentence-ish spans.
 *
 * Crude on purpose: the unit only has to be small enough that cutting one
 * does not take a paragraph with it. The one subtlety is that it must not
 * split immediately before a citation - a claim ends "...since March.
 * [[risk_1]]", and a splitter that treats the bracket as the start of a new
 * sentence orphans the citation, leaving one span that cites nothing and one
 * that says nothing. Both then get cut, and the answer loses the sentence it
 * had every right to keep.
 */
export const claims = (text) =>
  String(text ?? '')
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean)

const normalise = (text) => String(text ?? '').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()

/**
 * Check one answer against the passages it was built from.
 *
 * @returns {{ok: boolean, kept: string[], cut: object[], cited: string[]}}
 */
export function review(answer, passages) {
  const known = new Map(passages.map((p) => [p.id, p]))
  const kept = []
  const cut = []
  const cited = new Set()

  for (const claim of claims(answer)) {
    const ids = citationsIn(claim)

    // A sentence that asserts nothing - a heading, a lead-in - is allowed to
    // carry no citation. One that states something is not.
    const asserts = /\w+\s+\w+/.test(claim.replace(CITATION, '').trim())
    if (!ids.length) {
      if (asserts) cut.push({ claim, reason: 'States something without citing anything.' })
      else kept.push(claim)
      continue
    }

    const unknown = ids.filter((id) => !known.has(id))
    if (unknown.length) {
      cut.push({ claim, reason: `Cites ${unknown.join(', ')}, which is not among the passages retrieved.` })
      continue
    }

    // A quoted span has to be in the passage it is attributed to.
    const quoted = [...claim.matchAll(/"([^"]{8,})"/g)].map((m) => m[1])
    const sources = ids.map((id) => normalise(`${known.get(id).title} ${known.get(id).text}`))
    const invented = quoted.find((quote) => !sources.some((text) => text.includes(normalise(quote))))
    if (invented) {
      cut.push({ claim, reason: `Quotes "${invented.slice(0, 60)}", which does not appear in what it cites.` })
      continue
    }

    ids.forEach((id) => cited.add(id))
    kept.push(claim)
  }

  return { ok: cut.length === 0 && kept.length > 0, kept, cut, cited: [...cited] }
}

/**
 * The verdict as the person sees it.
 *
 * Says what was cut and why. An answer that silently drops the sentence you
 * most wanted is worse than one that tells you it could not stand it up.
 */
export function verdict(result) {
  if (!result.kept.length) return { grade: 'unusable', text: 'Nothing here could be traced to a source.' }
  if (!result.cut.length) return { grade: 'clean', text: `Every claim resolves. ${result.cited.length} source${result.cited.length === 1 ? '' : 's'} cited.` }
  return {
    grade: 'trimmed',
    text: `${result.cut.length} claim${result.cut.length === 1 ? '' : 's'} cut for not standing up. ${result.kept.length} kept.`,
  }
}
