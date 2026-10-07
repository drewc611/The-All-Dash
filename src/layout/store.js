import { mutate, getState, setBoard } from '../core/store.js'
import { iso } from '../core/time.js'
import { MAX_EXAMPLES } from './schema.js'
import { classOf } from './board.js'

/**
 * The layout slice's writes. Kept out of core/store.js for the same reason
 * work/store.js is: one feature's state should not be spread across the file
 * that holds everything else.
 */

// The board the model itself last produced. A board that is still exactly that
// when the person finishes editing is the model agreeing with itself, which is
// not a label, so it is not remembered.
let lastApplied = null

/** Put a board on Today, remembering what it replaces so it can be put back. */
export function applyBoard(view, items) {
  const before = getState().boards[view] || []
  lastApplied = JSON.stringify(items)
  mutate((s) => ({ ...s, layout: { ...s.layout, undo: { view, items: structuredClone(before), at: iso(new Date()) } } }))
  setBoard(view, items)
}

/** Restore the board the last applied suggestion replaced. Returns whether anything was restored. */
export function undoBoard() {
  const { undo } = getState().layout
  if (!undo) return false
  setBoard(undo.view, undo.items)
  mutate((s) => ({ ...s, layout: { ...s.layout, undo: null } }))
  return true
}

export const dropUndo = () => mutate((s) => ({ ...s, layout: { ...s.layout, undo: null } }))

/**
 * Remember a board the person ended up with, in the situation they made it in.
 * A second one for the same hour of the same day replaces the first: three
 * nudges within one morning are one opinion, not three.
 */
export function rememberBoard({ values, candidates, items, now = new Date() }) {
  if (JSON.stringify(items) === lastApplied) return false
  const labels = candidates.map((c) => classOf(items, c))
  const example = {
    values,
    widgets: candidates.map((c) => ({ id: c.id, category: c.category, size: c.size })),
    labels,
    at: iso(now),
  }
  const slot = (e) => `${(e.at || '').slice(0, 13)}|${e.values.join(',')}`
  mutate((s) => {
    const kept = s.layout.examples.filter((e) => slot(e) !== slot(example))
    return { ...s, layout: { ...s.layout, examples: [...kept, example].slice(-MAX_EXAMPLES) } }
  })
  return true
}

export const setPersonal = (personal) => mutate((s) => ({ ...s, layout: { ...s.layout, personal } }))
export const forgetExamples = () => mutate((s) => ({ ...s, layout: { ...s.layout, examples: [], personal: null } }))
