/*
 * Five agents, in the order that makes each one's output checkable.
 *
 *   Librarian  finds passages                     always deterministic
 *   Analyst    finds contradictions and gaps      always deterministic
 *   Tutor      cuts cards from the passages       always deterministic
 *   Planner    proposes tasks and new claims      always deterministic
 *   Critic     cuts anything that cannot be cited always deterministic
 *
 * A model, when one is configured, does exactly one job: writing the prose
 * answer from the passages the Librarian returned. Everything that decides
 * what is true - what was retrieved, what contradicts what, what gets
 * remembered, what survives - is arithmetic, and stays arithmetic.
 *
 * That split is the whole design. It means the pipeline works with no key and
 * no network, it means the model cannot introduce a fact that is not in your
 * own material, and it means the Critic is checking a model's output against
 * the same passages the deterministic path would have used. Turning the model
 * off changes how the answer reads, not what it says.
 */

import { retrieve, brief } from './librarian.js'
import { analyse } from './analyst.js'
import { cardsFrom } from './tutor.js'
import { plan, summarise } from './planner.js'
import { review, verdict } from './critic.js'

export const AGENTS = [
  { id: 'librarian', label: 'Librarian', does: 'Finds the passages and never says anything of its own.' },
  { id: 'analyst', label: 'Analyst', does: 'Finds what the passages say together: contradictions, agreement, gaps.' },
  { id: 'tutor', label: 'Tutor', does: 'Cuts cards from your own material and schedules them.' },
  { id: 'planner', label: 'Planner', does: 'Proposes tasks and claims worth keeping. Never writes them.' },
  { id: 'critic', label: 'Critic', does: 'Cuts every claim that cannot be traced to a passage.' },
]

/**
 * The answer, assembled without a model.
 *
 * It is made of the person's own sentences, each with its citation attached,
 * ordered by how well the passage scored. It reads like notes rather than
 * prose, and it is honest about that - the alternative is a template that
 * pretends to be writing and produces "Based on the available information,
 * it appears that..." forever.
 */
export function assemble(passages, analysis, { question = '' } = {}) {
  if (!passages.length) return 'Nothing in your workspace matches that.'

  const lines = []
  for (const p of passages.slice(0, 5)) {
    const text = (p.excerpt?.text || p.text || '').split(/(?<=[.!?])\s+/)[0] || p.title
    lines.push(`${text.trim().replace(/\s+$/, '')} [[${p.id}]]`)
    lines.push('')
  }

  // One sentence each, opening with the citations. Any phrasing that puts a
  // full stop before the ids splits into a half that cites nothing, and the
  // Critic then cuts the most useful line in the answer.
  for (const clash of analysis.contradictions) {
    lines.push(`${clash.between.map((id) => `[[${id}]]`).join(' and ')} disagree: ${clash.why.charAt(0).toLowerCase()}${clash.why.slice(1)}`)
  }

  // Gaps deliberately do not go in the answer. A gap has nothing to cite -
  // that is what makes it a gap - and the rule that every claim carries a
  // citation only means anything if there are no exceptions to it. The
  // caller gets them in `analysis.gaps` and the UI shows them beside the
  // answer rather than inside it.
  // Blank lines between them, so each passage is its own claim. Joined with
  // single newlines the Critic sees one enormous claim, and one bad citation
  // anywhere in it would take the whole answer down.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** The prompt a model gets: the passages, and a hard rule about citing them. */
export function promptFor(question, passages) {
  return {
    system: [
      'You answer only from the passages given. You may not add a fact that is not in them.',
      // Deliberately not a realistic-looking id. An example id in the prompt
      // is an id the model will cheerfully cite, and a citation that came
      // from the instructions rather than the passages is exactly what the
      // Critic exists to catch - better not to hand it the temptation.
      'Cite every claim by writing its passage id in double brackets, copied exactly from the list below.',
      'A sentence that states something without a citation will be deleted before the person sees it, so cite everything.',
      'Do not invent an id. Only the ids listed under Passages exist.',
      'Be brief. No preamble, no restatement of the question.',
      '',
      'Passages:',
      brief(passages),
    ].join('\n'),
    user: question,
  }
}

/**
 * Run the five.
 *
 * `write` is an optional async (prompt) => string. When it is absent, or
 * throws, or returns something the Critic cannot stand up, the deterministic
 * answer is used instead. A model failure degrades the prose and never the
 * facts.
 */
export async function run(question, { index, genes = [], existing = new Set(), claims = new Set(), write = null, now = new Date(), limit = 8 } = {}) {
  const passages = retrieve(index, question, { limit, now })
  const analysis = analyse(passages, { question })

  let answer = assemble(passages, analysis, { question })
  let wrote = false
  if (write && passages.length) {
    try {
      const drafted = await write(promptFor(question, passages))
      const draft = String(drafted || '').trim()
      // The model's answer has to survive the same Critic. If it does not
      // beat the assembled one on claims that stand up, it is not used.
      // The bar is whether everything it said stands up, not whether it said
      // more. Comparing lengths would hand every round to the assembled
      // answer, which is five passages laid end to end and will always have
      // more claims in it than a model being concise.
      if (draft) {
        const checked = review(draft, passages)
        if (checked.ok) {
          answer = checked.kept.join('\n\n')
          wrote = true
        }
      }
    } catch {
      // A dead provider is not a reason to have no answer.
    }
  }

  const checked = review(answer, passages)
  const finalAnswer = checked.kept.join('\n\n')
  const cards = cardsFrom(passages, { now })
  const proposals = plan(analysis, passages, { question, now, existing, claims })

  return {
    question,
    passages,
    analysis,
    answer: finalAnswer,
    critique: { ...checked, verdict: verdict(checked) },
    cards,
    proposals,
    summary: summarise(proposals),
    // Which genes the answer leaned on, so the caller can credit them - this
    // is what keeps a useful claim from decaying out of the genome.
    citedGenes: checked.cited.filter((id) => genes.some((g) => g.id === id)),
    usedModel: wrote,
  }
}
