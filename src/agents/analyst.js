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

const sentencesOf = (text) =>
  String(text ?? '').split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean)

/**
 * The sentence in this passage that is most about the given subject.
 *
 * Polarity has to be measured on the sentence that makes the claim, not on
 * the passage containing it. A meeting note is forty lines long and will
 * contain the word "not" somewhere; judging the whole document by that says
 * the document denies everything in it, and pairs it with every short claim
 * that agrees.
 */
function focus(text, against) {
  let best = text
  let bestScore = -1
  for (const sentence of sentencesOf(text)) {
    const score = overlap(subject(sentence), against)
    if (score > bestScore) { bestScore = score; best = sentence }
  }
  return best
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
    // The whole passage, not the excerpt. An excerpt is a 220-character
    // window around the query match, and the word that flips a claim is
    // routinely outside it - "never" three sentences from the term you
    // searched for is exactly the case this exists to catch.
    //
    // The title is not prepended: the corpus text already opens with it, and
    // counting it twice counts its negators twice, which flips "has never
    // been run" back to a positive claim and loses the contradiction.
    const text = p.text || p.title || p.excerpt?.text || ''
    return { passage: p, text, subject: subject(text), measures: measures(text) }
  })

  const found = []
  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i]
      const b = prepared[j]
      if (overlap(a.subject, b.subject) < SAME_SUBJECT) continue

      // Judged on the sentence in each that is actually about the shared
      // subject, rather than on the whole passage.
      if (polarity(focus(a.text, b.subject)) !== polarity(focus(b.text, a.subject))) {
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

/**
 * The same claim, arriving from more than one place.
 *
 * Grouped by subject overlap, using the same threshold as the contradiction
 * test above rather than a second mechanism. The obvious alternative - hash
 * the content words and group by equality - sounds stricter and is in fact
 * useless: two people writing the same fact in two sentences never choose the
 * identical set of words, so nothing ever agrees with anything.
 *
 * Passages already known to contradict each other are not counted as
 * agreeing, which is why the clashes are passed in.
 */
export function agreement(passages, clashes = []) {
  const opposed = new Set()
  for (const clash of clashes) {
    opposed.add(`${clash.between[0]}|${clash.between[1]}`)
    opposed.add(`${clash.between[1]}|${clash.between[0]}`)
  }

  const prepared = passages.map((p) => ({ p, subject: subject(p.text || p.title || p.excerpt?.text || '') }))
  const taken = new Set()
  const groups = []

  for (let i = 0; i < prepared.length; i += 1) {
    if (taken.has(prepared[i].p.id)) continue
    const group = [prepared[i]]
    for (let j = i + 1; j < prepared.length; j += 1) {
      if (taken.has(prepared[j].p.id)) continue
      if (overlap(prepared[i].subject, prepared[j].subject) < SAME_SUBJECT) continue
      if (opposed.has(`${prepared[i].p.id}|${prepared[j].p.id}`)) continue
      group.push(prepared[j])
    }
    if (group.length < 2) continue
    for (const member of group) taken.add(member.p.id)
    groups.push({
      subject: [...prepared[i].subject].slice(0, 6).join(' '),
      sources: group.map((g) => g.p.id),
      count: group.length,
    })
  }
  return groups.sort((a, b) => b.count - a.count)
}

/** Everything the Analyst has to say about one retrieval. */
export function analyse(passages, { question = '' } = {}) {
  const found = contradictions(passages)
  const agreed = agreement(passages, found)
  const asked = subject(question)
  const covered = new Set()
  for (const p of passages) for (const word of subject(`${p.title} ${p.text || p.excerpt?.text || ''}`)) covered.add(word)
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
