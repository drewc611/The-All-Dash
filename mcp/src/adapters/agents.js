/*
 * The five agents, over MCP.
 *
 * The same Librarian, Analyst, Tutor, Planner and Critic the browser runs -
 * imported from src/agents rather than reimplemented, so a contradiction
 * means the same thing to Claude as it does on screen. The only difference is
 * where the state lives: the browser writes through its store, this writes
 * into the workspace export file.
 *
 * Two things this deliberately does not do.
 *
 * It never calls a model. The pipeline takes an optional writer for the prose
 * and it is not passed one here, because the caller of these tools is already
 * a model - handing it an answer another model wrote would put two of them in
 * series with nobody checking the first. What comes back is the assembled
 * answer: the person's own sentences, each with the citation that supports
 * it, and the Critic's verdict on all of it.
 *
 * It never writes without being asked. `agents_ask` is read-only, including
 * the crediting that the browser does automatically - an agent exploring a
 * workspace should not be able to change which claims survive simply by
 * asking about them often enough. Crediting is its own tool.
 */

import { withFileLock } from './workspace.js'
import { corpusFrom, indexCorpus } from '../../../src/agents/librarian.js'
import { run, AGENTS } from '../../../src/agents/pipeline.js'
import { schedule, queue as dueQueue, progress } from '../../../src/agents/tutor.js'
import { normaliseStudy } from '../../../src/agents/study-schema.js'
import { isGene, toGene, toEntity, genesIn } from '../../../src/genome/entity.js'
import { absorb, cull, cite, confirm, contradict, explainFitness } from '../../../src/genome/evolve.js'
import { serialiseGene, genePath } from '../../../src/genome/gene.js'
import { makeEntity } from '../../../src/data/schema.js'
import { iso } from '../../../src/core/time.js'
import { uid } from '../../../src/core/id.js'

export const ROSTER = AGENTS

const round = (n) => Number(Number(n).toFixed(3))

export class AgentsAdapter {
  constructor(workspace) {
    this.workspace = workspace
  }

  /**
   * The corpus, from the export.
   *
   * The export carries records and the genome; the saved articles live in a
   * separate stash export, so retrieval here is over everything except the
   * full article text. Saying that plainly matters - an agent that silently
   * searched less than the browser does would give quietly worse answers.
   */
  async #corpus(force = false) {
    const state = await this.workspace.load(force)
    const entities = Object.values(state.entities || {})
    const genes = genesIn(state)
    return { state, entities, genes, index: indexCorpus(corpusFrom(entities, genes)) }
  }

  /** Run the five. Read-only. */
  async ask(question, { limit = 8 } = {}) {
    const { entities, genes, index } = await this.#corpus()
    const result = await run(question, {
      index,
      genes,
      limit,
      existing: new Set(entities.filter((e) => !isGene(e)).map((e) => e.title)),
      claims: new Set(genes.map((g) => g.claim)),
    })

    return {
      question,
      answer: result.answer,
      critic: result.critique.verdict,
      cut: result.critique.cut,
      passages: result.passages.map((p) => ({
        id: p.id,
        kind: p.kind === 'gene' ? 'claim' : p.entityType || p.kind,
        title: p.title,
        why: { relevance: round(p.why.relevance), fitness: p.why.fitness === null ? null : round(p.why.fitness) },
      })),
      contradictions: result.analysis.contradictions,
      agreement: result.analysis.agreement,
      // A word in the question that nothing retrieved mentions. The honest
      // form of "I do not know about that".
      gaps: result.analysis.gaps,
      proposals: result.proposals.map((p) => ({ kind: p.kind, title: p.title, why: p.why, evidence: p.evidence })),
      cards: result.cards.length,
      citedClaims: result.citedGenes,
      note: 'Assembled from the workspace, not written by a model. Saved article text lives in the stash export and is not searched here.',
    }
  }

  /** The genome, ranked. */
  async genome({ includeRetired = false, limit = 50 } = {}) {
    const { genes } = await this.#corpus()
    return genes
      .filter((g) => includeRetired || !g.retired)
      .map((g) => ({
        id: g.id,
        claim: g.claim,
        topic: g.topic,
        generation: g.generation,
        parents: g.parents,
        sources: g.sources,
        cited: g.cited,
        confirmed: g.confirmed,
        contradicted: g.contradicted,
        retired: g.retired,
        path: genePath(g),
        ...Object.fromEntries(Object.entries(explainFitness(g)).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v])),
      }))
      .sort((a, b) => b.fitness - a.fitness)
      .slice(0, limit)
  }

  /** One claim as the Markdown file it is. */
  async file(id) {
    const { genes } = await this.#corpus()
    const gene = genes.find((g) => g.id === id)
    if (!gene) throw new Error(`No claim ${id}`)
    return { path: genePath(gene), markdown: serialiseGene(gene) }
  }

  /* ------------------------------------------------------------- writes */

  #persist(state, genes) {
    for (const gene of genes) {
      state.entities[gene.id] = toEntity(gene, state.entities[gene.id] || null)
    }
  }

  learn(evidence) {
    return withFileLock(this.workspace.file, () => this.#learn(evidence))
  }

  async #learn(evidence) {
    const { state } = await this.#corpus(true)
    const result = absorb(genesIn(state), evidence, { now: new Date() })
    this.#persist(state, [...result.added, ...result.confirmed, ...result.contradicted])
    await this.workspace.save()
    return {
      added: result.added.map((g) => ({ id: g.id, claim: g.claim })),
      confirmed: result.confirmed.map((g) => ({ id: g.id, claim: g.claim, confirmed: g.confirmed })),
      contradicted: result.contradicted.map((g) => ({ id: g.id, claim: g.claim, contradicted: g.contradicted })),
    }
  }

  judge(id, verdict) {
    return withFileLock(this.workspace.file, () => this.#judge(id, verdict))
  }

  async #judge(id, verdict) {
    const { state } = await this.#corpus(true)
    const gene = genesIn(state).find((g) => g.id === id)
    if (!gene) throw new Error(`No claim ${id}`)
    const now = new Date()
    const next = verdict === 'confirm' ? confirm(gene, now) : verdict === 'contradict' ? contradict(gene, now) : cite(gene, now)
    this.#persist(state, [next])
    await this.workspace.save()
    return { id: next.id, claim: next.claim, ...explainFitness(next) }
  }

  prune() {
    return withFileLock(this.workspace.file, () => this.#prune())
  }

  async #prune() {
    const { state } = await this.#corpus(true)
    const { population, retired, revived } = cull(genesIn(state), { now: new Date() })
    const moved = new Set([...retired, ...revived].map((g) => g.id))
    this.#persist(state, population.filter((g) => moved.has(g.id)))
    await this.workspace.save()
    return {
      retired: retired.map((g) => ({ id: g.id, claim: g.claim })),
      revived: revived.map((g) => ({ id: g.id, claim: g.claim })),
    }
  }

  /**
   * Apply a Planner proposal.
   *
   * Named `apply` rather than done inside `ask` on purpose: the Planner
   * proposes and a person decides, and that rule does not stop applying
   * because the person in the loop happens to be an agent.
   */
  applyProposal(proposal) {
    return withFileLock(this.workspace.file, () => this.#applyProposal(proposal))
  }

  async #applyProposal({ kind, title, body = '', claim = '', sources = [] }) {
    if (kind === 'remember') {
      const result = await this.#learn([{ claim: claim || title, body, topic: 'agents', sources, tags: ['agents'] }])
      return { kind, ...result }
    }
    const state = await this.workspace.load(true)
    const entity = makeEntity({
      id: uid('task'),
      type: 'task',
      title,
      body,
      status: 'open',
      tags: ['agents'],
      meta: { editedByUser: true },
      source: { kind: 'agents', name: 'The agents' },
    })
    state.entities[entity.id] = entity
    await this.workspace.save()
    return { kind, id: entity.id, title: entity.title }
  }

  /* -------------------------------------------------------------- study */

  async study({ limit = 10 } = {}) {
    const state = await this.workspace.load()
    const cards = Object.values(normaliseStudy(state.study).cards)
    const now = new Date()
    return {
      ...progress(cards, { now }),
      queue: dueQueue(cards, { now, limit }).map((c) => ({
        id: c.id, question: c.question, source: c.source, lapses: c.lapses, repetitions: c.repetitions,
      })),
    }
  }

  grade(id, score) {
    return withFileLock(this.workspace.file, () => this.#grade(id, score))
  }

  async #grade(id, score) {
    const state = await this.workspace.load(true)
    const study = normaliseStudy(state.study)
    const card = study.cards[id]
    if (!card) throw new Error(`No card ${id}`)
    const next = schedule(card, score, { now: new Date() })
    state.study = { ...study, cards: { ...study.cards, [id]: next } }
    await this.workspace.save()
    return { id, answer: card.answer, interval: next.interval, ease: round(next.ease), due: next.due, lapses: next.lapses }
  }

  /** Every claim as the directory of Markdown files it would export as. */
  async files() {
    const { genes } = await this.#corpus()
    const out = {}
    for (const gene of genes) out[genePath(gene)] = serialiseGene(gene)
    return out
  }
}

export const touched = (iso8601) => iso8601 || iso(new Date())
