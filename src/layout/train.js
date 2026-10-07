import { createAdam, adamStep, lossAndGrad, zerosLike, predict } from './nn.js'

/**
 * Training, kept free of any file or browser API so the offline script and the
 * on-device fine-tune are the same code. The only difference between them is
 * which examples they feed it and how many steps they take.
 */

/**
 * @param {object} model
 * @param {{lr?:number, decay?:number, clip?:number}} [opts]
 */
export function createTrainer(model, { lr = 2e-3, decay = 0.01, clip = 1 } = {}) {
  const adam = createAdam(model)
  const grads = zerosLike(model)
  return {
    model,
    /** One optimiser step over a batch. Returns the mean loss and the gradient norm. */
    step(batch, { rate = lr, classWeights = null } = {}) {
      let loss = 0
      for (const example of batch) loss += lossAndGrad(model, example, grads, { classWeights })
      const norm = adamStep(model, grads, adam, { lr: rate, decay, clip, scale: 1 / batch.length })
      return { loss: loss / batch.length, norm }
    },
  }
}

/** Linear warm-up then cosine decay to a tenth of the peak. */
export function schedule(step, total, peak, warmup = Math.max(1, Math.round(total * 0.04))) {
  if (step < warmup) return (peak * (step + 1)) / warmup
  const t = (step - warmup) / Math.max(1, total - warmup)
  return peak * (0.1 + 0.9 * 0.5 * (1 + Math.cos(Math.PI * t)))
}

/** Argmax class per widget. */
export function classesOf(model, example) {
  return predict(model, example).map((row) => row.indexOf(Math.max(...row)))
}
