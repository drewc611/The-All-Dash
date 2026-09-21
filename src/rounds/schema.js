import { CADENCES } from './due.js'
import { iso } from '../core/time.js'

/**
 * A round, and the brief a run of one produces.
 *
 * The brief is the interesting half. Every finding carries the ids of the
 * records it came from, and a finding that could not be traced to any of them
 * is not quietly dropped and not quietly asserted - it is kept, marked, and
 * shown under its own heading. A recurring report you cannot check is a
 * recurring report you have to trust, and trust is the thing these are worst
 * at earning.
 */

const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** The ceiling, in dollars, a single run may cost. 0 means "never spend". */
const ceilingOf = (v) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : 0
}

/**
 * Normalise anything that claims to be a round.
 *
 * Returns null rather than a broken round for input that cannot be one: a
 * round with no question has nothing to ask and a round with an unknown
 * cadence would never come due, and both would sit in the list looking like
 * they work.
 */
export function makeRound(raw) {
  // A default parameter only covers `undefined`. Stored JSON holds nulls, and
  // one of them reaching a property access is how a whole list stops rendering.
  const input = raw && typeof raw === 'object' ? raw : {}
  const name = clean(input.name, 80)
  const question = clean(input.question, 400)
  if (!question) return null
  const cadence = CADENCES.includes(input.cadence) ? input.cadence : 'weekly'
  return {
    id: input.id || uid('round'),
    name: name || question.slice(0, 60),
    question,
    cadence,
    ceiling: ceilingOf(input.ceiling),
    enabled: input.enabled !== false,
    createdAt: input.createdAt || iso(new Date()),
    lastRunAt: input.lastRunAt || null,
    lastBriefId: input.lastBriefId || null,
  }
}

/** Drop anything unreadable rather than letting one bad row empty the list. */
export const normaliseRounds = (rows) =>
  (Array.isArray(rows) ? rows : []).map((r) => makeRound(r)).filter(Boolean)

/**
 * A finding: one statement, and the records behind it.
 *
 * `sources` are entity ids. An empty `sources` is what makes a finding
 * unverified, which is a property of the finding rather than a flag somebody
 * remembered to set.
 */
export function makeFinding(text, sources = []) {
  // Cleaned first, capped last. Capping first and cleaning after means the
  // cleaning can take the string back under the cap, and then nothing marks
  // it as truncated - which is how a cut sentence comes to look like a short
  // one.
  //
  // Three things go:
  //
  // The `[[id]]` markers are how a claim carries its citation through the
  // Critic. They are machine syntax, and `sources` already says the same
  // thing in a form a person can click.
  //
  // A leading ellipsis, because a retrieved passage often starts mid-sentence
  // and a brief whose every line opens with "…" reads like it is quoting
  // something it will not show you.
  //
  // And the length. Without a model writing the answer a finding *is* the
  // retrieved passage, and a passage can be an entire CSV row. A brief is a
  // list you scan; the source chip opens the record, where the rest of it is.
  const cleaned = clean(text, 4000)
    .replace(/\[\[[a-z0-9_-]{2,64}\]\]/gi, '')
    .replace(/^[\s.…]+/, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!cleaned) return null

  const LIMIT = 220
  const shown = cleaned.length <= LIMIT
    ? cleaned
    // Back off to a word boundary so it does not stop mid-word, and say that
    // it was cut rather than letting it look like the record ended there.
    : `${cleaned.slice(0, LIMIT - 1).replace(/\s+\S*$/, '').trimEnd()}…`

  return { text: shown, sources: [...new Set(sources.filter(Boolean))] }
}

export const isVerified = (finding) => Boolean(finding?.sources?.length)

/**
 * The record of one run.
 *
 * `cost` is what the run actually spent, `skipped` says why it did not run if
 * it did not. A brief that refused to run because of its ceiling is still a
 * brief: silence would look identical to a round that found nothing.
 */
export function makeBrief(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const findings = (Array.isArray(input.findings) ? input.findings : [])
    .map((f) => (f && typeof f === 'object' ? makeFinding(f.text, f.sources) : makeFinding(f)))
    .filter(Boolean)
  return {
    id: input.id || uid('brief'),
    roundId: input.roundId || null,
    at: input.at || iso(new Date()),
    question: clean(input.question, 400),
    findings,
    verified: findings.filter(isVerified).length,
    unverified: findings.filter((f) => !isVerified(f)).length,
    cost: Number.isFinite(Number(input.cost)) ? Number(input.cost) : 0,
    skipped: input.skipped ? clean(input.skipped, 200) : null,
  }
}

/** How many briefs to keep. Old ones are history, not an archive. */
const MAX_BRIEFS = 60

export const emptyRounds = () => ({ rounds: [], briefs: [] })

/**
 * The stored slice.
 *
 * Briefs are sorted newest first before the cap is applied, so a hand-edited
 * file loses its oldest brief rather than whichever one happened to sit at the
 * end of the array.
 */
export function normaliseRoundsState(incoming) {
  const from = incoming && typeof incoming === 'object' ? incoming : {}
  const briefs = (Array.isArray(from.briefs) ? from.briefs : [])
    .filter((b) => b && typeof b === 'object')
    .map((b) => makeBrief(b))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  return {
    rounds: normaliseRounds(from.rounds),
    briefs: briefs.slice(0, MAX_BRIEFS),
  }
}
