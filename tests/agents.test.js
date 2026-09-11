import test from 'node:test'
import assert from 'node:assert/strict'

import { corpusFrom, indexCorpus, retrieve, brief } from '../src/agents/librarian.js'
import { analyse, contradictions, measures, subject } from '../src/agents/analyst.js'
import { cardsFrom, schedule, queue, progress, keyTerm } from '../src/agents/tutor.js'
import { plan, summarise } from '../src/agents/planner.js'
import { review, verdict, claims, citationsIn } from '../src/agents/critic.js'
import { run, assemble, promptFor, AGENTS } from '../src/agents/pipeline.js'
import { makeGene } from '../src/genome/gene.js'
import { confirm, cite } from '../src/genome/evolve.js'

const NOW = new Date('2026-09-11T12:00:00Z')

const entity = (id, type, title, body, tags = []) => ({
  id, type, title, body, tags, people: [], at: NOW.toISOString(), updatedAt: NOW.toISOString(), meta: {},
})

const WORKSPACE = [
  entity('risk_1', 'risk', 'The rollback script has never been run against production data',
    'Nobody has tested the rollback script since March. It has never been run against production data.', ['atlas']),
  entity('note_3', 'note', 'The rollback script was run against production data last week',
    'We did run the rollback script against production data last week and it completed in 40 minutes.', ['atlas']),
  entity('metric_4', 'metric', 'p99 latency is 264 ms on the new cluster',
    'Measured p99 latency is 264 ms on the new cluster under load.', ['infra']),
  entity('note_5', 'note', 'p99 latency is 180 ms on the new cluster',
    'The dashboard reports p99 latency is 180 ms on the new cluster.', ['infra']),
  entity('task_2', 'task', 'Rewrite the rollback script for the write path',
    'Priya is rewriting the rollback script for the write path before the cutover.', ['atlas']),
]

const wellEvidenced = () => {
  let gene = makeGene({
    claim: 'The rollback script is the riskiest part of the Atlas cutover',
    topic: 'rollback',
    body: 'Every incident review of the Atlas migration has come back to the rollback script.',
    sources: ['risk_1', 'task_2'],
    now: NOW,
  })
  for (let i = 0; i < 6; i += 1) gene = confirm(gene, NOW)
  for (let i = 0; i < 9; i += 1) gene = cite(gene, NOW)
  return gene
}

const build = (genes = []) => indexCorpus(corpusFrom(WORKSPACE, genes))

/* ---------------------------------------------------------- Librarian */

test('the Librarian finds a record by a word only in its body', () => {
  const hits = retrieve(build(), 'March', { now: NOW })
  assert.equal(hits[0].id, 'risk_1')
})

test('the Librarian returns nothing rather than guessing at an empty question', () => {
  for (const nothing of ['', '   ', 'the a of']) {
    assert.deepEqual(retrieve(build(), nothing, { now: NOW }), [])
  }
})

test('every passage carries what it takes to cite it', () => {
  for (const p of retrieve(build([wellEvidenced()]), 'rollback script', { now: NOW })) {
    assert.ok(p.id && p.title && p.kind)
    assert.ok(Number.isFinite(p.score))
    assert.ok(p.why.relevance > 0)
  }
})

test('a well-evidenced claim is weighted above the raw text it came from', () => {
  const gene = wellEvidenced()
  const strong = retrieve(build([gene]), 'riskiest part of the Atlas cutover', { now: NOW })
  const strongRank = strong.findIndex((p) => p.id === gene.id)

  // The same claim with nothing behind it must rank lower than when it has
  // six confirmations and nine citations - that is what fitness buys.
  const weak = makeGene({ claim: gene.claim, topic: gene.topic, body: gene.body, now: NOW })
  const weakHits = retrieve(build([weak]), 'riskiest part of the Atlas cutover', { now: NOW })
  const weakScore = weakHits.find((p) => p.id === weak.id)?.score
  const strongScore = strong[strongRank]?.score

  assert.ok(strongScore > weakScore, `${strongScore} should beat ${weakScore}`)
})

test('a retired claim is never retrieved', () => {
  const gene = { ...wellEvidenced(), retired: true }
  const hits = retrieve(build([gene]), 'riskiest part of the Atlas cutover', { now: NOW })
  assert.equal(hits.some((p) => p.id === gene.id), false)
})

test('the brief labels every passage with the id that cites it', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const text = brief(passages)
  for (const p of passages) assert.ok(text.includes(`[[${p.id}]]`), p.id)
})

/* ------------------------------------------------------------ Analyst */

test('the Analyst catches a flat contradiction', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const found = contradictions(passages)
  const pair = found.find((f) => f.between.includes('risk_1') && f.between.includes('note_3'))
  assert.ok(pair, 'never run against production data vs was run against production data')
  assert.equal(pair.kind, 'negation')
})

test('the Analyst catches two different figures for the same measure', () => {
  const passages = retrieve(build(), 'p99 latency new cluster', { now: NOW })
  const found = contradictions(passages)
  const pair = found.find((f) => f.kind === 'measure')
  assert.ok(pair, '264 ms against 180 ms')
  assert.match(pair.why, /264|180/)
})

test('a claim whose body is empty still reads as a denial', () => {
  // The corpus text already opens with the title, so prepending the title
  // counts its negators twice - and "has never been run" with two "never"s
  // parses as a positive claim, losing the contradiction entirely.
  const bare = [
    entity('risk_x', 'risk', 'the rollback script has never been run against production data', '', ['risks']),
    entity('note_x', 'note', 'The rollback script was run against production data last week',
      'We did run the rollback script against production data last week and it finished in 40 minutes.', ['atlas']),
  ]
  const passages = retrieve(indexCorpus(corpusFrom(bare, [])), 'rollback script production data', { now: NOW })
  const found = contradictions(passages)
  assert.equal(found.length, 1, JSON.stringify(passages.map((p) => p.id)))
  assert.equal(found[0].kind, 'negation')
})

test('a long document is judged on the sentence that is about the subject', () => {
  // A meeting note contains the word "not" somewhere. Judging the whole
  // document by that says it denies everything in it, and pairs it with every
  // short claim that agrees with it.
  const long = [
    entity('doc_x', 'doc', 'Atlas weekly sync.md',
      'The cutover went out with no downtime. Support saw three tickets. The rollback script was run against production data last week. We are not changing the plan.', ['markdown']),
    entity('note_y', 'note', 'The rollback script was run against production data',
      'The rollback script was run against production data and it finished.', ['atlas']),
  ]
  const passages = retrieve(indexCorpus(corpusFrom(long, [])), 'rollback script production data', { now: NOW })
  assert.deepEqual(contradictions(passages), [], 'these agree; a stray "not" elsewhere must not say otherwise')
})

test('the Analyst stays quiet about passages that merely share a word', () => {
  const unrelated = [
    { id: 'a', title: 'The invoice was paid on Tuesday', text: 'The invoice was paid on Tuesday.', excerpt: null },
    { id: 'b', title: 'The cluster was resized on Tuesday', text: 'The cluster was resized on Tuesday.', excerpt: null },
  ]
  assert.deepEqual(contradictions(unrelated), [], 'sharing "Tuesday" is not a disagreement')
})

test('two sources saying the same thing in different words agree', () => {
  // Grouping by an exact hash of the content words sounds stricter and is
  // useless: nobody writes the same fact twice with the identical vocabulary,
  // so nothing ever agrees with anything.
  const same = [
    entity('p3', 'note', 'The cutover runbook is out of date',
      'The cutover runbook is out of date and nobody has revised it since phase one.', ['atlas']),
    entity('p4', 'decision', 'The cutover runbook is out of date',
      'Marco confirmed the cutover runbook is out of date after the phase one retro.', ['atlas']),
  ]
  const passages = retrieve(indexCorpus(corpusFrom(same, [])), 'cutover runbook out of date', { now: NOW })
  const result = analyse(passages, { question: 'cutover runbook out of date' })
  assert.equal(result.agreement.length, 1)
  assert.equal(result.agreement[0].count, 2)

  const proposals = plan(result, passages, { now: NOW })
  assert.ok(proposals.some((p) => p.kind === 'remember'), 'agreement is what earns a claim a file')
})

test('passages that contradict each other are not also counted as agreeing', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const found = contradictions(passages)
  const agreed = analyse(passages, { question: 'rollback script production data' }).agreement
  for (const clash of found) {
    for (const group of agreed) {
      const both = clash.between.every((id) => group.sources.includes(id))
      assert.equal(both, false, `${clash.between.join(' vs ')} cannot both disagree and agree`)
    }
  }
})

test('a word in the question that nothing answers is reported as a gap', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const result = analyse(passages, { question: 'rollback script kubernetes budget' })
  assert.ok(result.gaps.includes('kubernetes'))
  assert.ok(result.gaps.includes('budget'))
  assert.equal(result.confident, false)
})

test('measures reads figures with their units and ignores bare numbers', () => {
  const found = measures('p99 latency is 264 ms, up from 180 ms across 3 clusters')
  assert.ok(found.some((m) => m.value === 264 && m.unit === 'ms'))
  assert.ok(found.some((m) => m.value === 180 && m.unit === 'ms'))
})

test('the subject of a sentence ignores the words that flip it', () => {
  const withNot = subject('The script has not been run')
  const without = subject('The script has been run')
  assert.deepEqual([...withNot].sort(), [...without].sort(), 'negation must not change the subject')
})

/* -------------------------------------------------------------- Critic */

test('the Critic cuts a claim citing something that was never retrieved', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const result = review('The cutover is on Friday [[task_9999]].\n\nIt has never been run [[risk_1]].', passages)
  assert.equal(result.ok, false)
  assert.equal(result.kept.length, 1)
  assert.match(result.cut[0].reason, /not among the passages/)
})

test('the Critic cuts a quote that is not in what it cites', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const result = review('The note said "the rollback completed in four seconds flat" [[risk_1]].', passages)
  assert.equal(result.kept.length, 0)
  assert.match(result.cut[0].reason, /does not appear/)
})

test('the Critic keeps a quote that is really there', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const result = review('The note says "never been run against production data" [[risk_1]].', passages)
  assert.equal(result.ok, true)
})

test('the Critic cuts an assertion that cites nothing at all', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const result = review('The cutover will go fine.', passages)
  assert.equal(result.kept.length, 0)
  assert.match(result.cut[0].reason, /without citing/)
})

test('a citation at the end of a sentence is not orphaned from it', () => {
  // The splitter must not treat "[[" as the start of a new sentence: that
  // leaves one half citing nothing and one half saying nothing, and both get
  // cut even though the claim was perfectly good.
  assert.deepEqual(claims('It has not run since March. [[risk_1]]'), ['It has not run since March. [[risk_1]]'])
  assert.deepEqual(claims('One [[a]]. Two [[b]].'), ['One [[a]].', 'Two [[b]].'])
})

test('citationsIn reads every id, in order', () => {
  assert.deepEqual(citationsIn('a [[one]] b [[two]] c [[one]]'), ['one', 'two', 'one'])
  assert.deepEqual(citationsIn('nothing here'), [])
})

test('the verdict says what happened', () => {
  assert.equal(verdict({ kept: [], cut: [], cited: [] }).grade, 'unusable')
  assert.equal(verdict({ kept: ['a'], cut: [], cited: ['x'] }).grade, 'clean')
  assert.equal(verdict({ kept: ['a'], cut: [{}], cited: ['x'] }).grade, 'trimmed')
})

/* --------------------------------------------------------------- Tutor */

test('a card hides the load-bearing word, not a filler one', () => {
  const cards = cardsFrom(retrieve(build(), 'p99 latency', { now: NOW }), { now: NOW })
  const card = cards.find((c) => /\d/.test(c.answer))
  assert.ok(card, 'a figure is exactly what is worth remembering')
  assert.ok(card.question.includes('______'))
  assert.equal(card.question.includes(card.answer), false, 'the answer must not still be in the question')
})

test('one card per passage, so one paragraph is not ten ways to ask the same thing', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const cards = cardsFrom(passages, { now: NOW })
  assert.equal(new Set(cards.map((c) => c.source)).size, cards.length)
})

test('keyTerm prefers a figure, then a rare word, and never a filler', () => {
  assert.equal(keyTerm('The p99 latency was 264 milliseconds under load'), '264')
  assert.equal(['the', 'was', 'under'].includes(String(keyTerm('The script was run under load')).toLowerCase()), false)
})

test('SM-2 stretches the interval on success and resets it on a lapse', () => {
  let card = cardsFrom(retrieve(build(), 'rollback script', { now: NOW }), { now: NOW })[0]
  card = schedule(card, 5, { now: NOW })
  assert.equal(card.interval, 1)
  card = schedule(card, 5, { now: NOW })
  assert.equal(card.interval, 6)
  card = schedule(card, 5, { now: NOW })
  assert.ok(card.interval > 6)

  const failed = schedule(card, 1, { now: NOW })
  assert.equal(failed.interval, 0)
  assert.equal(failed.repetitions, 0)
  assert.equal(failed.lapses, 1)
  assert.ok(failed.ease < card.ease)
})

test('ease never falls below the floor, or the card is shown forever', () => {
  let card = cardsFrom(retrieve(build(), 'rollback script', { now: NOW }), { now: NOW })[0]
  for (let i = 0; i < 40; i += 1) card = schedule(card, 0, { now: NOW })
  assert.ok(card.ease >= 1.3, `${card.ease}`)
})

test('the queue puts the cards you keep failing first', () => {
  const cards = cardsFrom(retrieve(build(), 'rollback script production data latency', { now: NOW }), { now: NOW })
  const lapsed = { ...cards[1], lapses: 4 }
  const order = queue([cards[0], lapsed], { now: NOW }).map((c) => c.id)
  assert.equal(order[0], lapsed.id)
})

test('progress counts what is due and what is learned', () => {
  const cards = cardsFrom(retrieve(build(), 'rollback script', { now: NOW }), { now: NOW })
  const learned = { ...cards[0], repetitions: 4, interval: 30, due: new Date(NOW.getTime() + 30 * 86400000).toISOString() }
  const stats = progress([learned], { now: NOW })
  assert.equal(stats.learned, 1)
  assert.equal(stats.due, 0)
})

/* ------------------------------------------------------------- Planner */

test('a contradiction becomes a task to settle it, and cites both sides', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const proposals = plan(analyse(passages, { question: 'rollback script' }), passages, { now: NOW })
  const resolve = proposals.find((p) => p.kind === 'resolve')
  assert.ok(resolve)
  assert.equal(resolve.apply.type, 'task')
  assert.equal(resolve.evidence.length, 2)
  assert.match(resolve.apply.body, /\[\[risk_1\]\]|\[\[note_3\]\]/)
})

test('the Planner proposes and never writes', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const proposals = plan(analyse(passages, { question: 'rollback' }), passages, { now: NOW })
  for (const p of proposals) {
    assert.ok(p.apply, 'a proposal carries what would be written')
    assert.ok(p.why, 'and why')
  }
})

test('the Planner does not propose a task that already exists', () => {
  const passages = retrieve(build(), 'rollback script production data', { now: NOW })
  const analysis = analyse(passages, { question: 'rollback script' })
  const first = plan(analysis, passages, { now: NOW })
  assert.ok(first.length > 0)

  const again = plan(analysis, passages, { now: NOW, existing: new Set(first.map((p) => p.title)) })
  assert.equal(again.length, 0, 'proposing the same task twice is how people stop reading suggestions')
})

test('a claim worth keeping is not deduplicated against the record it came from', () => {
  // The proposal's text IS the text of a passage that exists - that is what
  // makes it worth keeping. Checked against one combined set, every such
  // proposal removes itself and the genome never gains anything.
  const same = [
    entity('p3', 'note', 'The cutover runbook is out of date',
      'The cutover runbook is out of date and nobody has revised it since phase one.', ['atlas']),
    entity('p4', 'decision', 'The cutover runbook is out of date',
      'Marco confirmed the cutover runbook is out of date after the phase one retro.', ['atlas']),
  ]
  const passages = retrieve(indexCorpus(corpusFrom(same, [])), 'cutover runbook out of date', { now: NOW })
  const analysis = analyse(passages, { question: 'cutover runbook out of date' })

  const existing = new Set(same.map((e) => e.title))
  const offered = plan(analysis, passages, { now: NOW, existing })
  assert.ok(offered.some((p) => p.kind === 'remember'), 'the record existing is the reason, not an objection')

  // But once the genome already says it, it is not offered again.
  const claims = new Set(['The cutover runbook is out of date'])
  const again = plan(analysis, passages, { now: NOW, existing, claims })
  assert.equal(again.some((p) => p.kind === 'remember'), false)
})

test('summarise says what was proposed without anybody counting', () => {
  assert.equal(summarise([]), 'Nothing to propose.')
  assert.match(summarise([{ kind: 'resolve' }, { kind: 'resolve' }, { kind: 'gap' }]), /2 contradictions.*1 gap/)
})

/* ------------------------------------------------------------ pipeline */

test('the whole pipeline runs with no model and no network', async () => {
  const gene = wellEvidenced()
  const result = await run('rollback script production data latency', { index: build([gene]), genes: [gene], now: NOW })

  assert.ok(result.answer.length > 0)
  assert.equal(result.usedModel, false)
  assert.equal(result.critique.verdict.grade, 'clean', JSON.stringify(result.critique.cut))
  assert.ok(result.analysis.contradictions.length >= 1)
  assert.ok(result.cards.length > 0)
  assert.ok(result.proposals.length > 0)
})

test('every claim in the assembled answer carries a citation', async () => {
  const result = await run('rollback script production data', { index: build(), now: NOW })
  for (const claim of claims(result.answer)) {
    assert.ok(citationsIn(claim).length > 0, claim)
  }
})

test('a model that invents a citation is refused and the answer still stands', async () => {
  const result = await run('rollback script', {
    index: build(),
    now: NOW,
    write: async () => 'The cutover is on Friday [[task_9999]] and all is well [[made_up]].',
  })
  assert.equal(result.usedModel, false)
  assert.ok(result.answer.length > 0, 'a lying model must not leave the person with nothing')
  assert.equal(result.answer.includes('task_9999'), false)
})

test('a model that cites properly is used', async () => {
  const result = await run('rollback script', {
    index: build(),
    now: NOW,
    write: async ({ system }) => {
      const ids = [...system.split('Passages:')[1].matchAll(/\[\[([a-z0-9_]+)\]\]/gi)].map((m) => m[1])
      return `The rollback script has never been run against production data [[${ids[0]}]].`
    },
  })
  assert.equal(result.usedModel, true)
  assert.match(result.answer, /never been run/)
})

test('a provider that throws does not cost the answer', async () => {
  const result = await run('rollback script', {
    index: build(),
    now: NOW,
    write: async () => { throw new Error('503') },
  })
  assert.equal(result.usedModel, false)
  assert.ok(result.answer.length > 0)
})

test('the prompt hands the model no id it could copy by mistake', () => {
  const passages = retrieve(build(), 'rollback script', { now: NOW })
  const { system } = promptFor('rollback script', passages)
  const instructions = system.split('Passages:')[0]
  assert.deepEqual(citationsIn(instructions), [], 'an example id in the instructions is an id a model will cite')
})

test('a question that matches nothing says so instead of inventing', async () => {
  const result = await run('xylophone tessellation', { index: build(), now: NOW })
  assert.equal(result.passages.length, 0)
  assert.equal(assemble([], { contradictions: [], gaps: [] }), 'Nothing in your workspace matches that.')
  assert.deepEqual(result.proposals.filter((p) => p.kind === 'resolve'), [])
})

test('the answer reports which genes it leaned on, so they can be credited', async () => {
  const gene = wellEvidenced()
  const result = await run('riskiest part of the Atlas cutover', { index: build([gene]), genes: [gene], now: NOW })
  assert.deepEqual(result.citedGenes, [gene.id])
})

test('all five agents are declared, and each says what it does', () => {
  assert.equal(AGENTS.length, 5)
  for (const agent of AGENTS) {
    assert.ok(agent.id && agent.label && agent.does)
  }
})
