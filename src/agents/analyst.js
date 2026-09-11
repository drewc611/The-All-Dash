/*
 * The Analyst: what the retrieved passages say together that none says alone.
 *
 * Three things, all of them arithmetic over the passages the Librarian
 * returned rather than an opinion about them.
 *
 *   contradictions  two claims on the same subject that cannot both hold
 *   agreement       the same claim arriving from several independent sources
 *   gaps            a subject that shows up only in questions, never in answers
 *
 * Contradiction detection is the interesting one and the easy one to do
 * badly. Comparing meanings needs a model and will produce confident nonsense;
 * comparing *numbers and polarity on a shared subject* needs neither and is
 * either right or silent. So that is what this does: two passages about the
 * same subject where one negates the other, or where both state a value for
 * the same measure and the values differ. Everything subtler is left alone,
 * because a contradiction detector that cries wolf gets switched off in a
 * week and then catches nothing at all.
 */

import { tokenise } from '../stash/search.js'

/* Words that flip a claim. Kept small: every addition is a chance to call two
   compatible sentences a contradiction. */
const NEGATORS = new Set(['not', 'never', 'no', 'cannot', "can't", 'without', 'failed', 'missing', 'un'])

/* Pairs that mean opposite things about the same subject. */
const ANTONYMS = [
  ['up', 'down'], ['rising', 'falling'], ['increased', 'decreased'], ['grew', 'shrank'],
  ['faster', 'slower'], ['done', 'blocked'], ['passed', 'failed'], ['on', 'off'],
  ['open', 'closed'], ['above', 'below'], ['more', 'less'], ['better', 'worse'],
]

const OPPOSITE = new Map()
for (const [a, b] of ANTONYMS) { OPPOSITE.set(a, b); OPPOSITE.set(b, a) }

const STOPISH = new Set(['the', 'a', 'an', 'is', 'was', 'are', 'were', 'be', 'been', 'has', 'have', 'had', 'of', 'to', 'in', 'on', 'at', 'for', 'and', 'or', 'it', 'its', 'this', 'that'])

/** The content words of a passage, which is what "the same subject" means here. */
export const subject = (text) => new Set(tokenise(text).filter((w) => !STOPISH.has(w) && !NEGATORS.has(w) && !OPPOSITE.has(w)))

const overlap = (a, b) => {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const word of a) if (b.has(word)) shared += 1
  return shared / Math.min(a.size, b.size)
}

const polarity = (text) => {
  const words = tokenise(text)
  let flips = 0
  for (const word of words) if (NEGATORS.has(word)) flips += 1
  return flips % 2 === 0 ? 1 : -1
}

/** Numbers stated in a passage, with the unit if one is attached. */
export function measures(text) {
  const out = []
  const re = /(-?\d[\d,]*\.?\d*)\s*(%|ms|s|h|hours?|days?|kb|mb|gb|[a-z]{1,4})?/gi
  let match = re.exec(String(text ?? ''))
  while (match) {
    const value = Number(match[1].replace(/,/g, ''))
    if (Number.isFinite(value)) out.push({ value, unit: (match[2] || '').toLowerCase() })
    match = re.exec(String(text ?? ''))
  }
  return out
}

/*
 * How much subject overlap counts as "about the same thing".
 *
 * Tuned by hand against the sample workspace: below this, unrelated passages
 * that happen to share a common word start pairing up. It is a blunt number
 * and it is allowed to be, because the cost of being wrong here is a
 * suggestion the person dismisses, not a change to their data.
 */
const SAME_SUBJECT = 0.6

/**
 * Passages that cannot both be true.
 *
 * Each finding names both sides and says which test fired, because
 * "these disagree" with no reason attached is not something anybody can act
 * on.
 */
export function contradictions(passages) {
  const prepared = passages.map((p) => {
    const text = `${p.title}\n${p.excerpt?.text || p.text || ''}`
    return { passage: p, text, subject: subject(text), polarity: polarity(text), measures: measures(text) }
  })

  const found = []
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i]
      const b = prepared[j]
      if (overlap(a.subject, b.subject) < SAME_SUBJECT) continue

      if (a.polarity !== b.polarity) {
        found.push({ kind: 'negation', between: [a.passage.id, b.passage.id], why: 'One of these says the opposite of the other about the same subject.' })
        continue
      }
      const numbersA = a.measures.filter((m) => m.unit)
      const numbersB = b.measures.filter((m) => m.unit)
      for (const one of numbersA) {
        const other = numbersB.find((m) => m.unit === one.unit && m.value !== one.value)
        if (!other) continue
        found.push({
          kind: 'measure',
          between: [a.passage.id, b.passage.id],
          why: `Both give a figure in ${one.unit} for the same subject, and they differ: ${one.value} against ${other.value}.`,
        })
        break
      }
      const opposed = [...a.subject].some((w) => OPPOSITE.has(w) && b.subject.has(OPPOSITE.get(w)))
      if (opposed) found.push({ kind: 'antonym', between: [a.passage.id, b.passage.id], why: 'These describe the same subject moving in opposite directions.' })
    }
  }
  return found
}

/** The same claim, arriving from more than one place. Independent agreement is
    worth more than one source repeated, so sources are counted, not passages. */
export function agreement(passages) {
  const bySubject = new Map()
  for (const p of passages) {
    const key = [...subject(`${p.title} ${p.excerpt?.text || ''}`)].sort().slice(0, 6).join(' ')
    if (!key) continue
    if (!bySubject.has(key)) bySubject.set(key, [])
    bySubject.get(key).push(p)
  }
  return [...bySubject.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ subject: key, sources: group.map((p) => p.id), count: group.length }))
    .sort((a, b) => b.count - a.count)
}

/** Everything the Analyst has to say about one retrieval. */
export function analyse(passages, { question = '' } = {}) {
  const found = contradictions(passages)
  const agreed = agreement(passages)
  const asked = subject(question)
  const covered = new Set()
  for (const p of passages) for (const word of subject(`${p.title} ${p.excerpt?.text || ''}`)) covered.add(word)
  const gaps = [...asked].filter((word) => !covered.has(word))

  return {
    contradictions: found,
    agreement: agreed,
    // A word in the question that appears in nothing retrieved is the honest
    // version of "I do not know about that", and is far more useful than an
    // answer that quietly omits it.
    gaps,
    confident: found.length === 0 && passages.length > 0 && gaps.length === 0,
  }
}
