import { SIZES } from './catalogue.js'

/**
 * Small pure helpers over a saved board (an array of `{ id, widgetId, size }`),
 * shared by the proposal, the examples it is learned from and the screen that
 * shows the difference.
 */

/** The class a candidate widget has on a board: 0 absent, 1..4 small to full. */
export function classOf(items, candidate) {
  const item = items.find((i) => i.widgetId === candidate.id)
  if (!item) return 0
  const at = SIZES.indexOf(item.size || candidate.size)
  return (at < 0 ? 1 : at) + 1
}
