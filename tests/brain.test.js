import test from 'node:test'
import assert from 'node:assert/strict'

import { buildBrain, normaliseBrainState, emptyBrainState, clusters } from '../src/brain/learn.js'
import { renderBrain, signature, slugify } from '../src/brain/markdown.js'
import { zipFiles, listZip, crc32 } from '../src/brain/bundle.js'
import { buildTriage } from '../src/engine/triage.js'
import { aboutUser, buildContext } from '../src/ai/context.js'
import { makeEntity } from '../src/data/schema.js'
import { addDays, iso } from '../src/core/time.js'
import { VIEW_LABELS, labelOfView } from '../src/core/views.js'
import { readFileSync } from 'node:fs'

const now = new Date()
const at = (offset, hour = 12) => { const d = addDays(now, offset); d.setHours(hour, 0, 0, 0); return iso(d) }
const map = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]))

/** A workspace with enough history for the rules to say something. */
function fixture() {
  const rows = []
  const task = (title, extra) => rows.push(makeEntity({ type: 'task', title, status: 'open', ...extra }))
  // #infra: four finished in the app, three of them late
  task('Rewrite rollback', { status: 'done', due: at(-10), updatedAt: at(-8), createdAt: at(-20), meta: { editedByUser: true }, tags: ['infra'], people: ['Priya'] })
  task('Benchmark p99', { status: 'done', due: at(-9), updatedAt: at(-7), createdAt: at(-19), meta: { editedByUser: true }, tags: ['infra'], people: ['Marco'] })
  task('Warm old cluster', { status: 'done', due: at(-6), updatedAt: at(-5), createdAt: at(-16), meta: { editedByUser: true }, tags: ['infra'], people: ['Priya'] })
  task('Rotate keys', { status: 'done', due: at(-4), updatedAt: at(-6), createdAt: at(-14), meta: { editedByUser: true }, tags: ['infra'], people: ['Priya'] })
  // #comms: finished early
  task('Draft comms', { status: 'done', due: at(-2), updatedAt: at(-5), createdAt: at(-12), meta: { editedByUser: true }, tags: ['comms'], people: ['Sam'] })
  task('Send comms', { status: 'done', due: at(-1), updatedAt: at(-4), createdAt: at(-11), meta: { editedByUser: true }, tags: ['comms'], people: ['Sam'] })
  // open work, Priya carrying most of it
  task('Failover drill', { due: at(1), createdAt: at(-3), tags: ['infra'], people: ['Priya'] })
  task('Cluster teardown', { due: at(5), createdAt: at(-3), tags: ['infra'], people: ['Priya'] })
  task('Residency note', { due: at(4), createdAt: at(-3), tags: ['compliance'], people: ['Priya'] })
  task('Vendor call', { due: at(6), createdAt: at(-3), tags: ['compliance'], people: ['Priya'] })
  task('Board deck', { due: at(8), createdAt: at(-3), tags: ['comms'], people: ['Sam'] })
  task('Nobody owns this', { due: at(9), createdAt: at(-3), tags: ['compliance'] })
  task('Nor this', { due: at(10), createdAt: at(-3), tags: ['compliance'] })
  task('Or this', { due: at(11), createdAt: at(-3), tags: ['compliance'] })
  // meetings, mostly on one weekday
  const wednesday = addDays(now, ((3 - now.getDay() + 7) % 7) - 7)
  for (let i = 0; i < 6; i++) rows.push(makeEntity({ type: 'event', title: `Sync ${i}`, at: iso(addDays(wednesday, -7 * i)), people: ['Priya', 'Sam'] }))
  rows.push(makeEntity({ type: 'event', title: 'One-off', at: at(-3), people: ['Marco'] }))
  const usage = { ...emptyBrainState().usage, sessions: 12, views: { today: 5, triage: 20, analytics: 2 } }
  usage.hours[9] = 8; usage.hours[10] = 9; usage.hours[16] = 5
  usage.weekdays[1] = 6; usage.weekdays[3] = 8
  return {
    workspace: { name: 'Atlas', createdAt: at(-30) },
    entities: map(rows),
    docs: [{ id: 'd1', kind: 'markdown', name: 'notes.md' }, { id: 'd2', kind: 'ics', name: 'cal.ics' }],
    brain: { ...emptyBrainState(), profile: { name: 'Drew', role: 'PM', focus: 'Atlas' }, usage },
    settings: { assistant: {} },
  }
}

test('the brain derives people, topics and habits from the entities alone', () => {
  const brain = buildBrain(fixture(), { now })
  const priya = brain.people.find((p) => p.name === 'Priya')
  assert.equal(priya.open, 4)
  assert.equal(priya.done, 3)
  assert.ok(priya.with.includes('Sam'))
  const infra = brain.topics.find((t) => t.tag === 'infra')
  assert.equal(infra.finished, 4)
  assert.equal(infra.slipRate, 0.75)
  assert.equal(brain.habits.finished, 6)
  assert.equal(brain.habits.finishedLate, 3)
  assert.equal(brain.profile.name, 'Drew')
  assert.equal(brain.profile.documents, 2)
  assert.ok(brain.facts.some((f) => /Works most with Priya/.test(f)))
  assert.ok(brain.facts.some((f) => /Usually here 9am-11am/.test(f)), brain.facts.join('\n'))
})

test('opinions carry evidence and effects, and respect what the person decided', () => {
  const state = fixture()
  const brain = buildBrain(state, { now })
  const ids = brain.opinions.map((o) => o.id)
  assert.ok(ids.includes('slip:infra'), ids.join(', '))
  assert.ok(ids.includes('overload:Priya'))
  assert.ok(ids.includes('unowned:compliance'))
  assert.ok(ids.includes('start-view:triage'))
  assert.ok(ids.some((id) => id.startsWith('meeting-day:')))
  const slip = brain.opinions.find((o) => o.id === 'slip:infra')
  assert.deepEqual(slip.effect, { kind: 'promote-tag', tag: 'infra' })
  assert.ok(slip.evidence.length >= 2)
  assert.equal(slip.status, 'pending')

  state.brain.accepted['slip:infra'] = { at: iso(now), text: slip.text, effect: slip.effect }
  state.brain.dismissed['overload:Priya'] = iso(now)
  const again = buildBrain(state, { now })
  assert.equal(again.opinions.find((o) => o.id === 'slip:infra').status, 'accepted')
  assert.equal(again.opinions.find((o) => o.id === 'overload:Priya').status, 'dismissed')
})

test('an empty workspace has no opinions and a garbage brain state normalises', () => {
  const brain = buildBrain({ entities: {}, docs: [], brain: { usage: { hours: 'nope' }, accepted: 'x' } }, { now })
  assert.equal(brain.opinions.length, 0)
  assert.equal(brain.people.length, 0)
  const b = normaliseBrainState({ usage: { hours: [1, 2] }, notes: null })
  assert.equal(b.usage.hours.length, 24)
  assert.deepEqual(b.notes, {})
  assert.deepEqual(clusters(Array(24).fill(0)), [])
})

test('accepted opinions raise triage rows one step and say why', () => {
  const state = fixture()
  const plain = buildTriage(state.entities, { now, brain: null })
  const drill = plain.find((s) => s.kind === 'due-soon' && s.title === 'Failover drill')
  assert.equal(drill.severity, 'warning')
  state.brain.accepted['slip:infra'] = { at: iso(now), effect: { kind: 'promote-tag', tag: 'infra' } }
  state.brain.accepted['overload:Priya'] = { at: iso(now), effect: { kind: 'watch-person', person: 'Priya' } }
  const raised = buildTriage(state.entities, { now, brain: state.brain })
  const drill2 = raised.find((s) => s.kind === 'due-soon' && s.title === 'Failover drill')
  assert.equal(drill2.severity, 'serious')
  assert.match(drill2.why, /Raised by your brain: #infra usually slips; Priya is overloaded/)
  assert.deepEqual(drill2.brain, ['#infra usually slips', 'Priya is overloaded'])
  // a row the effects do not touch is unchanged
  const deck = raised.find((s) => s.title === 'Board deck')
  assert.equal(deck, undefined)
})

test('the brain renders to stable Markdown files with front matter and the person\'s notes', () => {
  const state = fixture()
  state.brain.notes['people/priya.md'] = 'Prefers async updates.'
  const brain = buildBrain(state, { now })
  const files = renderBrain(brain, state.brain)
  const paths = files.map((f) => f.path)
  assert.deepEqual(paths.slice(0, 4), ['README.md', 'profile.md', 'habits.md', 'insights.md'])
  assert.ok(paths.includes('people/priya.md'))
  assert.ok(paths.includes('topics/infra.md'))
  const priya = files.find((f) => f.path === 'people/priya.md').text
  assert.match(priya, /^---\nname: Priya\nopen: 4\n/)
  assert.match(priya, /## Notes\n\nPrefers async updates\.\n$/)
  const readme = files.find((f) => f.path === 'README.md').text
  assert.match(readme, /# Drew's brain/)
  assert.match(readme, /no model is involved/)
  const profile = files.find((f) => f.path === 'profile.md').text
  assert.match(profile, /formats: \[markdown, ics\]/)
  assert.match(profile, /Finished after the due date: 50%/)
  // signature ignores the generated timestamp
  const later = renderBrain(buildBrain(state, { now: new Date(now.getTime() + 1000) }), state.brain)
  assert.equal(signature(files), signature(later))
  state.brain.notes['people/priya.md'] = 'Changed.'
  assert.notEqual(signature(files), signature(renderBrain(brain, state.brain)))
  assert.equal(slugify('Priya Raman-Ó'), 'priya-raman-o')
})

test('the zip bundle lists every file and carries correct CRCs', () => {
  const files = [{ path: 'README.md', text: '# hi\n' }, { path: 'people/sam.md', text: 'Sam' }]
  const bytes = zipFiles(files, { now, prefix: 'brain/' })
  assert.equal(bytes[0], 0x50)
  assert.equal(bytes[1], 0x4b)
  assert.deepEqual(listZip(bytes), ['brain/README.md', 'brain/people/sam.md'])
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

test('the assistant context carries what the brain knows unless sharing is off', () => {
  const state = fixture()
  const lines = aboutUser(state, now)
  assert.ok(lines[0].startsWith('Name and role: Drew, PM; focused on Atlas.'))
  const ctx = buildContext(state.entities, 'what is late?', { state, now })
  assert.match(ctx.text, /About the user \(learned by rules/)
  state.settings.assistant.shareBrain = false
  const quiet = buildContext(state.entities, 'what is late?', { state, now })
  assert.doesNotMatch(quiet.text, /About the user/)
})


// --------------------------------------------------------------- view names

test('a fact never names a view the app does not show', () => {
  // The rail calls this view Boards; its id is `work`. The brain printed the
  // id, so the Today dashboard advised "Opens work most" about a view nobody
  // can find in the app. Naming something the person cannot go and look at is
  // worse than saying nothing.
  const state = fixture()
  state.brain.usage.views = { work: 9 }
  const [fact] = buildBrain(state, { now }).facts.filter((f) => /view you open most|more than any other view/.test(f))
  assert.ok(fact, 'no fact about views at all')
  assert.match(fact, /Boards/, 'the view is not named the way the rail names it')
  assert.doesNotMatch(fact, /\bwork\b/, 'the raw view id reached a person')
})

test('the one-view fact is a sentence rather than a list of one', () => {
  // `Opens ${views.join(', then ')} most.` produced "Opens today most." for a
  // single view, which reads as "opens most today" and does not name the view
  // at all. Every other id had the same shape; `today` is the one where the
  // collision is total.
  const state = fixture()
  state.brain.usage.views = { today: 7 }
  const [fact] = buildBrain(state, { now }).facts.filter((f) => /view you open most/.test(f))
  assert.equal(fact, 'Today is the view you open most.')
})

test('several views are listed in order, by label', () => {
  const state = fixture()
  state.brain.usage.views = { work: 30, today: 20, triage: 10 }
  const [fact] = buildBrain(state, { now }).facts.filter((f) => /more than any other view/.test(f))
  assert.equal(fact, 'Opens Boards, then Today, then Triage, more than any other view.')
})

test('the rail and the brain read the same labels', () => {
  // One source, so they cannot drift back apart. The rail used to carry its
  // own strings and the brain had no idea they existed.
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const nav = [...app.matchAll(/\{ id: '([a-z]+)', label: VIEW_LABELS\.([a-z]+)/g)]
  assert.ok(nav.length >= 12, `expected the whole rail, read ${nav.length} entries`)
  for (const [, id, key] of nav) {
    assert.equal(id, key, `the rail's ${id} view takes its label from VIEW_LABELS.${key}`)
    assert.ok(VIEW_LABELS[id], `no label for the ${id} view`)
  }
  assert.doesNotMatch(app, /\{ id: '[a-z]+', label: '/, 'a view went back to a hand-written label')
})

test('an unknown view id is shown rather than hidden', () => {
  // A usage counter can outlive the view it counted. Showing the id is honest;
  // "undefined" or a blank is not.
  assert.equal(labelOfView('some-removed-view'), 'some-removed-view')
})
