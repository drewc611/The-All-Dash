#!/usr/bin/env node
/**
 * Train the layout model and write src/layout/weights.json.
 *
 *   node scripts/train-layout.mjs [--steps 3000] [--batch 32] [--lr 0.002] [--seed 1] [--out src/layout/weights.json]
 *
 * The weights are committed, so nothing needs to run this to use the app. Run
 * it when the widget catalogue or the teacher's rules change: a test compares
 * the catalogue fingerprint stored in the weights against the current one and
 * fails until they agree.
 *
 * It prints what a model like this is easy to oversell on, so the numbers sit
 * next to the things they should be compared with: a board that never changes,
 * the most common answer per widget, and the teacher's own noise ceiling.
 */

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createModel, exportWeights, paramCount, rng } from '../src/layout/nn.js'
import { ARCHITECTURE, CLASSES, UNKNOWN_WIDGET, VALUES, fingerprint, sizeIndex } from '../src/layout/catalogue.js'
import { idealBoard, sampleExample, toExample } from '../src/layout/teacher.js'
import { createTrainer, schedule, classesOf } from '../src/layout/train.js'
import { evaluateModel, score } from '../src/layout/evaluate.js'
import { getState } from '../src/core/store.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const steps = Number(args.steps ?? 3000)
const batchSize = Number(args.batch ?? 32)
const peak = Number(args.lr ?? 0.002)
const seed = Number(args.seed ?? 1)
const out = args.out ?? fileURLToPath(new URL('../src/layout/weights.json', import.meta.url))

const pct = (x) => `${(x * 100).toFixed(1)}%`
const show = (label, s) =>
  console.log(`  ${label.padEnd(34)} accuracy ${pct(s.accuracy).padStart(6)}   visibility F1 ${pct(s.visibilityF1).padStart(6)}   size ${pct(s.sizeAgreement).padStart(6)}   whole board ${pct(s.exact).padStart(6)}`)

// ------------------------------------------------------------------ train

const init = rng(seed)
const model = createModel(ARCHITECTURE, init)
const trainer = createTrainer(model, { lr: peak })
const stream = rng(seed + 1)
const heldOut = Array.from({ length: 300 }, () => sampleExample(rng(777 + stream.int(1e6)))).map(toExample)

console.log(`catalogue ${fingerprint()}, ${paramCount(ARCHITECTURE)} parameters, ${steps} steps of ${batchSize}`)
const started = Date.now()
let running = 0
for (let step = 0; step < steps; step++) {
  const batch = Array.from({ length: batchSize }, () => toExample(sampleExample(stream)))
  const { loss } = trainer.step(batch, { rate: schedule(step, steps, peak) })
  running = step === 0 ? loss : running * 0.97 + loss * 0.03
  if ((step + 1) % 100 === 0 || step === steps - 1) {
    const e = (step + 1) % 500 === 0 || step === steps - 1 ? `  held-out accuracy ${pct(evaluateModel(model, heldOut).accuracy)}` : ''
    console.log(`step ${String(step + 1).padStart(5)}  loss ${running.toFixed(4)}  ${((Date.now() - started) / 1000).toFixed(0)}s${e}`)
  }
}

// --------------------------------------------------------------- evaluate

// A fixed, separate stream: the model has never seen these situations.
const testRandom = rng(424242)
const samples = Array.from({ length: 2000 }, () => sampleExample(testRandom))
const examples = samples.map(toExample)

console.log('\nheld-out, 2000 situations the model has not seen')
const model_ = evaluateModel(model, examples)
show('transformer', model_)

// The ceiling: the teacher's own board with the noise taken off, scored against
// the noisy labels the model was trained to match. Nothing can beat this on
// average, because the gap is randomness the situation does not explain.
const ceiling = score(samples.map((s) => idealBoard(s.widgets, s.values, s.persona)), samples.map((s) => s.labels))
show('ceiling (teacher without noise)', ceiling)

// Most common label per widget, learned from a separate draw.
const tally = new Map()
const key = (w) => (w.wid === UNKNOWN_WIDGET ? `cat:${w.category}` : `id:${w.id}`)
for (const s of Array.from({ length: 4000 }, () => sampleExample(rng(5 + stream.int(1e6))))) {
  s.widgets.forEach((w, i) => {
    const t = tally.get(key(w)) || new Array(CLASSES.length).fill(0)
    t[s.labels[i]] += 1
    tally.set(key(w), t)
  })
}
const mode = (w) => {
  const t = tally.get(key(w)) || [1, 0, 0, 0, 0]
  return t.indexOf(Math.max(...t))
}
show('most common answer per widget', score(samples.map((s) => s.widgets.map(mode)), samples.map((s) => s.labels)))

// The board a fresh install has today, applied to every situation.
const fixed = new Map(getState().boards.today.map((i) => [i.widgetId, i.size]))
show('today\'s default board, unchanged', score(
  samples.map((s) => s.widgets.map((w) => (w.id && fixed.has(w.id) ? sizeIndex(fixed.get(w.id)) + 1 : 0))),
  samples.map((s) => s.labels),
))

// Does it read the situation at all? Give every example somebody else's.
const swapped = examples.map((ex, i) => ({ ...ex, ctx: examples[(i + 1) % examples.length].ctx }))
show('control: situation swapped for another', score(swapped.map((ex) => classesOf(model, ex)), examples.map((ex) => ex.labels)))

// Widgets it has never met: the plugin case, scored on those slots alone.
let slots = 0
let kept = 0
let shownRight = 0
let shown = 0
examples.forEach((ex, e) => {
  const got = classesOf(model, ex)
  ex.widgets.forEach((w, i) => {
    if (w.wid !== UNKNOWN_WIDGET) return
    slots += 1
    if (got[i] === ex.labels[i]) kept += 1
    if (ex.labels[i] > 0) {
      shown += 1
      if (got[i] > 0) shownRight += 1
    }
  })
})
console.log(`\nwidgets it has never met (${slots} slots): class accuracy ${pct(kept / slots)}, of those the teacher shows ${shown}, it shows ${shownRight}`)

const metrics = {
  heldOut: model_,
  ceiling,
  unseenWidgets: { slots, accuracy: kept / slots },
  examples: 2000,
}

const file = {
  format: 1,
  fingerprint: fingerprint(),
  architecture: ARCHITECTURE,
  values: VALUES,
  training: { seed, steps, batch: batchSize, peakLearningRate: peak, source: 'src/layout/teacher.js simulator' },
  metrics,
  weights: exportWeights(model),
}
writeFileSync(out, JSON.stringify(file) + '\n')
console.log(`\nwrote ${out} (${(JSON.stringify(file).length / 1024).toFixed(0)} KB)`)
