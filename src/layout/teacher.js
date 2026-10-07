import {
  WIDGETS, CATEGORIES, FIELD_INDEX, FIELDS, VALUES, VIEW_GROUPS, UNKNOWN_WIDGET, categoryIndex, sizeIndex, widgetIndex,
} from './catalogue.js'

/**
 * Where the training labels come from, stated plainly.
 *
 * There is no corpus of "good Today boards". Nobody has one, and this app does
 * not phone home to build one. So the model is trained on a simulator: invented
 * people with a hidden kind of working life, a situation drawn the way real
 * ones tend to come, and a board a sensible person in that spot would want,
 * written down below as rules with noise on top.
 *
 * That makes the model a compressed, generalising copy of these rules, no wiser
 * than they are. What it adds is (a) it reads the situation as a whole instead
 * of rule by rule, so it interpolates, (b) it has never seen a plugin widget
 * and still places one by category, and (c) the same network can be fine-tuned
 * on the layouts a particular person actually keeps (see learn.js), which the
 * rules cannot do. The rules themselves stay in this file where they can be
 * argued with, instead of being spread over the UI.
 */

export const PERSONAS = ['planner', 'manager', 'analyst', 'maker', 'researcher', 'newcomer']

/** How each kind of person spreads their time across the view groups. */
const VIEW_HABITS = {
  planner: { triage: 0.35, timeline: 0.25, boards: 0.15, focus: 0.1, library: 0.05, analytics: 0.05, brain: 0.05 },
  manager: { boards: 0.35, timeline: 0.2, analytics: 0.2, triage: 0.1, library: 0.05, brain: 0.05, focus: 0.05 },
  analyst: { analytics: 0.45, library: 0.25, boards: 0.1, timeline: 0.05, triage: 0.05, brain: 0.05, focus: 0.05 },
  maker: { focus: 0.45, library: 0.2, triage: 0.1, boards: 0.1, brain: 0.05, timeline: 0.05, analytics: 0.05 },
  researcher: { brain: 0.35, library: 0.35, analytics: 0.1, timeline: 0.05, boards: 0.05, triage: 0.05, focus: 0.05 },
  newcomer: {},
}

function weighted(random, table) {
  const entries = Object.entries(table)
  let r = random() * entries.reduce((s, [, w]) => s + w, 0)
  for (const [key, w] of entries) {
    r -= w
    if (r <= 0) return key
  }
  return entries[entries.length - 1][0]
}

/** A person and a moment. `values` is the situation in catalogue field order. */
export function sampleSituation(random) {
  const persona = PERSONAS[Number(weighted(random, { 0: 0.22, 1: 0.2, 2: 0.16, 3: 0.14, 4: 0.12, 5: 0.16 }))]
  const set = {}

  set.hour = random.int(6)
  set.day = random.int(7)
  const weekend = set.day >= 5

  // Habits: established people have a favourite view most of the time.
  let top = 'none'
  let next = 'none'
  if (persona !== 'newcomer') {
    if (random() > 0.1) top = weighted(random, VIEW_HABITS[persona])
    const rest = { ...VIEW_HABITS[persona] }
    delete rest[top]
    if (random() > 0.15) next = weighted(random, rest)
  } else if (random() < 0.2) {
    top = VIEW_GROUPS[1 + random.int(VIEW_GROUPS.length - 1)]
  }
  set.topView = VIEW_GROUPS.indexOf(top)
  set.nextView = VIEW_GROUPS.indexOf(next)
  set.tenure = persona === 'newcomer' ? (random() < 0.75 ? 0 : 1) : 1 + random.int(3)

  set.size = persona === 'newcomer' ? random.int(2) : 1 + random.int(3)
  const busy = set.size === 0 ? 0 : 1
  const pile = (p) => (random() < p ? 1 + random.int(3) : 0)
  set.overdue = busy * pile(persona === 'planner' ? 0.7 : 0.45)
  set.dueToday = busy * pile(0.6)
  set.events = weekend ? (random() < 0.15 ? 1 : 0) : busy * (persona === 'manager' ? pile(0.9) : pile(0.6))
  set.risks = busy * pile(persona === 'manager' ? 0.6 : 0.3)
  set.questions = busy * pile(0.35)
  set.urgent = Math.max(0, Math.min(3, set.overdue + random.int(3) - 1))
  if (set.overdue === 0) set.urgent = Math.min(set.urgent, 1)
  // Focus time accrues through the day, and maker-types do more of it.
  const focusChance = (persona === 'maker' ? 0.75 : 0.25) * (set.hour <= 1 ? 0.2 : 1)
  set.focus = random() < focusChance ? 1 + random.int(3) : 0
  set.boards = persona === 'manager' || persona === 'planner' ? (random() < 0.8 ? 1 + random.int(3) : 0) : random() < 0.25 ? 1 + random.int(2) : 0
  set.telamate = random() < 0.12 ? 1 : 0

  return { persona, values: FIELDS.map((f) => set[f.id] ?? 0) }
}

// ------------------------------------------------------------------- rules

/**
 * What each widget is worth, 0 meaning "neither here nor there", on a scale
 * where roughly 0.3 is the line for earning a place on the board. `c` reads
 * the situation by field name, `p` is the person's kind, `has` says whether
 * they have the thing the widget shows.
 */
const RULES = {
  agenda: (c) => (c.events === 0 ? -0.4 : 0.35 + 0.17 * c.events + (c.weekend ? -0.15 : 0) + (c.morning ? 0.1 : 0)),
  'focus-tasks': (c, p) => 0.55 + 0.1 * c.dueToday + 0.1 * c.overdue + (c.morning ? 0.15 : 0) + (c.weekend ? -0.1 : 0) + (p === 'planner' ? 0.1 : 0),
  reminders: (c) => 0.3 + 0.07 * c.dueToday + (c.morning ? 0.1 : 0),
  'quick-capture': (c, p) => 0.3 + (p === 'planner' ? 0.2 : 0) + (p === 'newcomer' ? 0.25 : 0),
  'recent-activity': (c) => 0.25 + (c.evening ? 0.3 : 0) + (c.size >= 2 ? 0.1 : 0),
  'open-questions': (c) => (c.questions === 0 ? -0.5 : 0.05 + 0.2 * c.questions),
  risks: (c, p) => (c.risks === 0 ? -0.6 : 0.1 + 0.2 * c.risks + (p === 'manager' ? 0.2 : 0) + (c.weekend ? -0.2 : 0)),
  decisions: (c, p) => 0.2 + (p === 'manager' ? 0.15 : 0) + (p === 'researcher' ? 0.1 : 0),
  milestones: (c, p) => 0.15 + (p === 'manager' ? 0.3 : 0) + (c.monday ? 0.15 : 0) + (c.size < 2 ? -0.2 : 0),
  people: (c, p) => 0.05 + (p === 'manager' ? 0.25 : 0) + (c.size < 2 ? -0.2 : 0),
  'week-ahead': (c) => 0.15 + (c.monday ? 0.4 : 0) + (c.sunday ? 0.35 : 0) + (c.friday ? 0.15 : 0) + (c.evening ? 0.1 : 0),
  pulse: (c, p) => 0.35 + (p === 'analyst' ? 0.2 : 0) + (c.size === 0 ? -0.4 : 0),
  'metric-grid': (c, p) => -0.05 + (p === 'analyst' ? 0.5 : 0) + (c.size >= 2 ? 0.1 : 0) + (c.size === 0 ? -0.5 : 0),
  'series-explorer': (c, p) => -0.15 + (p === 'analyst' ? 0.45 : 0) + (c.size === 0 ? -0.5 : 0),
  throughput: (c, p) => 0.05 + (p === 'manager' ? 0.2 : 0) + (p === 'analyst' ? 0.2 : 0) + (c.size < 2 ? -0.2 : 0),
  workload: (c, p) => 0.05 + (p === 'manager' ? 0.3 : 0) + (c.events >= 2 ? 0.1 : 0) + (c.size < 2 ? -0.2 : 0),
  insights: (c, p) => 0.2 + (p === 'analyst' ? 0.3 : 0) + (c.urgent > 0 ? 0.1 : 0) + (c.size === 0 ? -0.4 : 0),
  'activity-heatmap': (c, p) => -0.05 + (p === 'analyst' ? 0.25 : 0) + (c.size < 2 ? -0.2 : 0),
  'table-preview': (c, p) => -0.15 + (p === 'analyst' ? 0.35 : 0) + (p === 'researcher' ? 0.1 : 0) + (c.size < 2 ? -0.3 : 0),
  'source-mix': (c, p) => -0.15 + (p === 'analyst' ? 0.2 : 0) + (p === 'researcher' ? 0.1 : 0),
  'status-update': (c, p) => 0.1 + (p === 'manager' ? 0.4 : 0) + (c.friday ? 0.35 : 0) + (c.evening ? 0.1 : 0) + (c.weekend ? -0.3 : 0) + (c.size < 2 ? -0.3 : 0),
  triage: (c, p) => 0.25 + 0.2 * c.urgent + 0.08 * c.overdue + (p === 'planner' ? 0.2 : 0),
  'relationship-map': (c, p) => -0.25 + (p === 'manager' ? 0.25 : 0) + (p === 'researcher' ? 0.15 : 0) + (c.size < 2 ? -0.3 : 0),
  'load-heatmap': (c, p) => -0.15 + (p === 'analyst' ? 0.25 : 0) + (p === 'manager' ? 0.25 : 0) + (c.size < 2 ? -0.3 : 0),
  leaderboard: (c, p) => -0.25 + (p === 'manager' ? 0.2 : 0) + (p === 'analyst' ? 0.15 : 0) + (c.size < 2 ? -0.3 : 0),
  brain: (c, p) => 0.15 + (p === 'researcher' ? 0.4 : 0) + (c.tenure >= 2 ? 0.15 : 0) + (c.tenure === 0 ? -0.2 : 0),
  'my-work': (c, p) => (c.boards === 0 ? -0.6 : 0.4 + 0.05 * c.boards + (p === 'planner' ? 0.1 : 0)),
  'board-summary': (c, p) => (c.boards === 0 ? -0.8 : 0.1 + (p === 'manager' ? 0.35 : 0)),
  'board-activity': (c, p) => (c.boards === 0 ? -0.8 : 0 + (p === 'manager' ? 0.25 : 0)),
  'focus-time': (c, p) => 0.15 + (p === 'maker' ? 0.5 : 0) + (c.focus === 0 && c.afternoon ? 0.2 : 0) + (c.focus >= 2 ? 0.2 : 0),
  'focus-by-task': (c, p) => -0.15 + (p === 'maker' ? 0.4 : 0) + (c.focus >= 1 ? 0.2 : 0),
  'focus-hours': (c, p) => -0.15 + (p === 'maker' ? 0.3 : 0) + (c.focus >= 1 ? 0.1 : 0),
  'telamate-queue': (c) => (c.telamate ? 0.75 : -2),
  'telamate-channels': (c) => (c.telamate ? 0.2 : -2),
  'telamate-answered': (c) => (c.telamate ? 0.15 : -2),
}

/**
 * What a widget nobody has met before is worth, judged by its category alone.
 * This is the rule the model is meant to generalise: a plugin lands on the
 * board where its neighbours would.
 */
const CATEGORY_RULES = {
  Day: (c) => 0.35 + (c.morning ? 0.1 : 0),
  Project: (c, p) => 0.1 + (p === 'manager' ? 0.3 : 0),
  Analytics: (c, p) => -0.1 + (p === 'analyst' ? 0.4 : 0),
  Data: (c, p) => -0.15 + (p === 'analyst' ? 0.3 : 0) + (p === 'researcher' ? 0.15 : 0),
  Work: (c, p) => (c.boards === 0 ? -0.6 : 0.1 + (p === 'manager' ? 0.3 : 0)),
  Focus: (c, p) => 0 + (p === 'maker' ? 0.45 : 0),
  Telamate: (c) => (c.telamate ? 0.5 : -2),
  other: () => 0.05,
}

function reading(values, persona) {
  const get = (id) => values[FIELD_INDEX[id]]
  const day = get('day')
  const hour = get('hour')
  return {
    ...Object.fromEntries(FIELDS.map((f) => [f.id, get(f.id)])),
    persona,
    weekend: day >= 5,
    monday: day === 0,
    friday: day === 4,
    sunday: day === 6,
    morning: hour === 2 || hour === 1,
    afternoon: hour === 4,
    evening: hour === 5,
  }
}

/** The worth of one widget in one situation, before noise. */
export function worth(widget, values, persona) {
  const c = reading(values, persona)
  const rule = widget.id && RULES[widget.id] ? RULES[widget.id] : CATEGORY_RULES[widget.category] || CATEGORY_RULES.other
  return rule(c, persona)
}

// ----------------------------------------------------------------- labels

/**
 * Decide the board: the highest-worth widgets that clear the line, up to a
 * budget, sized by default and nudged by rank. Returns one class per widget:
 * 0 hidden, 1..4 small to full.
 */
export function chooseBoard(widgets, scores, values) {
  const day = values[FIELD_INDEX.day]
  const size = values[FIELD_INDEX.size]
  const budget = 7 + (size >= 2 ? 1 : 0) - (day >= 5 ? 1 : 0)
  const order = scores.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  const labels = new Array(widgets.length).fill(0)
  let rank = 0
  for (const [s, i] of order) {
    if (rank >= budget || s < 0.3) break
    let sz = sizeIndex(widgets[i].size)
    if (rank < 2 && s >= 0.8 && sz < 2) sz += 1
    if (rank >= 5 && sz > 0) sz -= 1
    if (rank >= 3 && sz === 3) sz = 2
    labels[i] = sz + 1
    rank += 1
  }
  return labels
}

/** Noise-free labels, for measuring how much of the error is the noise. */
export function idealBoard(widgets, values, persona) {
  return chooseBoard(widgets, widgets.map((w) => worth(w, values, persona)), values)
}

/**
 * One training example: a person, a moment, and a candidate list that looks
 * like a real registry (some built-ins missing because their flag is off, and
 * now and then a plugin the model has never met).
 */
export function sampleExample(random, { noise = 0.1, plugins = true } = {}) {
  const { persona, values } = sampleSituation(random)
  const widgets = []
  for (const w of WIDGETS) {
    const flagged = w.category === 'Focus' || w.category === 'Telamate'
    if (random() < (flagged ? 0.7 : 0.93)) widgets.push({ ...w, wid: widgetIndex(w.id) })
  }
  if (plugins && random() < 0.35) {
    const extra = 1 + random.int(3)
    for (let i = 0; i < extra; i++) {
      const category = random() < 0.15 ? 'other' : random.pick(CATEGORIES.filter((c) => c !== 'Telamate'))
      widgets.push({ id: null, category, size: random.pick(['sm', 'md', 'md', 'lg']), wid: UNKNOWN_WIDGET })
    }
  }
  const scores = widgets.map((w) => worth(w, values, persona) + random.normal() * noise)
  const labels = chooseBoard(widgets, scores, values)
  return { persona, values, widgets, labels }
}

/** The network's input for a situation and a candidate list. */
export function encode(values, widgets) {
  return {
    ctx: values.map((v, field) => field * VALUES + v),
    widgets: widgets.map((w) => ({ wid: w.wid ?? widgetIndex(w.id), cat: categoryIndex(w.category), size: sizeIndex(w.size) })),
  }
}

export const toExample = (sample) => ({ ...encode(sample.values, sample.widgets), labels: sample.labels })
