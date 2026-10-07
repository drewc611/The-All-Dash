import { CLASSES, FIELDS, SIZES } from './catalogue.js'

/**
 * The layout slice of the saved workspace.
 *
 *   undo      the board as it was before the last suggestion was applied
 *   examples  boards the person ended up with, each with the situation it was
 *             made in: the only labels in this app that are theirs
 *   personal  a note that a personal copy of the model exists (the weights
 *             themselves live in IndexedDB; 90KB of floats does not belong in
 *             the localStorage blob that is rewritten on every keystroke)
 *
 * A restored file is untrusted input to a training loop, so everything here is
 * checked against the catalogue's shapes and anything else is dropped.
 */

export const MAX_EXAMPLES = 120
const MAX_CANDIDATES = 64

export const emptyLayout = () => ({ undo: null, examples: [], personal: null })

const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v))
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)

function normaliseItem(raw) {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.widgetId !== 'string') return null
  const item = { id: raw.id.slice(0, 64), widgetId: raw.widgetId.slice(0, 80) }
  if (SIZES.includes(raw.size)) item.size = raw.size
  if (isObject(raw.config)) item.config = raw.config
  return item
}

function normaliseUndo(raw) {
  if (!isObject(raw) || raw.view !== 'today' || !isIso(raw.at) || !Array.isArray(raw.items)) return null
  return { view: 'today', at: raw.at, items: raw.items.slice(0, 80).map(normaliseItem).filter(Boolean) }
}

function normaliseExample(raw) {
  if (!isObject(raw) || !Array.isArray(raw.values) || !Array.isArray(raw.widgets) || !Array.isArray(raw.labels)) return null
  if (raw.values.length !== FIELDS.length) return null
  const values = raw.values.map((v, i) => (Number.isInteger(v) && v >= 0 && v < FIELDS[i].values.length ? v : -1))
  if (values.some((v) => v < 0)) return null
  if (raw.widgets.length === 0 || raw.widgets.length > MAX_CANDIDATES || raw.widgets.length !== raw.labels.length) return null
  const widgets = []
  for (const w of raw.widgets) {
    if (!isObject(w)) return null
    widgets.push({
      id: typeof w.id === 'string' ? w.id.slice(0, 80) : null,
      category: typeof w.category === 'string' ? w.category.slice(0, 40) : 'other',
      size: SIZES.includes(w.size) ? w.size : 'md',
    })
  }
  const labels = raw.labels.map((c) => (Number.isInteger(c) && c >= 0 && c < CLASSES.length ? c : -1))
  if (labels.some((c) => c < 0)) return null
  return { values, widgets, labels, at: isIso(raw.at) ? raw.at : null }
}

function normalisePersonal(raw) {
  if (!isObject(raw) || !isIso(raw.trainedAt)) return null
  return {
    trainedAt: raw.trainedAt,
    examples: Number.isFinite(raw.examples) ? Math.max(0, Math.floor(raw.examples)) : 0,
    steps: Number.isFinite(raw.steps) ? Math.max(0, Math.floor(raw.steps)) : 0,
  }
}

export function normaliseLayout(raw) {
  if (!isObject(raw)) return emptyLayout()
  return {
    undo: normaliseUndo(raw.undo),
    examples: (Array.isArray(raw.examples) ? raw.examples : []).map(normaliseExample).filter(Boolean).slice(-MAX_EXAMPLES),
    personal: normalisePersonal(raw.personal),
  }
}
