/*
 * Selection.
 *
 * A memory that only ever grows is a memory that gets worse: every stale
 * claim you wrote down six months ago competes with the one that is currently
 * true, and retrieval has no way to tell them apart. So claims here are under
 * pressure. Three numbers decide whether one survives, and all three are
 * counts of things that actually happened rather than a model's opinion.
 *
 *   support     confirmed against contradicted
 *   usefulness  how often it has been cited in an answer
 *   recency     how long since anything touched it
 *
 * Fitness is their product. Below a floor a gene is retired - archived and
 * out of retrieval, never deleted, because "the app quietly threw away
 * something I wrote" is unforgivable and "the app stopped suggesting it" is
 * not.
 *
 * Mutation is the other half. When new evidence changes what a claim should
 * say, the gene does not get edited in place: a child is written with the new
 * wording, the parent is recorded, and the counters carry over discounted.
 * The lineage is in the file, so you can always read back how a belief got to
 * where it is - which is the thing every "AI memory" feature fails to give
 * you.
 */

import { iso } from '../core/time.js'
import { makeGene } from './gene.js'

const DAY = 86400000

/** After this long untouched, a gene is worth half what it was. Ninety days
    is a quarter: long enough that a stable fact survives a quiet season,
    short enough that last quarter's priorities stop outranking this one's. */
export const HALF_LIFE_DAYS = 90

/**
 * Below this, a gene stops being offered.
 *
 * Chosen against the decay curve rather than picked: a claim nothing has ever
 * confirmed and nothing has ever cited is retired after about 95 days, and
 * one confirmation with no citations buys it about 132. So a passing thought
 * lasts a quarter, and something you agreed with once lasts two.
 */
export const FITNESS_FLOOR = 0.12

/**
 * How well evidence supports the claim.
 *
 * Laplace-smoothed on purpose: a brand-new gene with no evidence either way
 * sits at 0.5 rather than at certainty, and a single contradiction against
 * nine confirmations moves it to 0.77 rather than throwing it out. One person
 * disagreeing once is not a refutation.
 */
export const support = (gene) => (gene.confirmed + 1) / (gene.confirmed + gene.contradicted + 2)

/**
 * How much use it has been. Saturating, because the difference between never
 * cited and cited twice matters and the difference between the fortieth and
 * the forty-first does not.
 */
export const usefulness = (gene) => 1 - 1 / (1 + gene.cited)

/** Exponential decay on the last time anything touched it. */
export function recency(gene, now = new Date()) {
  const changed = Date.parse(gene.changed || gene.born || '')
  if (!Number.isFinite(changed)) return 0.5
  const days = Math.max(0, (now.getTime() - changed) / DAY)
  return 2 ** (-days / HALF_LIFE_DAYS)
}

/**
 * Fitness in [0, 1].
 *
 * Usefulness is a multiplier between 0.5 and 1 rather than a factor from
 * zero: a claim that is well supported and recent but has never happened to
 * be cited is not worthless, it is just untested.
 */
export function fitness(gene, now = new Date()) {
  if (!gene) return 0
  return support(gene) * (0.5 + 0.5 * usefulness(gene)) * recency(gene, now)
}

/** Why it scores what it scores, for the UI - a number nobody can explain is
    a number nobody should act on. */
export function explainFitness(gene, now = new Date()) {
  return {
    fitness: fitness(gene, now),
    support: support(gene),
    usefulness: usefulness(gene),
    recency: recency(gene, now),
    retired: !!gene.retired,
  }
}

/** Evidence confirmed the claim. */
export const confirm = (gene, now = new Date()) => ({
  ...gene,
  confirmed: gene.confirmed + 1,
  changed: iso(now),
  retired: false,
})

/** Evidence contradicted it. */
export const contradict = (gene, now = new Date()) => ({
  ...gene,
  contradicted: gene.contradicted + 1,
  changed: iso(now),
})

/** An answer used it. This is what stops a good claim decaying. */
export const cite = (gene, now = new Date()) => ({
  ...gene,
  cited: gene.cited + 1,
  changed: iso(now),
})

/**
 * A child with the new wording.
 *
 * The counters carry over at a discount: a new generation inherits the
 * standing its parent earned, but it is not the same claim and has not itself
 * been confirmed by anything yet. Halving is the simplest rule that keeps a
 * long-lived lineage ahead of a brand-new guess without letting it coast
 * forever on evidence for a sentence it no longer says.
 */
export function mutate(gene, { claim, body = '', sources = [], now = new Date() }) {
  const child = makeGene({
    claim,
    topic: gene.topic,
    body: body || claim,
    sources: [...new Set([...gene.sources, ...sources])],
    tags: gene.tags,
    now,
  })
  if (!child) return gene
  return {
    ...child,
    generation: gene.generation + 1,
    parents: [...gene.parents, gene.id].slice(-8),
    cited: Math.floor(gene.cited / 2),
    confirmed: Math.floor(gene.confirmed / 2),
    contradicted: Math.floor(gene.contradicted / 2),
  }
}

/**
 * Retire what has fallen below the floor, and revive anything that has climbed
 * back above it. Returns the whole population plus what moved, because a UI
 * that cannot say "these four stopped being used, here they are" is asking to
 * be distrusted.
 */
export function cull(genes, { now = new Date(), floor = FITNESS_FLOOR } = {}) {
  const retired = []
  const revived = []
  const population = genes.map((gene) => {
    const score = fitness(gene, now)
    if (!gene.retired && score < floor) {
      retired.push(gene)
      return { ...gene, retired: true }
    }
    if (gene.retired && score >= floor) {
      revived.push(gene)
      return { ...gene, retired: false }
    }
    return gene
  })
  return { population, retired, revived }
}

/**
 * Fold new evidence into an existing population.
 *
 * Three outcomes per claim, and which one happens is decided by the claim
 * text rather than by similarity: an identical claim confirms the gene that
 * already says it, a claim that negates one contradicts it, and anything else
 * is new. No embedding, no threshold - a threshold loose enough to match a
 * rewording is loose enough to merge two claims that disagree, and merging
 * those is how a memory starts lying.
 */
export function absorb(population, evidence, { now = new Date() } = {}) {
  const byId = new Map(population.map((g) => [g.id, g]))
  const added = []
  const confirmed = []
  const contradicted = []

  for (const item of evidence) {
    const fresh = makeGene({ ...item, now })
    if (!fresh) continue
    const existing = byId.get(fresh.id)
    if (existing) {
      const next = item.contradicts ? contradict(existing, now) : confirm(existing, now)
      next.sources = [...new Set([...existing.sources, ...fresh.sources])]
      byId.set(next.id, next)
      ;(item.contradicts ? contradicted : confirmed).push(next)
      continue
    }
    byId.set(fresh.id, fresh)
    added.push(fresh)
  }
  return { population: [...byId.values()], added, confirmed, contradicted }
}

/** Ranked for retrieval: fitness breaks ties that relevance alone cannot, and
    a retired gene is never offered. */
export const living = (genes, now = new Date()) =>
  genes.filter((g) => !g.retired).sort((a, b) => fitness(b, now) - fitness(a, now))
