import { database } from '../core/idb.js'
import { cloneModel, exportWeights, importWeights, rng } from './nn.js'
import { ARCHITECTURE, fingerprint, widgetIndex } from './catalogue.js'
import { encode, sampleExample, toExample } from './teacher.js'
import { createTrainer } from './train.js'
import { evaluateModel } from './evaluate.js'

/**
 * Teaching the model what one person keeps.
 *
 * The shipped weights come from a simulator. They know what a typical person
 * in a typical situation would want, and nothing about this one. The only
 * real labels in the whole system are the boards the person arranged for
 * themselves, so those are what this trains on: the same network, the same
 * code that trained the shipped weights, a few hundred small steps, in the
 * browser, with nothing leaving it.
 *
 * Two things keep it from going wrong. Every step mixes simulated examples in
 * with the person's own, so it learns their habits without unlearning how to
 * read a situation. And the result is only kept if it did not get worse at the
 * simulated task by more than eight points (taste costs a little; a collapse costs tens), because a model that has memorised
 * eleven boards and forgotten everything else is worse than the one it started
 * as.
 */

const db = database({ name: 'all-dash-layout', store: 'models', keyPath: 'id', label: 'the layout model' })
const KEY = 'personal'

export async function savePersonal(model, meta) {
  await db.write((store) => store.put({ id: KEY, fingerprint: fingerprint(), weights: exportWeights(model), ...meta }))
}

/** The person's own copy, or null if there is none or it was trained for another catalogue. */
export async function loadPersonal() {
  if (!db.available()) return null
  try {
    const row = await db.read((store) => new Promise((resolve, reject) => {
      const req = store.get(KEY)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => reject(req.error)
    }))
    if (!row || row.fingerprint !== fingerprint()) return null
    return importWeights(ARCHITECTURE, row.weights)
  } catch {
    return null
  }
}

export async function dropPersonal() {
  if (!db.available()) return
  await db.write((store) => store.delete(KEY)).catch(() => {})
}

/** A saved example in the shape the network reads. */
export function inputOf(example) {
  const widgets = example.widgets.map((w) => ({ ...w, wid: widgetIndex(w.id) }))
  return { ...encode(example.values, widgets), labels: example.labels }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A fixed set of simulated situations, for checking nothing was forgotten. */
let reference = null
function referenceSet() {
  if (!reference) {
    const random = rng(90210)
    reference = Array.from({ length: 200 }, () => toExample(sampleExample(random)))
  }
  return reference
}

/**
 * @param {object} args
 * @param {object} args.base       the model to start from
 * @param {Array} args.examples    saved examples (layout/schema.js shape)
 * @param {number} [args.steps]
 * @param {number} [args.rate]     learning rate; small on purpose, this nudges a trained model
 * @param {(done:number, total:number) => void} [args.onProgress]
 * @param {AbortSignal} [args.signal]
 * @returns {Promise<{model:object, accepted:boolean, reason:string|null, yours:{before:number, after:number, held:boolean}, general:{before:number, after:number}}>}
 */
export async function finetune({ base, examples, steps = 160, rate = 4e-4, onProgress, signal }) {
  const inputs = examples.map(inputOf)
  // With enough boards, hold a fifth back so "better" is measured on boards the
  // training never touched. With fewer, the honest number is only the fit.
  const held = inputs.length >= 10
  const validation = held ? inputs.filter((_, i) => i % 5 === 4) : inputs
  const training = held ? inputs.filter((_, i) => i % 5 !== 4) : inputs

  const general = referenceSet()
  const yoursBefore = evaluateModel(base, validation).accuracy
  const generalBefore = evaluateModel(base, general).accuracy

  const model = cloneModel(base)
  const trainer = createTrainer(model, { lr: rate })
  const random = rng(7)
  const BATCH = 8
  for (let step = 0; step < steps; step++) {
    if (signal?.aborted) throw new DOMException('Training was cancelled.', 'AbortError')
    const batch = []
    for (let i = 0; i < BATCH; i++) batch.push(training[random.int(training.length)])
    for (let i = 0; i < BATCH; i++) batch.push(toExample(sampleExample(random)))
    trainer.step(batch)
    if (step % 4 === 3) {
      onProgress?.(step + 1, steps)
      await tick()
    }
  }
  onProgress?.(steps, steps)

  const yoursAfter = evaluateModel(model, validation).accuracy
  const generalAfter = evaluateModel(model, general).accuracy
  let reason = null
  // A person's taste should cost the simulated task a little: that is what
  // taste is. A collapse is a fall of tens of points, so the line sits well
  // clear of ordinary personalising.
  if (generalBefore - generalAfter > 0.08) reason = 'It started misreading ordinary situations, so the old model was kept.'
  else if (yoursAfter < yoursBefore) reason = held ? 'It did no better on boards it had not seen, so the old model was kept.' : 'It fit your boards no better than before, so the old model was kept.'
  return {
    model,
    accepted: reason === null,
    reason,
    yours: { before: yoursBefore, after: yoursAfter, held },
    general: { before: generalBefore, after: generalAfter },
  }
}
