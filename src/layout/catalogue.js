/**
 * What the layout model knows about.
 *
 * Two vocabularies, both fixed at training time: the widgets it has a row for,
 * and the situation facts it reads. Changing either changes the shape of the
 * network, so `fingerprint()` below goes into the shipped weights and a test
 * refuses weights that were trained against a different list. A model quietly
 * answering about a catalogue it was not trained on is worse than a loud
 * failure in CI.
 */

/** Output classes, per widget. Index 0 means "not on the board". */
export const CLASSES = ['hide', 'sm', 'md', 'lg', 'xl']
export const SIZES = ['sm', 'md', 'lg', 'xl']

export const CATEGORIES = ['Day', 'Project', 'Analytics', 'Data', 'Work', 'Focus', 'Telamate']

/**
 * Every built-in widget, with the category and default size its definition
 * declares. A test reads the widget source files and fails if this list and
 * those definitions ever disagree, so it cannot drift quietly.
 */
export const WIDGETS = [
  { id: 'agenda', category: 'Day', size: 'md' },
  { id: 'focus-tasks', category: 'Day', size: 'md' },
  { id: 'reminders', category: 'Day', size: 'sm' },
  { id: 'quick-capture', category: 'Day', size: 'sm' },
  { id: 'recent-activity', category: 'Day', size: 'md' },
  { id: 'open-questions', category: 'Day', size: 'md' },
  { id: 'risks', category: 'Project', size: 'md' },
  { id: 'decisions', category: 'Project', size: 'md' },
  { id: 'milestones', category: 'Project', size: 'lg' },
  { id: 'people', category: 'Project', size: 'md' },
  { id: 'week-ahead', category: 'Day', size: 'xl' },
  { id: 'pulse', category: 'Analytics', size: 'sm' },
  { id: 'metric-grid', category: 'Analytics', size: 'xl' },
  { id: 'series-explorer', category: 'Analytics', size: 'lg' },
  { id: 'throughput', category: 'Analytics', size: 'md' },
  { id: 'workload', category: 'Analytics', size: 'md' },
  { id: 'insights', category: 'Analytics', size: 'lg' },
  { id: 'activity-heatmap', category: 'Analytics', size: 'md' },
  { id: 'table-preview', category: 'Data', size: 'lg' },
  { id: 'source-mix', category: 'Data', size: 'sm' },
  { id: 'status-update', category: 'Project', size: 'xl' },
  { id: 'triage', category: 'Day', size: 'md' },
  { id: 'relationship-map', category: 'Project', size: 'xl' },
  { id: 'load-heatmap', category: 'Analytics', size: 'lg' },
  { id: 'leaderboard', category: 'Analytics', size: 'md' },
  { id: 'brain', category: 'Day', size: 'sm' },
  { id: 'my-work', category: 'Day', size: 'md' },
  { id: 'board-summary', category: 'Work', size: 'md' },
  { id: 'board-activity', category: 'Work', size: 'md' },
  { id: 'focus-time', category: 'Focus', size: 'md' },
  { id: 'focus-by-task', category: 'Focus', size: 'md' },
  { id: 'focus-hours', category: 'Focus', size: 'md' },
  { id: 'telamate-queue', category: 'Telamate', size: 'md' },
  { id: 'telamate-channels', category: 'Telamate', size: 'md' },
  { id: 'telamate-answered', category: 'Telamate', size: 'sm' },
]

const INDEX = new Map(WIDGETS.map((w, i) => [w.id, i]))

/** Embedding row for a widget id; anything not in the catalogue shares the last row. */
export const UNKNOWN_WIDGET = WIDGETS.length
export const widgetIndex = (id) => (INDEX.has(id) ? INDEX.get(id) : UNKNOWN_WIDGET)

/** Category row; a plugin's own category name lands on the final "other" row. */
export const categoryIndex = (name) => {
  const i = CATEGORIES.indexOf(name)
  return i < 0 ? CATEGORIES.length : i
}

export const sizeIndex = (size) => {
  const i = SIZES.indexOf(size)
  return i < 0 ? 1 : i
}

/**
 * The views a person's habits are read from. Several real views share a group
 * because the model needs "what kind of work do they open", not a row per
 * screen, and the groups are what the usage counters can actually support.
 */
export const VIEW_GROUPS = ['none', 'boards', 'triage', 'timeline', 'analytics', 'focus', 'library', 'brain']
const VIEW_TO_GROUP = {
  work: 'boards',
  triage: 'triage',
  timeline: 'timeline',
  analytics: 'analytics',
  focus: 'focus',
  library: 'library',
  stash: 'library',
  brain: 'brain',
  agents: 'brain',
  rounds: 'brain',
}
export const viewGroup = (viewId) => VIEW_TO_GROUP[viewId] || null

/**
 * The situation: one value per field, each 0..VALUES-1. Facts the model reads
 * and nothing else, so what it was shown is something a person can be told.
 */
export const VALUES = 8
export const FIELDS = [
  { id: 'hour', label: 'time of day', values: ['night', 'early morning', 'morning', 'midday', 'afternoon', 'evening'] },
  { id: 'day', label: 'day', values: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
  { id: 'overdue', label: 'late tasks', values: ['none', '1-2', '3-5', '6 or more'] },
  { id: 'dueToday', label: 'due today', values: ['none', '1-2', '3-5', '6 or more'] },
  { id: 'events', label: 'meetings today', values: ['none', '1-2', '3-5', '6 or more'] },
  { id: 'risks', label: 'open risks', values: ['none', '1-2', '3-5', '6 or more'] },
  { id: 'questions', label: 'open questions', values: ['none', '1-2', '3-5', '6 or more'] },
  { id: 'urgent', label: 'urgent signals', values: ['none', '1', '2-3', '4 or more'] },
  { id: 'focus', label: 'focus time today', values: ['none', 'under 25 minutes', '25 to 90 minutes', 'over 90 minutes'] },
  { id: 'topView', label: 'most-used view', values: VIEW_GROUPS },
  { id: 'nextView', label: 'second most-used view', values: VIEW_GROUPS },
  { id: 'size', label: 'workspace size', values: ['nearly empty', 'small', 'medium', 'large'] },
  { id: 'boards', label: 'boards', values: ['none', 'one', '2-3', '4 or more'] },
  { id: 'telamate', label: 'Telamate', values: ['not connected', 'connected'] },
  { id: 'tenure', label: 'time using the app', values: ['new', 'a few sessions', 'regular', 'long-time'] },
]
export const FIELD_INDEX = Object.fromEntries(FIELDS.map((f, i) => [f.id, i]))

export const CONTEXT_VOCAB = FIELDS.length * VALUES

/** The network's shape, derived from the vocabularies above. */
export const ARCHITECTURE = {
  ctxVocab: CONTEXT_VOCAB,
  widgetVocab: WIDGETS.length + 1,
  categories: CATEGORIES.length + 1,
  sizes: SIZES.length,
  classes: CLASSES.length,
  dim: 32,
  heads: 4,
  layers: 2,
  ff: 64,
}

/** Short stable hash of everything the weights depend on. */
export function fingerprint() {
  const text = JSON.stringify([WIDGETS, CATEGORIES, FIELDS.map((f) => [f.id, f.values.length]), VALUES, ARCHITECTURE, CLASSES])
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
