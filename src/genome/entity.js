/*
 * A gene as an entity, and back.
 *
 * Separate from store.js because two very different callers need this
 * conversion: the browser, which writes through the app's store, and the MCP
 * server, which writes into a workspace export file on disk. Sharing the
 * conversion is the reason a claim means the same thing in both - the
 * alternative is two implementations that agree until the day they do not.
 *
 * The Markdown file is the truth and the entity carries it: `body` holds the
 * serialised file, `meta` holds the same fields parsed out so that queries,
 * filters and the UI do not have to re-parse Markdown to sort by fitness.
 * They are written together and read back through parseGene, so the file
 * remains the thing you could walk away with.
 */

import { makeEntity } from '../data/schema.js'
import { serialiseGene, parseGene, genePath } from './gene.js'
import { fitness } from './evolve.js'

export const isGene = (entity) => entity?.type === 'gene'

/** The entity back into the gene it carries. */
export const toGene = (entity) => ({
  ...parseGene(entity.body || ''),
  // The entity id is authoritative: it is what citations resolve against.
  id: entity.id,
})

/** Every gene in a state object, as genes rather than as entities. */
export const genesIn = (state) => Object.values(state?.entities || {}).filter(isGene).map(toGene)

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
