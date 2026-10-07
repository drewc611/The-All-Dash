import test from 'node:test'
import assert from 'node:assert/strict'
import {
  rng, createModel, cloneModel, forward, predict, lossAndGrad, zerosLike, layout,
  createAdam, adamStep, exportWeights, importWeights, paramCount,
} from '../src/layout/nn.js'

/*
 * A backward pass written by hand is a place for a sign error to hide for a
 * long time: the loss still goes down, just not as far as it should, and
 * nothing fails. So the one test that matters here compares every parameter
 * tensor against finite differences of the loss. If it passes, the gradients
 * are the gradients.
 */

const CFG = { ctxVocab: 12, widgetVocab: 7, categories: 3, sizes: 4, classes: 5, dim: 8, heads: 2, layers: 2, ff: 16 }

function example(random, nw = 5) {
  return {
    ctx: Array.from({ length: 4 }, () => random.int(CFG.ctxVocab)),
    widgets: Array.from({ length: nw }, () => ({ wid: random.int(CFG.widgetVocab), cat: random.int(CFG.categories), size: random.int(CFG.sizes) })),
    labels: Array.from({ length: nw }, () => random.int(CFG.classes)),
  }
}

function loss(model, ex) {
  return lossAndGrad(model, ex, zerosLike(model))
}

test('every parameter tensor matches finite differences', () => {
  const random = rng(7)
  const model = createModel(CFG, random)
  // Parameters start with a near-zero head and unit gains, which hides errors
  // behind symmetry. Perturb everything so no gradient is accidentally zero.
  for (const t of Object.values(model.params)) for (let i = 0; i < t.length; i++) t[i] += random.normal() * 0.05
  const ex = example(random)

  const grads = zerosLike(model)
  lossAndGrad(model, ex, grads)

  const h = 1e-5
  let checked = 0
  for (const [name, shape] of layout(CFG)) {
    const n = shape.reduce((a, b) => a * b, 1)
    // Every element of small tensors, a spread of the large ones.
    const picks = n <= 24 ? [...Array(n).keys()] : Array.from({ length: 24 }, () => random.int(n))
    for (const i of picks) {
      const keep = model.params[name][i]
      model.params[name][i] = keep + h
      const up = loss(model, ex)
      model.params[name][i] = keep - h
      const down = loss(model, ex)
      model.params[name][i] = keep
      const numeric = (up - down) / (2 * h)
      const analytic = grads[name][i]
      const scale = Math.max(1e-6, Math.abs(numeric), Math.abs(analytic))
      assert.ok(
        Math.abs(numeric - analytic) / scale < 1e-4 || Math.abs(numeric - analytic) < 1e-9,
        `${name}[${i}]: analytic ${analytic} vs numeric ${numeric}`,
      )
      checked += 1
    }
  }
  assert.ok(checked > 300, `checked ${checked} values`)
})

test('a tensor that never reached the loss has a zero gradient, not a missing one', () => {
  const model = createModel(CFG, rng(3))
  const grads = zerosLike(model)
  const ex = example(rng(3))
  lossAndGrad(model, ex, grads)
  // Rows of the context table nobody looked up must stay exactly zero.
  const used = new Set(ex.ctx)
  for (let id = 0; id < CFG.ctxVocab; id++) {
    if (used.has(id)) continue
    for (let i = 0; i < CFG.dim; i++) assert.equal(grads['emb.ctx'][id * CFG.dim + i], 0)
  }
})

test('widgets attend to the context: changing a context token changes their output', () => {
  const model = createModel(CFG, rng(5))
  const ex = example(rng(5))
  const a = predict(model, ex)
  const b = predict(model, { ...ex, ctx: ex.ctx.map((c, i) => (i === 0 ? (c + 1) % CFG.ctxVocab : c)) })
  const moved = a.some((row, r) => row.some((p, c) => Math.abs(p - b[r][c]) > 1e-9))
  assert.ok(moved)
})

test('the layout is a set: shuffling the widgets shuffles the answers the same way', () => {
  const random = rng(11)
  const model = createModel(CFG, random)
  for (const t of Object.values(model.params)) for (let i = 0; i < t.length; i++) t[i] += random.normal() * 0.05
  const ex = example(random, 6)
  const order = [3, 0, 5, 1, 4, 2]
  const shuffled = { ...ex, widgets: order.map((i) => ex.widgets[i]) }
  const a = predict(model, ex)
  const b = predict(model, shuffled)
  order.forEach((from, to) => {
    for (let c = 0; c < CFG.classes; c++) assert.ok(Math.abs(a[from][c] - b[to][c]) < 1e-9)
  })
})

test('probabilities are probabilities', () => {
  const model = createModel(CFG, rng(2))
  for (const row of predict(model, example(rng(2)))) {
    assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-12)
    assert.ok(row.every((p) => p >= 0 && p <= 1))
  }
})

test('Adam can drive the loss down on a fixed batch', () => {
  const random = rng(9)
  const model = createModel(CFG, random)
  const batch = Array.from({ length: 6 }, () => example(random))
  const adam = createAdam(model)
  const grads = zerosLike(model)
  const mean = () => batch.reduce((s, ex) => s + loss(model, ex), 0) / batch.length
  const before = mean()
  for (let step = 0; step < 150; step++) {
    for (const ex of batch) lossAndGrad(model, ex, grads)
    adamStep(model, grads, adam, { lr: 5e-3, scale: 1 / batch.length })
  }
  assert.ok(mean() < before * 0.5, `loss ${before} -> ${mean()}`)
})

test('weights survive a round trip through base64 float32', () => {
  const random = rng(4)
  const model = createModel(CFG, random)
  const text = exportWeights(model)
  const back = importWeights(CFG, text)
  const ex = example(random)
  const a = predict(model, ex)
  const b = predict(back, ex)
  for (let r = 0; r < a.length; r++) for (let c = 0; c < CFG.classes; c++) assert.ok(Math.abs(a[r][c] - b[r][c]) < 1e-5)
  assert.equal(text.length > paramCount(CFG), true)
})

test('weights for a different architecture are refused, not misread', () => {
  const text = exportWeights(createModel(CFG, rng(1)))
  assert.throws(() => importWeights({ ...CFG, dim: 16 }, text), /needs/)
})

test('cloning does not alias', () => {
  const a = createModel(CFG, rng(1))
  const b = cloneModel(a)
  b.params['head.b'][0] = 99
  assert.notEqual(a.params['head.b'][0], 99)
})

test('forward needs no labels', () => {
  const model = createModel(CFG, rng(1))
  const { logits } = forward(model, { ctx: [0, 1], widgets: [{ wid: 0, cat: 0, size: 0 }] })
  assert.equal(logits.length, CFG.classes)
})
