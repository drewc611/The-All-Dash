import { readFile, writeFile, rename } from 'node:fs/promises'

import { q } from '../../../src/core/query.js'
import { rangeFor, iso } from '../../../src/core/time.js'
import { makeEntity, ENTITY_TYPES } from '../../../src/data/schema.js'
import { buildTriage, summarise } from '../../../src/engine/triage.js'
import { buildInsights } from '../../../src/engine/insights.js'
import { buildReport } from '../../../src/engine/report.js'
import { availableMetrics, evaluate } from '../../../src/engine/metrics.js'
// Registering the built-in metrics is a side effect of importing the engine.
import '../../../src/engine/metrics.js'

/**
 * The browser app's workspace, read from its export file and queried with
 * the app's own engines, so "what is late" means the same thing here as in
 * the Triage view. Writes append or patch entities in the file; the user
 * re-imports it (Settings → Your data → Restore) to see them in the app.
 */
export class WorkspaceAdapter {
  constructor(file) {
    this.file = file
    this.state = null
    this.loadedAt = 0
  }

  async load(force = false) {
    if (this.state && !force && Date.now() - this.loadedAt < 2000) return this.state
    const raw = await readFile(this.file, 'utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.entities !== 'object') {
      throw new Error(`${this.file} is not an All Dash workspace export`)
    }
    this.state = parsed
    this.loadedAt = Date.now()
    return parsed
  }

  async save() {
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.state, null, 2))
    await rename(tmp, this.file)
    this.loadedAt = Date.now()
  }

  range(state) {
    return rangeFor(state.ui?.range || '30d')
  }

  async overview() {
    const state = await this.load()
    const rows = Object.values(state.entities)
    const now = new Date()
    const range = this.range(state)
    const counts = {}
    for (const e of rows) counts[e.type] = (counts[e.type] || 0) + 1
    const signals = buildTriage(state.entities, { now, range, customMetrics: state.customMetrics || [], mutes: state.triage || {} })
    const insights = buildInsights(state.entities, range, state.customMetrics || [], now)
    const metrics = availableMetrics(state.entities, state.customMetrics || [])
      .map((m) => evaluate(m, state.entities, range))
      .filter(Boolean)
      .slice(0, 12)
      .map((m) => ({ id: m.id, name: m.name, value: m.value, unit: m.unit, change: m.change }))
    return {
      workspace: state.workspace?.name || 'Workspace',
      range: range.label,
      counts,
      openTasks: q(rows).type('task').open().count(),
      overdueTasks: q(rows).type('task').open().due({ before: now }).count(),
      meetingsToday: q(rows).type('event').onDay(now).count(),
      triage: summarise(signals),
      insights: insights.slice(0, 8).map((i) => ({ severity: i.severity, title: i.title, detail: i.detail })),
      metrics,
    }
  }

  async triage(severity) {
    const state = await this.load()
    const signals = buildTriage(state.entities, {
      range: this.range(state),
      customMetrics: state.customMetrics || [],
      mutes: state.triage || {},
    })
    return signals
      .filter((s) => !severity || s.severity === severity)
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        severity: s.severity,
        title: s.title,
        why: s.why,
        actions: s.actions.map((a) => a.id),
        entity: s.entity ? slim(s.entity) : null,
        related: (s.entities || []).slice(0, 6).map(slim),
      }))
  }

  async statusUpdate() {
    const state = await this.load()
    return buildReport(state.entities, { range: this.range(state), customMetrics: state.customMetrics || [] })
  }

  async search(query, { type, limit = 20 } = {}) {
    const state = await this.load()
    let scope = q(Object.values(state.entities)).where((e) => e.type !== 'person')
    if (type && ENTITY_TYPES.includes(type)) scope = scope.type(type)
    return scope.search(query).sort('updatedAt', 'desc').take(limit).map(slim)
  }

  async get(id) {
    const state = await this.load()
    // hasOwn, so ids like "__proto__" or "constructor" resolve to nothing
    // instead of to Object.prototype.
    return Object.hasOwn(state.entities, id) ? state.entities[id] : null
  }

  async addTask({ title, due, people = [], tags = [], priority = 0, body = '' }) {
    const state = await this.load(true)
    const entity = makeEntity({
      type: 'task',
      title,
      body,
      status: 'open',
      due: due ? new Date(`${due}T17:00`).toISOString() : null,
      people,
      tags,
      priority,
      meta: { editedByUser: true },
      source: { kind: 'manual', name: 'MCP' },
    })
    state.entities[entity.id] = entity
    await this.save()
    return entity
  }

  async updateTask(id, patch) {
    const state = await this.load(true)
    const current = Object.hasOwn(state.entities, id) ? state.entities[id] : null
    if (!current) throw new Error(`No entity ${id}`)
    const next = { ...current }
    if (patch.status) next.status = patch.status
    if (patch.priority !== undefined) next.priority = patch.priority
    if (patch.due !== undefined) next.due = patch.due ? new Date(`${patch.due}T17:00`).toISOString() : null
    if (patch.people) next.people = patch.people
    if (patch.tags) next.tags = patch.tags
    if (patch.title) next.title = patch.title
    next.meta = { ...(current.meta || {}), editedByUser: true }
    next.updatedAt = iso(new Date())
    state.entities[id] = next
    await this.save()
    return next
  }
}

export const slim = (e) => ({
  id: e.id,
  type: e.type,
  title: e.title,
  status: e.status,
  priority: e.priority,
  due: e.due,
  at: e.at,
  people: e.people,
  tags: e.tags,
  value: e.type === 'metric' ? e.value : undefined,
  unit: e.type === 'metric' ? e.unit : undefined,
  source: e.source?.name,
})
