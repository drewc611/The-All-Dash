/*
 * The Planner: turns a finding into something on a board.
 *
 * It proposes; it never writes. Every proposal comes back as a draft entity
 * with the passage that caused it attached, and the person applies it. That
 * is the same rule the board automations follow - the engine decides, the
 * store writes - and it is the only arrangement where an agent that gets
 * something wrong costs you a dismissed suggestion rather than a corrupted
 * workspace.
 *
 * What it proposes is deliberately narrow. A contradiction between two things
 * you have written is worth a task, because somebody has to decide which one
 * is true. A gap in what the Librarian could find is worth a task, because
 * the answer is that you have not saved the thing yet. A claim confirmed from
 * several independent sources is worth writing into the genome, because that
 * is a belief that has earned a file. Everything else is left alone: an agent
 * that generates twelve tasks from one question is an agent whose output
 * nobody reads.
 */

import { hashId } from '../core/id.js'
import { iso } from '../core/time.js'

const DAY = 86400000

/** A proposal is a draft, not a record. `apply` is what the store is handed. */
const proposal = ({ kind, title, why, evidence, apply }) => ({
  id: hashId('plan', `${kind}:${title.toLowerCase()}`),
  kind,
  title,
  why,
  evidence,
  apply,
})

/**
 * Plan from one analysed retrieval.
 *
 * @param {object} analysis  from the Analyst
 * @param {object[]} passages from the Librarian
 * @param {{question?: string, now?: Date, existing?: Set<string>}} options
 *        `existing` is the titles already in the workspace, so the Planner
 *        does not propose a task that is already sitting on a board - the
 *        fastest way to make somebody stop reading suggestions.
 */
export function plan(analysis, passages, { question = '', now = new Date(), existing = new Set() } = {}) {
  const byId = new Map(passages.map((p) => [p.id, p]))
  const seen = new Set([...existing].map((t) => String(t).toLowerCase().trim()))
  const out = []

  const push = (item) => {
    const key = item.title.toLowerCase().trim()
    if (seen.has(key)) return
    seen.add(key)
    out.push(item)
  }

  for (const clash of analysis.contradictions || []) {
    const [a, b] = clash.between.map((id) => byId.get(id)).filter(Boolean)
    if (!a || !b) continue
    push(proposal({
      kind: 'resolve',
      title: `Decide which is right: ${a.title.slice(0, 48)} or ${b.title.slice(0, 48)}`,
      why: clash.why,
      evidence: clash.between,
      apply: {
        type: 'task',
        title: `Decide which is right: ${a.title.slice(0, 48)} or ${b.title.slice(0, 48)}`,
        body: `${clash.why}\n\nSources: ${clash.between.map((id) => `[[${id}]]`).join(' ')}`,
        // Soon, but not today: a contradiction is worth deciding this week
        // and is almost never worth dropping what you are doing for.
        due: iso(new Date(now.getTime() + 3 * DAY)),
        priority: 1,
        tags: ['agents', 'contradiction'],
      },
    }))
  }

  for (const word of (analysis.gaps || []).slice(0, 3)) {
    push(proposal({
      kind: 'gap',
      title: `Save something about "${word}"`,
      why: `"${word}" is in the question and in nothing you have saved.`,
      evidence: [],
      apply: {
        type: 'task',
        title: `Save something about "${word}"`,
        body: question ? `Came up while asking: ${question}` : '',
        priority: 0,
        tags: ['agents', 'gap'],
      },
    }))
  }

  for (const agreed of (analysis.agreement || []).slice(0, 3)) {
    if (agreed.count < 2) continue
    const sources = agreed.sources.map((id) => byId.get(id)).filter(Boolean)
    if (!sources.length) continue
    push(proposal({
      kind: 'remember',
      title: sources[0].title.slice(0, 90),
      why: `Said by ${agreed.count} independent sources.`,
      evidence: agreed.sources,
      apply: {
        type: 'gene',
        claim: sources[0].title.slice(0, 200),
        body: sources.map((s) => s.excerpt?.text || s.text || '').join('\n\n').slice(0, 1200),
        sources: agreed.sources,
        tags: ['agents'],
      },
    }))
  }

  return out
}

/** A one-line account of what the Planner did, for a screen that should not
    make anybody count cards to find out. */
export const summarise = (proposals) => {
  if (!proposals.length) return 'Nothing to propose.'
  const counts = proposals.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] || 0) + 1 }), {})
  const parts = []
  if (counts.resolve) parts.push(`${counts.resolve} contradiction${counts.resolve === 1 ? '' : 's'} to settle`)
  if (counts.gap) parts.push(`${counts.gap} gap${counts.gap === 1 ? '' : 's'} to fill`)
  if (counts.remember) parts.push(`${counts.remember} claim${counts.remember === 1 ? '' : 's'} worth keeping`)
  return parts.join(', ')
}
