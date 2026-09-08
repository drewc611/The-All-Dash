import { useSyncExternalStore } from 'react'
import { makeEntity, mergeEntity } from '../data/schema.js'
import { uid } from './id.js'
import { iso } from './time.js'

/**
 * The whole application state, in one object, persisted to localStorage.
 *
 * No reducer library, no context tree. `useStore(selector)` reads, the exported
 * action functions write. If state ever outgrows a single object, that is the
 * moment to reach for something bigger - not before.
 */

const KEY = 'all-dash:v1'
const SCHEMA_VERSION = 1

const DEFAULT_BOARDS = {
  today: [
    { id: 'w1', widgetId: 'agenda', size: 'md' },
    { id: 'w2', widgetId: 'focus-tasks', size: 'md' },
    { id: 'w8', widgetId: 'triage', size: 'md' },
    { id: 'w3', widgetId: 'reminders', size: 'sm' },
    { id: 'w4', widgetId: 'pulse', size: 'sm' },
    { id: 'w5', widgetId: 'recent-activity', size: 'md' },
    { id: 'w6', widgetId: 'open-questions', size: 'md' },
    { id: 'w7', widgetId: 'status-update', size: 'xl' },
  ],
  analytics: [
    { id: 'a1', widgetId: 'metric-grid', size: 'xl' },
    { id: 'a2', widgetId: 'series-explorer', size: 'xl' },
    { id: 'a3', widgetId: 'throughput', size: 'md' },
    { id: 'a4', widgetId: 'workload', size: 'md' },
    { id: 'a5', widgetId: 'insights', size: 'lg' },
    { id: 'a6', widgetId: 'load-heatmap', size: 'lg' },
    { id: 'a7', widgetId: 'leaderboard', size: 'md' },
    { id: 'a8', widgetId: 'relationship-map', size: 'xl' },
  ],
}

const initialState = () => ({
  version: SCHEMA_VERSION,
  workspace: { name: 'My Command Center', createdAt: iso(new Date()) },
  entities: {},
  docs: [],
  boards: structuredClone(DEFAULT_BOARDS),
  customMetrics: [],
  reminders: {},
  settings: {
    theme: 'system',
    density: 'comfortable',
    weekStartsOn: 1,
    notifications: false,
    reminderLeadMinutes: 15,
    seeded: false,
    // The assistant's key is never in here; see src/ai/keys.js.
    assistant: {
      provider: 'anthropic',
      baseUrl: '',
      model: '',
      privacy: 'full',
      contextLimit: 40,
      speak: false,
      handsFree: false,
    },
  },
  triage: {},
  ui: { range: '30d', filterTags: [], filterPeople: [], query: '' },
})

let state = load()
const listeners = new Set()

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return initialState()
    const parsed = JSON.parse(raw)
    const base = initialState()
    return {
      ...base,
      ...parsed,
      version: SCHEMA_VERSION,
      settings: { ...base.settings, ...(parsed.settings || {}), assistant: { ...base.settings.assistant, ...(parsed.settings?.assistant || {}) } },
    }
  } catch {
    return initialState()
  }
}

let saveTimer = null
function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch (err) {
      console.warn('All Dash: could not persist state', err)
    }
  }, 250)
}

function set(updater) {
  const next = typeof updater === 'function' ? updater(state) : updater
  if (next === state) return
  state = next
  persist()
  listeners.forEach((fn) => fn())
}

const subscribe = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const getState = () => state

/** Read a slice. Selector must return a stable reference for objects. */
export function useStore(selector = (s) => s) {
  return useSyncExternalStore(subscribe, () => selector(state), () => selector(state))
}

// ---------------------------------------------------------------- entities

export function addEntities(list) {
  if (!list?.length) return []
  const created = []
  set((s) => {
    const entities = { ...s.entities }
    for (const raw of list) {
      const entity = makeEntity(raw)
      entities[entity.id] = mergeEntity(entities[entity.id], entity)
      created.push(entities[entity.id])
    }
    return { ...s, entities }
  })
  return created
}

export function addEntity(raw) {
  return addEntities([raw])[0]
}

/**
 * Replace what one document produced. Items the new version no longer
 * contains are dropped; items it still contains are merged, which keeps any
 * status, priority or due date the user set by hand. This is what makes
 * "import the updated file" do the obvious thing.
 */
export function syncDoc(docId, list) {
  const next = (list || []).map(makeEntity)
  const keep = new Set(next.map((e) => e.id))
  const created = []
  set((s) => {
    const entities = {}
    for (const [id, e] of Object.entries(s.entities)) {
      if (e.source?.docId === docId && e.type !== 'doc' && !keep.has(id)) continue
      entities[id] = e
    }
    for (const entity of next) {
      entities[entity.id] = mergeEntity(entities[entity.id], entity)
      created.push(entities[entity.id])
    }
    return { ...s, entities }
  })
  return created
}

export function updateEntity(id, patch) {
  set((s) => {
    const current = s.entities[id]
    if (!current) return s
    const next = {
      ...current,
      ...patch,
      meta: { ...current.meta, ...(patch.meta || {}), editedByUser: true },
      updatedAt: iso(new Date()),
    }
    return { ...s, entities: { ...s.entities, [id]: next } }
  })
}

export function removeEntity(id) {
  set((s) => {
    const entities = { ...s.entities }
    delete entities[id]
    return { ...s, entities }
  })
}

export function removeDoc(docId) {
  set((s) => {
    const entities = {}
    for (const [id, e] of Object.entries(s.entities)) {
      if (e.source?.docId !== docId && e.id !== docId) entities[id] = e
    }
    return { ...s, entities, docs: s.docs.filter((d) => d.id !== docId) }
  })
}

export function registerDoc(doc) {
  set((s) => ({ ...s, docs: [doc, ...s.docs.filter((d) => d.id !== doc.id)].slice(0, 200) }))
}

/** What one click on a task's checkbox does. Blocked and cancelled reopen. */
export function nextTaskStatus(status) {
  if (status === 'open') return 'doing'
  if (status === 'doing') return 'done'
  return 'open'
}

export function cycleTaskStatus(id) {
  const current = state.entities[id]
  if (!current) return
  updateEntity(id, { status: nextTaskStatus(current.status) })
}

// ------------------------------------------------------------------ boards

export function setBoard(view, items) {
  set((s) => ({ ...s, boards: { ...s.boards, [view]: items } }))
}

export function addWidget(view, widgetId, size) {
  set((s) => {
    const items = s.boards[view] || []
    return {
      ...s,
      boards: { ...s.boards, [view]: [...items, { id: uid('w'), widgetId, size: size || 'md' }] },
    }
  })
}

export function removeWidget(view, itemId) {
  set((s) => ({ ...s, boards: { ...s.boards, [view]: (s.boards[view] || []).filter((i) => i.id !== itemId) } }))
}

export function updateWidget(view, itemId, patch) {
  set((s) => ({
    ...s,
    boards: {
      ...s.boards,
      [view]: (s.boards[view] || []).map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
    },
  }))
}

export function moveWidget(view, itemId, delta) {
  set((s) => {
    const items = [...(s.boards[view] || [])]
    const idx = items.findIndex((i) => i.id === itemId)
    const target = idx + delta
    if (idx < 0 || target < 0 || target >= items.length) return s
    const [item] = items.splice(idx, 1)
    items.splice(target, 0, item)
    return { ...s, boards: { ...s.boards, [view]: items } }
  })
}

export function resetBoard(view) {
  set((s) => ({
    ...s,
    boards: { ...s.boards, [view]: structuredClone(DEFAULT_BOARDS[view] || []) },
  }))
}

// -------------------------------------------------------- settings and ui

export function updateSettings(patch) {
  set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
}

export function updateAssistantSettings(patch) {
  set((s) => ({ ...s, settings: { ...s.settings, assistant: { ...(s.settings.assistant || {}), ...patch } } }))
}

/** Silence one triage signal until a date. The signal itself is never stored. */
export function muteSignal(id, untilIso) {
  set((s) => ({ ...s, triage: { ...(s.triage || {}), [id]: { until: untilIso } } }))
}

export function unmuteSignal(id) {
  set((s) => {
    const triage = { ...(s.triage || {}) }
    delete triage[id]
    return { ...s, triage }
  })
}

export function updateUi(patch) {
  set((s) => ({ ...s, ui: { ...s.ui, ...patch } }))
}

export function addCustomMetric(metric) {
  set((s) => ({ ...s, customMetrics: [...s.customMetrics.filter((m) => m.id !== metric.id), metric] }))
}

export function removeCustomMetric(id) {
  set((s) => ({ ...s, customMetrics: s.customMetrics.filter((m) => m.id !== id) }))
}

export function snoozeReminder(id, untilIso) {
  set((s) => ({ ...s, reminders: { ...s.reminders, [id]: { snoozedUntil: untilIso } } }))
}

export function dismissReminder(id) {
  set((s) => ({ ...s, reminders: { ...s.reminders, [id]: { dismissed: true } } }))
}

// ------------------------------------------------------------- workspace io

export function exportWorkspace() {
  return JSON.stringify({ ...state, exportedAt: iso(new Date()) }, null, 2)
}

export function importWorkspace(json, { merge = false } = {}) {
  const incoming = typeof json === 'string' ? JSON.parse(json) : json
  if (!incoming || typeof incoming !== 'object') throw new Error('Not a workspace file')
  // Every entity goes back through the schema, so a hand-edited or older
  // export cannot put a record without people/tags arrays into the store.
  const entities = {}
  for (const raw of Object.values(incoming.entities || {})) {
    if (!raw || typeof raw !== 'object') continue
    const entity = makeEntity(raw)
    entities[entity.id] = entity
  }
  const docs = Array.isArray(incoming.docs) ? incoming.docs.filter((d) => d && d.id) : []
  const customMetrics = Array.isArray(incoming.customMetrics) ? incoming.customMetrics.filter((m) => m && m.id) : []
  set((s) => {
    if (!merge) {
      const base = initialState()
      return {
        ...base,
        ...incoming,
        version: SCHEMA_VERSION,
        entities,
        docs,
        customMetrics,
        boards: incoming.boards && typeof incoming.boards === 'object' ? { ...base.boards, ...incoming.boards } : base.boards,
        settings: {
          ...base.settings,
          ...(incoming.settings || {}),
          assistant: { ...base.settings.assistant, ...(incoming.settings?.assistant || {}) },
        },
        triage: incoming.triage && typeof incoming.triage === 'object' ? incoming.triage : {},
        ui: { ...base.ui, ...(incoming.ui || {}) },
        reminders: incoming.reminders && typeof incoming.reminders === 'object' ? incoming.reminders : {},
      }
    }
    return {
      ...s,
      entities: { ...s.entities, ...entities },
      docs: [...docs, ...s.docs].slice(0, 200),
      customMetrics: [...s.customMetrics, ...customMetrics],
    }
  })
}

export function clearWorkspace() {
  set(() => ({ ...initialState(), settings: { ...initialState().settings, seeded: true } }))
}
