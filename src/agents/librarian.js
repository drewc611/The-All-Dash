/*
 * The Librarian: finds the passages, and never says anything of its own.
 *
 * Retrieval is the one step in this pipeline that may never be done by a
 * model, however good the model is. A retriever that invents a passage has
 * not made a mistake, it has removed the only reason to trust anything
 * downstream of it - every other agent here is grounded in what this one
 * returns, so if this one can hallucinate, all five can.
 *
 * So it is the BM25 index the stash already uses, over three populations at
 * once: the workspace records, the saved articles, and the genome. One index,
 * because a question about the rollback script should find the risk, the
 * article and the claim you wrote about it without you choosing which drawer
 * to look in.
 *
 * Ranking is BM25 relevance multiplied by a source weight and, for a gene, by
 * its fitness. A claim that has been confirmed nine times and cited fourteen
 * outranks the passage it was drawn from, which is the whole point of having
 * written it down.
 */

import { buildIndex, search as bm25, parseQuery, snippet } from '../stash/search.js'
import { fitness } from '../genome/evolve.js'

/*
 * What each kind of source is worth before relevance is considered.
 *
 * A gene is a claim somebody already distilled and something has since stood
 * behind, so it starts ahead of the raw material. A saved article is somebody
 * else's words, so it starts behind a record the person wrote themselves.
 * These are small nudges - relevance still decides - and they exist so that
 * ties break towards the thing with more of the person in it.
 */
const WEIGHT = { gene: 1.25, entity: 1.0, page: 0.9 }

/*
 * Two strings per document, and they are not the same string.
 *
 * `text` is what gets indexed, and tags belong in it - searching for a tag
 * should find what carries it. `display` is what an answer, a card and the
 * contradiction test read, and tags must not be in that: a claim rendered as
 * "the rollback script has never been run against production data risks
 * atlas" has had its filing system read out as if it were part of the
 * sentence.
 */
const indexedText = (entity) => [entity.title, entity.body, (entity.tags || []).join(' ')].filter(Boolean).join('\n')
const readableText = (entity) => [entity.title, entity.body].filter(Boolean).join('\n')

/**
 * Build the corpus the Librarian searches.
 *
 * @param {object[]} entities the workspace
 * @param {object[]} genes    the genome
 * @param {Map<string,string>} articles snapshotId -> full article text
 */
export function corpusFrom(entities = [], genes = [], articles = new Map()) {
  const docs = []
  for (const entity of entities) {
    if (entity.type === 'gene') continue // genes come from the genome, with their scores
    const article = entity.meta?.snapshotId ? articles.get(entity.meta.snapshotId) : ''
    docs.push({
      id: entity.id,
      title: entity.title,
      text: article || indexedText(entity),
      display: article || readableText(entity),
      kind: entity.type === 'page' ? 'page' : 'entity',
      entityType: entity.type,
      rev: `${entity.updatedAt || ''}`,
    })
  }
  for (const gene of genes) {
    if (gene.retired) continue
    docs.push({
      id: gene.id,
      title: gene.claim,
      text: `${gene.claim}\n${gene.body}`,
      display: `${gene.claim}\n${gene.body}`,
      kind: 'gene',
      gene,
      rev: `${gene.changed || ''}:${gene.generation}`,
    })
  }
  return docs
}

/** The index, kept by the caller so it can be synced rather than rebuilt. */
export const indexCorpus = (docs) => buildIndex(docs)

/**
 * Retrieve.
 *
 * Returns passages with everything a later agent needs to cite them, and
 * nothing it needs to guess at. `why` carries the arithmetic so the UI can
 * show why a passage came back, which is the difference between a retriever
 * you can debug and one you have to believe.
 */
export function retrieve(index, question, { limit = 8, now = new Date() } = {}) {
  const query = parseQuery(question)
  if (!query.terms.length && !query.phrases.length) return []

  // Ask for more than we need: re-weighting below changes the order, so
  // cutting to `limit` before that would drop passages that should have won.
  const hits = bm25(index, question, { limit: limit * 4 })
  return hits
    .map((hit) => {
      const doc = hit.doc || {}
      const weight = WEIGHT[doc.kind] ?? 1
      const fit = doc.kind === 'gene' ? fitness(doc.gene, now) : 1
      return {
        id: hit.id,
        kind: doc.kind,
        entityType: doc.entityType || null,
        title: doc.title || '',
        // Everything downstream reads prose, never the indexed form.
        text: doc.display || doc.text || '',
        gene: doc.gene || null,
        score: hit.score * weight * (doc.kind === 'gene' ? 0.5 + 0.5 * fit : 1),
        why: { relevance: hit.score, weight, fitness: doc.kind === 'gene' ? fit : null },
        excerpt: snippet(doc.display || doc.text || '', question),
      }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/**
 * The passages, as the block an answer is built from.
 *
 * Every passage is labelled with the id that cites it, because the Critic
 * downstream checks that each citation resolves and a passage nobody can
 * address cannot be cited correctly by anyone.
 */
export function brief(passages) {
  return passages
    .map((p) => `[[${p.id}]] ${p.kind === 'gene' ? 'claim' : p.entityType || p.kind}: ${p.title}\n${(p.excerpt?.text || p.text || '').slice(0, 600)}`)
    .join('\n\n')
}
