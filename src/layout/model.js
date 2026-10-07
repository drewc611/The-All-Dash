import { predict, importWeights } from './nn.js'
import { ARCHITECTURE, CLASSES, FIELDS, SIZES, UNKNOWN_WIDGET, fingerprint, sizeIndex, widgetIndex } from './catalogue.js'
import { encode } from './teacher.js'
import { describeField } from './situation.js'

/**
 * From a trained network to a proposed board.
 *
 * The network answers one question per widget: how much room, if any, does this
 * deserve right now? Turning that into something a person can accept needs a
 * few decisions the network should not make for itself, and they live here:
 *
 *   - a call too close to the current board is not worth a change, so a widget
 *     only moves when the model is clearly more sure of the new answer;
 *   - a widget somebody configured is never taken off the board by a guess;
 *   - widgets the model was not asked about are left exactly where they are;
 *   - and every change carries the inputs that most moved it, found by asking
 *     the model again with that input varied, not by guessing a story.
 *
 * Nothing in here writes to the board. It returns a proposal.
 */

let shipped = null

/**
 * The weights that ship with the app, parsed and checked. Loaded on demand, so
 * a person who never asks for a layout never downloads them.
 */
export async function loadShipped() {
  if (!shipped) {
    shipped = import('./weights.json', { with: { type: 'json' } }).then((m) => fromFile(m.default))
  }
  return shipped
}

/** Build a model from a weights file, refusing one trained against a different catalogue. */
export function fromFile(file) {
  if (!file || file.format !== 1) throw new Error('unrecognised layout weights')
  if (file.fingerprint !== fingerprint()) {
    throw new Error('the layout weights were trained for a different widget catalogue; retrain with scripts/train-layout.mjs')
  }
  return { model: importWeights(ARCHITECTURE, file.weights), info: { training: file.training, metrics: file.metrics } }
}

/** Candidate widgets from a registry list, in the shape the model reads. */
export function candidatesFrom(registered) {
  return registered.map((w) => ({ id: w.id, name: w.name || w.id, category: w.category, size: w.size || 'md', wid: widgetIndex(w.id) }))
}

const classOfSize = (size) => sizeIndex(size) + 1
const sizeOfClass = (cls) => SIZES[cls - 1]

/** How much a widget's visible probability depends on each situation field. */
function influence(model, values, candidates, base, onlyFor) {
  const out = new Map(onlyFor.map((i) => [i, []]))
  FIELDS.forEach((field, f) => {
    const alternatives = field.values.map((_, v) => v).filter((v) => v !== values[f])
    if (!alternatives.length) return
    const mean = new Array(candidates.length).fill(0)
    for (const v of alternatives) {
      const probs = predict(model, encode(values.map((x, i) => (i === f ? v : x)), candidates))
      probs.forEach((row, i) => { mean[i] += (1 - row[0]) / alternatives.length })
    }
    for (const i of onlyFor) out.get(i).push({ field: field.id, delta: (1 - base[i][0]) - mean[i] })
  })
  return out
}

/**
 * @param {object} args
 * @param {object} args.model      from loadShipped() or a personal fine-tune
 * @param {number[]} args.values   the situation
 * @param {Array} args.candidates  from candidatesFrom()
 * @param {Array<{id:string, widgetId:string, size?:string, config?:object}>} args.current  the board as it is
 * @param {number} [args.margin]   how much more sure it must be to change an answer
 * @param {() => string} args.newId  makes an id for a widget being added
 */
export function propose({ model, values, candidates, current, margin = 0.15, newId }) {
  const input = encode(values, candidates)
  const probs = predict(model, input)

  // Every copy of each widget on the board, in board order. The first copy is
  // "the" widget as far as size and position go; the rest are the person's own
  // doing and are left alone unless the model says the widget should go.
  const copies = new Map()
  current.forEach((item, index) => {
    const list = copies.get(item.widgetId) || []
    list.push({ item, index })
    copies.set(item.widgetId, list)
  })
  const configured = (item) => Boolean(item.config && Object.keys(item.config).length)

  const decisions = candidates.map((w, i) => {
    const p = probs[i]
    const mine = copies.get(w.id) || []
    const first = mine[0]
    const have = first ? classOfSize(first.item.size || w.size) : 0
    let want = p.indexOf(Math.max(...p))
    // Stay put unless the model is clearly surer of something else.
    if (want !== have && p[want] - p[have] <= margin) want = have
    // Hand-configured means somebody chose it; a guess does not undo that.
    const removable = want === 0 ? mine.filter((c) => !configured(c.item)) : []
    if (want === 0 && have > 0 && removable.length === 0) want = have
    return { widget: w, index: i, p, have, want, visible: 1 - p[0], first, removable }
  })

  // Order by how sure the model is that a widget belongs. Near-equals keep the
  // order they already have (probabilities are bucketed to 5 points, so a tie
  // is a tie), which is also what makes asking twice give the same answer.
  const bucket = (d) => Math.round(d.visible * 20)
  const shown = decisions
    .filter((d) => d.want > 0)
    .sort((a, b) => bucket(b) - bucket(a) || (a.first ? a.first.index : 1e3) - (b.first ? b.first.index : 1e3))

  const takenIds = new Set(shown.filter((d) => d.first).map((d) => d.first.item.id))
  const removedIds = new Set(decisions.flatMap((d) => d.removable.map((c) => c.item.id)))
  // Everything else stays exactly where it was: widgets the model was not
  // asked about, second copies, and configured ones it was told to keep.
  const leftAlone = current.filter((item) => !takenIds.has(item.id) && !removedIds.has(item.id))

  const items = [
    ...shown.map((d) => ({
      ...(d.first ? d.first.item : { id: newId(), widgetId: d.widget.id }),
      size: sizeOfClass(d.want),
    })),
    ...leftAlone,
  ]

  const changes = []
  for (const d of decisions) {
    if (d.want === d.have) continue
    changes.push({
      kind: d.have === 0 ? 'add' : d.want === 0 ? 'remove' : 'resize',
      copies: d.removable.length > 1 ? d.removable.length : undefined,
      widgetId: d.widget.id,
      name: d.widget.name,
      from: d.have === 0 ? null : sizeOfClass(d.have),
      to: d.want === 0 ? null : sizeOfClass(d.want),
      confidence: d.p[d.want],
      index: d.index,
    })
  }

  const asked = [...changes].sort((a, b) => b.confidence - a.confidence)
  const why = influence(model, values, candidates, probs, asked.map((c) => c.index))
  for (const change of changes) {
    const ranked = [...why.get(change.index)]
    // Pushing towards the new answer: a widget being added is driven by what
    // raises its chance of showing, one being removed by what lowers it.
    ranked.sort((a, b) => (change.kind === 'remove' ? a.delta - b.delta : b.delta - a.delta))
    change.because = ranked
      .filter((r) => (change.kind === 'remove' ? r.delta < -0.05 : r.delta > 0.05))
      .slice(0, 2)
      .map((r) => describeField(values, r.field))
    delete change.index
  }

  // Order counts as changed only among widgets that were already on the board:
  // an added or removed widget shifts the others without anyone moving them.
  const ids = (list) => list.map((i) => i.id).join()
  const kept = new Set(items.map((i) => i.id))
  const was = new Set(current.map((i) => i.id))
  const reordered = ids(items.filter((i) => was.has(i.id))) !== ids(current.filter((i) => kept.has(i.id)))

  return { items, changes, reordered, unchanged: changes.length === 0 && !reordered, labels: CLASSES }
}

export { UNKNOWN_WIDGET }
