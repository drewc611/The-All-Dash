import { classesOf } from './train.js'

/**
 * How good a set of predicted boards is, against labelled ones.
 *
 * Three numbers, because one hides what matters. Accuracy alone is flattered by
 * the hidden class (most widgets are not on the board). Visibility F1 asks
 * whether the right widgets made it. Size agreement asks, of the widgets both
 * sides kept, whether they got the same size. `exact` is the harshest: the
 * whole board identical.
 *
 * @param {number[][]} predicted  one class array per example
 * @param {number[][]} actual
 */
export function score(predicted, actual) {
  let slots = 0
  let right = 0
  let tp = 0
  let fp = 0
  let fn = 0
  let bothShown = 0
  let sameSize = 0
  let exact = 0
  for (let e = 0; e < actual.length; e++) {
    let same = true
    for (let i = 0; i < actual[e].length; i++) {
      const a = actual[e][i]
      const p = predicted[e][i]
      slots += 1
      if (a === p) right += 1
      else same = false
      if (a > 0 && p > 0) {
        tp += 1
        bothShown += 1
        if (a === p) sameSize += 1
      } else if (p > 0) fp += 1
      else if (a > 0) fn += 1
    }
    if (same) exact += 1
  }
  const precision = tp / Math.max(1, tp + fp)
  const recall = tp / Math.max(1, tp + fn)
  return {
    examples: actual.length,
    accuracy: right / slots,
    visibilityF1: (2 * precision * recall) / Math.max(1e-12, precision + recall),
    sizeAgreement: sameSize / Math.max(1, bothShown),
    exact: exact / actual.length,
  }
}

/** Score a model on labelled examples (input shape from teacher.toExample). */
export function evaluateModel(model, examples) {
  return score(examples.map((ex) => classesOf(model, ex)), examples.map((ex) => ex.labels))
}
