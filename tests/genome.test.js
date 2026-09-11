import test from 'node:test'
import assert from 'node:assert/strict'

import { makeGene, parseGene, serialiseGene, genePath, emptyGene } from '../src/genome/gene.js'
import {
  fitness, support, usefulness, recency, confirm, contradict, cite, mutate, cull, absorb, living,
  FITNESS_FLOOR, HALF_LIFE_DAYS, explainFitness,
} from '../src/genome/evolve.js'

const NOW = new Date('2026-09-11T12:00:00Z')
const daysAgo = (n) => new Date(NOW.getTime() - n * 86400000)

const seed = (over = {}) => ({
  ...makeGene({
    claim: 'The rollback script has never been run against production data',
    topic: 'rollback',
    body: 'Nobody has tested it since March.',
    sources: ['risk_1'],
    now: NOW,
  }),
  ...over,
})

/* ------------------------------------------------------------ the file */

test('a gene round-trips through its own Markdown', () => {
  const gene = seed()
  const parsed = parseGene(serialiseGene(gene))
  for (const key of ['id', 'claim', 'topic', 'generation', 'cited', 'confirmed', 'contradicted', 'retired', 'born']) {
    assert.deepEqual(parsed[key], gene[key], key)
  }
  assert.deepEqual(parsed.sources, gene.sources)
})

test('the same claim learned twice is the same gene', () => {
  const a = makeGene({ claim: 'Latency is the problem', topic: 'infra', now: NOW })
  const b = makeGene({ claim: '  latency IS the problem  ', topic: 'infra', now: daysAgo(4) })
  assert.equal(a.id, b.id, 'case and surrounding space must not fork a claim')

  const c = makeGene({ claim: 'Latency is the problem', topic: 'pricing', now: NOW })
  assert.notEqual(a.id, c.id, 'the same sentence about a different topic is a different claim')
})

test('front matter that is not what it claims to be is survivable', () => {
  for (const junk of ['', 'no front matter at all', '---\nnot: closed', '---\n---\n', '---\n: :\n---\nbody']) {
    const gene = parseGene(junk)
    assert.equal(typeof gene.claim, 'string')
    assert.ok(gene.generation >= 1)
    assert.ok(Array.isArray(gene.sources))
  }
})

test('front matter cannot set the prototype of the gene', () => {
  // An imported file set the prototype of the entity map once already. A gene
  // file is another file somebody else can write.
  const gene = parseGene('---\n__proto__: polluted\nconstructor: polluted\nclaim: fine\n---\nbody')
  assert.equal(gene.claim, 'fine')
  assert.equal({}.polluted, undefined)
  assert.equal(Object.getPrototypeOf(gene), Object.prototype)
})

test('front matter cannot name a field the gene does not have', () => {
  const gene = parseGene('---\nclaim: real\nretired: true\nnonsense: 1\n---\nbody')
  assert.equal(gene.claim, 'real')
  assert.equal(gene.retired, true)
  assert.equal(Object.hasOwn(gene, 'nonsense'), false)
})

test('a claim with no body still gets one, and a file with no claim takes its first line', () => {
  assert.equal(makeGene({ claim: 'Just this', now: NOW }).body, 'Just this')
  assert.equal(parseGene('---\ntopic: x\n---\nFirst line here\nsecond').claim, 'First line here')
})

test('the path is a readable place in a directory of Markdown', () => {
  assert.equal(genePath(seed()), 'genome/rollback/the-rollback-script-has-never-been-run-against-production-da.md')
  assert.equal(genePath({ ...emptyGene(), id: 'gene_x', claim: '', topic: '' }), 'genome/general/gene_x.md')
})

/* ---------------------------------------------------------- selection */

test('a gene with no evidence either way sits at half, not at certain', () => {
  assert.equal(support(seed()), 0.5)
})

test('one contradiction does not throw out nine confirmations', () => {
  let gene = seed()
  for (let i = 0; i < 9; i += 1) gene = confirm(gene, NOW)
  gene = contradict(gene, NOW)
  assert.ok(support(gene) > 0.75 && support(gene) < 0.85, `${support(gene)}`)
})

test('citations saturate, so the fortieth counts less than the second', () => {
  let few = seed()
  let many = seed()
  for (let i = 0; i < 2; i += 1) few = cite(few, NOW)
  for (let i = 0; i < 40; i += 1) many = cite(many, NOW)
  const gainEarly = usefulness(few) - usefulness(seed())
  const gainLate = usefulness(many) - usefulness(few)
  assert.ok(gainEarly > gainLate, 'early citations must move it more than late ones')
})

test('a gene halves in value over the half-life', () => {
  const fresh = { ...seed(), changed: NOW.toISOString() }
  const old = { ...seed(), changed: daysAgo(HALF_LIFE_DAYS).toISOString() }
  assert.ok(Math.abs(recency(old, NOW) - 0.5) < 0.001)
  assert.ok(Math.abs(fitness(old, NOW) / fitness(fresh, NOW) - 0.5) < 0.001)
})

test('a gene with an unreadable timestamp is not treated as brand new', () => {
  assert.equal(recency({ ...seed(), changed: 'not a date', born: '' }, NOW), 0.5)
})

test('the floor is where the comments say it is', () => {
  // The comment in evolve.js promises ~95 days for an unevidenced, uncited
  // claim and ~132 with one confirmation. If the constants move, this fails
  // and the comment gets fixed with them.
  const bare = (days) => fitness({ ...seed(), changed: daysAgo(days).toISOString() }, NOW)
  assert.ok(bare(90) > FITNESS_FLOOR && bare(100) < FITNESS_FLOOR, `90:${bare(90)} 100:${bare(100)}`)

  const once = (days) => fitness({ ...confirm(seed(), NOW), changed: daysAgo(days).toISOString() }, NOW)
  assert.ok(once(125) > FITNESS_FLOOR && once(140) < FITNESS_FLOOR, `125:${once(125)} 140:${once(140)}`)
})

test('culling retires what has decayed and revives what comes back', () => {
  const stale = { ...seed(), changed: daysAgo(400).toISOString() }
  const first = cull([stale], { now: NOW })
  assert.equal(first.retired.length, 1)
  assert.equal(first.population[0].retired, true)

  // Confirming it is a person saying it still holds, which resets the clock.
  const back = cull([confirm(first.population[0], NOW)], { now: NOW })
  assert.equal(back.revived.length, 0, 'confirm already un-retires it')
  assert.equal(back.population[0].retired, false)
})

test('a retired gene is never offered for retrieval', () => {
  const alive = seed()
  const dead = { ...seed(), id: 'gene_dead', claim: 'other', retired: true }
  assert.deepEqual(living([alive, dead], NOW).map((g) => g.id), [alive.id])
})

/* ---------------------------------------------------------- mutation */

test('a reworded claim is a child, not an edit', () => {
  let parent = seed()
  for (let i = 0; i < 8; i += 1) parent = confirm(parent, NOW)
  for (let i = 0; i < 6; i += 1) parent = cite(parent, NOW)

  const child = mutate(parent, { claim: 'The rollback script was last run in March', now: NOW })
  assert.notEqual(child.id, parent.id)
  assert.equal(child.generation, parent.generation + 1)
  assert.deepEqual(child.parents, [parent.id])
  assert.equal(child.topic, parent.topic)
})

test('a child inherits its parent standing at a discount', () => {
  let parent = seed()
  for (let i = 0; i < 8; i += 1) parent = confirm(parent, NOW)
  for (let i = 0; i < 6; i += 1) parent = cite(parent, NOW)
  const child = mutate(parent, { claim: 'Something else entirely', now: NOW })

  assert.equal(child.confirmed, 4)
  assert.equal(child.cited, 3)
  // Ahead of a brand-new guess, behind the parent it descends from.
  const stranger = makeGene({ claim: 'A brand new thought', topic: 'rollback', now: NOW })
  assert.ok(fitness(child, NOW) > fitness(stranger, NOW))
  assert.ok(fitness(child, NOW) < fitness(parent, NOW))
})

test('lineage is kept but bounded', () => {
  let gene = seed()
  for (let i = 0; i < 12; i += 1) gene = mutate(gene, { claim: `Generation ${i}`, now: NOW })
  assert.equal(gene.generation, 13)
  assert.equal(gene.parents.length, 8, 'the trail is kept, not the whole family tree')
})

/* ----------------------------------------------------------- absorbing */

test('the same claim arriving again confirms it rather than duplicating it', () => {
  const first = absorb([], [{ claim: 'Latency is up', topic: 'infra', sources: ['a'] }], { now: NOW })
  assert.equal(first.added.length, 1)

  const second = absorb(first.population, [{ claim: 'Latency is up', topic: 'infra', sources: ['b'] }], { now: NOW })
  assert.equal(second.population.length, 1, 'one claim, not two')
  assert.equal(second.confirmed.length, 1)
  assert.deepEqual(second.population[0].sources, ['a', 'b'], 'both sources are kept')
})

test('evidence marked as contradicting counts against the claim', () => {
  const first = absorb([], [{ claim: 'Latency is up', topic: 'infra' }], { now: NOW })
  const second = absorb(first.population, [{ claim: 'Latency is up', topic: 'infra', contradicts: true }], { now: NOW })
  assert.equal(second.contradicted.length, 1)
  assert.equal(second.population[0].contradicted, 1)
  assert.ok(support(second.population[0]) < 0.5)
})

test('absorbing nothing, or nonsense, changes nothing', () => {
  const start = absorb([], [{ claim: 'Something', topic: 't' }], { now: NOW }).population
  const after = absorb(start, [{ claim: '' }, { claim: '   ' }, {}], { now: NOW })
  assert.equal(after.population.length, 1)
  assert.equal(after.added.length, 0)
})

test('explainFitness accounts for the score it reports', () => {
  let gene = seed()
  for (let i = 0; i < 3; i += 1) gene = confirm(gene, NOW)
  const parts = explainFitness(gene, NOW)
  assert.ok(Math.abs(parts.support * (0.5 + 0.5 * parts.usefulness) * parts.recency - parts.fitness) < 1e-12)
})
