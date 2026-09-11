/*
 * The genome, in the workspace.
 *
 * A gene is an ordinary entity of type `gene`, the way a saved article is an
 * entity of type `page`. That is not a shortcut - it is the reason this
 * feature costs almost nothing to live with. A claim the agents learned turns
 * up in the Library, on the Timeline, in the command bar, in search and in
 * the export, and not one of those had to learn what a gene is.
 *
 * The Markdown file is the truth and the entity carries it: `body` holds the
 * serialised file, `meta` holds the same fields parsed out so that queries,
 * filters and the UI do not have to re-parse Markdown to sort by fitness.
 * They are written together and read back through parseGene, so the file
 * remains the thing you could walk away with.
 */

import { getState, mutate, addEntity, updateEntity, removeEntity } from '../core/store.js'
import { makeEntity } from '../data/schema.js'
import { iso } from '../core/time.js'
import { serialiseGene, parseGene, genePath } from './gene.js'
import { absorb, cull, cite, confirm, contradict, mutate as evolveGene, fitness } from './evolve.js'

export const isGene = (entity) => entity?.type === 'gene'

/** Every gene in the workspace, as genes rather than as entities. */
export function genes(state = getState()) {
  return Object.values(state.entities || {}).filter(isGene).map(toGene)
}

/** The entity back into the gene it carries. */
export const toGene = (entity) => ({
  ...parseGene(entity.body || ''),
  // The entity id is authoritative: it is what citations resolve against.
  id: entity.id,
})

/** The gene as the entity that holds it. */
export function toEntity(gene, existing = null) {
  const file = serialiseGene(gene)
  return makeEntity({
    ...(existing || {}),
    id: gene.id,
    type: 'gene',
    title: gene.claim,
    body: file,
    at: gene.changed || gene.born,
    tags: [...new Set(['gene', ...(gene.tags || [])])],
    people: existing?.people || [],
    meta: {
      kind: 'gene',
      path: genePath(gene),
      topic: gene.topic,
      generation: gene.generation,
      parents: gene.parents,
      sources: gene.sources,
      cited: gene.cited,
      confirmed: gene.confirmed,
      contradicted: gene.contradicted,
      retired: gene.retired,
      fitness: Number(fitness(gene).toFixed(4)),
      born: gene.born,
    },
    source: existing?.source || { docId: 'genome', name: 'The genome', kind: 'agents', url: '', line: null },
    confidence: 1,
  })
}

const write = (gene) => {
  const existing = getState().entities[gene.id]
  const entity = toEntity(gene, existing)
  if (existing) updateEntity(gene.id, entity)
  else addEntity(entity)
  return gene
}

/** Fold new claims into the genome. Returns what changed, for the UI to say. */
export function learn(evidence, { now = new Date() } = {}) {
  const result = absorb(genes(), evidence, { now })
  for (const gene of [...result.added, ...result.confirmed, ...result.contradicted]) write(gene)
  return result
}

/** An answer used these. This is what keeps a good claim from decaying. */
export function credit(ids, { now = new Date() } = {}) {
  const known = new Map(genes().map((g) => [g.id, g]))
  const credited = []
  for (const id of new Set(ids)) {
    const gene = known.get(id)
    if (!gene) continue
    credited.push(write(cite(gene, now)))
  }
  return credited
}

export const agree = (id, now = new Date()) => {
  const gene = genes().find((g) => g.id === id)
  return gene ? write(confirm(gene, now)) : null
}

export const disagree = (id, now = new Date()) => {
  const gene = genes().find((g) => g.id === id)
  return gene ? write(contradict(gene, now)) : null
}

/**
 * Reword a claim. The old generation is kept as its own record, so the
 * lineage stays readable - that is the point of a generation number.
 */
export function reword(id, claim, { body = '', now = new Date() } = {}) {
  const parent = genes().find((g) => g.id === id)
  if (!parent) return null
  const child = evolveGene(parent, { claim, body, now })
  if (child.id === parent.id) return parent
  write({ ...parent, retired: true, changed: iso(now) })
  return write(child)
}

/** Run selection over the whole population. */
export function prune({ now = new Date() } = {}) {
  const { population, retired, revived } = cull(genes(), { now })
  const moved = new Set([...retired, ...revived].map((g) => g.id))
  for (const gene of population) if (moved.has(gene.id)) write(gene)
  return { retired, revived }
}

/** Delete a gene outright. Only ever from a person asking. */
export const forget = (id) => removeEntity(id)

/** The genome as a directory of Markdown files, for the export. */
export function genomeFiles(state = getState()) {
  const files = {}
  for (const gene of genes(state)) files[genePath(gene)] = serialiseGene(gene)
  return files
}

/** Replace the whole population. Used by the tests and by a restore. */
export function seedGenome(list) {
  mutate((s) => {
    const entities = { ...s.entities }
    for (const gene of list) {
      const entity = toEntity(gene, entities[gene.id])
      entities[entity.id] = entity
    }
    return { ...s, entities }
  })
}
