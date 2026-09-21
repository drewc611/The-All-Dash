import { citationsIn } from '../agents/critic.js'
import { makeBrief, makeFinding } from './schema.js'
import { iso } from '../core/time.js'

/**
 * Running a round, and deciding beforehand whether to.
 *
 * Two things here are the whole point of the feature, and both are decisions
 * about what *not* to do.
 *
 * **The ceiling is checked before the call, not after.** Recurring AI work is
 * sold on credits, which means you find out what a standing report costs by
 * being charged for it, every week, until you notice. A round that would go
 * over its ceiling does not run, and says so. The estimate is made from the
 * question and the cap on the reply, not from a guess at how long the answer
 * will be, because the only number you can promise is the worst case.
 *
 * **A finding that cannot be traced is shown, not dropped.** The Critic cuts
 * claims that cite nothing or cite something that was never retrieved. Those
 * cuts are the most interesting part of a brief - they are the places the
 * answer wanted to say something it could not support - so they are carried
 * into the brief and marked, rather than deleted on the way. A clean-looking
 * report with the doubtful half removed is how these things get believed.
 */

/**
 * What a run would cost, before anything is spent.
 *
 * @returns {{cost:number, allowed:boolean, reason:string}}
 */
export function priceRun(round, { estimate = null } = {}) {
  const cost = Number.isFinite(Number(estimate)) ? Number(estimate) : 0
  if (!round) return { cost, allowed: false, reason: 'No round.' }
  // A round with no ceiling set is a round that has agreed to spend nothing.
  // The alternative default - unlimited - is the one that surprises people.
  if (!round.ceiling) {
    return cost > 0
      ? { cost, allowed: false, reason: 'No ceiling set, so this round reads the workspace and does not call a model.' }
      : { cost, allowed: true, reason: 'Reads the workspace. No model call, nothing to spend.' }
  }
  if (cost > round.ceiling) {
    return { cost, allowed: false, reason: `Would cost about $${cost.toFixed(2)}, over this round's $${round.ceiling.toFixed(2)} ceiling.` }
  }
  return { cost, allowed: true, reason: `About $${cost.toFixed(2)}, within the $${round.ceiling.toFixed(2)} ceiling.` }
}

/**
 * Turn one pipeline result into a brief.
 *
 * Kept claims become findings carrying the ids they cited. Cut claims become
 * findings carrying nothing, which is what marks them unverified - the state
 * is read off the finding rather than set beside it, so the two cannot
 * disagree.
 */
export function briefFrom(round, result, { cost = 0, now = new Date() } = {}) {
  const kept = (result?.critique?.kept || [])
    .map((claim) => makeFinding(claim, citationsIn(claim)))
    .filter(Boolean)
  const cut = (result?.critique?.cut || [])
    .map((entry) => makeFinding(entry?.claim ?? entry, []))
    .filter(Boolean)

  return makeBrief({
    roundId: round?.id || null,
    question: round?.question || result?.question || '',
    at: iso(now),
    findings: [...kept, ...cut],
    cost,
  })
}

/**
 * Run a round.
 *
 * `ask` is the pipeline - injected so this is testable without an index and
 * without a model, and so a caller can decide whether a model is involved at
 * all. A round that never calls one still produces a real brief: retrieval and
 * the Critic are local, and most standing questions about your own workspace
 * are answerable from it.
 *
 * Never throws. A round that fails produces a brief saying it failed, because
 * a standing job that goes quiet is indistinguishable from one that found
 * nothing, and the second is a much nicer thing to believe.
 */
export async function runRound(round, { ask, estimate = 0, now = new Date() } = {}) {
  const priced = priceRun(round, { estimate })
  if (!priced.allowed) {
    return makeBrief({
      roundId: round?.id || null,
      question: round?.question || '',
      at: iso(now),
      findings: [],
      cost: 0,
      skipped: priced.reason,
    })
  }

  try {
    const result = await ask(round.question)
    return briefFrom(round, result, { cost: priced.cost, now })
  } catch (error) {
    return makeBrief({
      roundId: round?.id || null,
      question: round?.question || '',
      at: iso(now),
      findings: [],
      cost: 0,
      skipped: `Did not finish: ${error?.message || 'unknown error'}`,
    })
  }
}

/** A one-line reading of a brief, for a list. */
export function summarise(brief) {
  if (!brief) return ''
  if (brief.skipped) return brief.skipped
  if (!brief.findings.length) return 'Nothing to report.'
  const parts = [`${brief.verified} finding${brief.verified === 1 ? '' : 's'}`]
  if (brief.unverified) parts.push(`${brief.unverified} unverified`)
  return parts.join(', ')
}
