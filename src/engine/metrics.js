import { defineMetric, getMetric, listMetrics } from '../core/registry.js'
import { q, daily, trend, momentum } from '../core/query.js'
import { OPEN_STATUSES } from '../data/schema.js'

/**
 * Metrics are reductions with a name. Built-ins cover the things every project
 * tracks; anything a user builds in the metric builder compiles to exactly the
 * same shape, so a custom metric is a first-class citizen everywhere.
 */

defineMetric({
  id: 'tasks-open',
  name: 'Open tasks',
  goal: 'down',
  compute: (entities, range) => {
    const rows = q(entities).type('task').open().all()
    const dated = rows.filter((r) => r.due)
    return { value: rows.length, series: daily(dated, { from: range.from, to: range.to, field: 'due' }) }
  },
})

defineMetric({
  id: 'tasks-completed',
  name: 'Completed',
  goal: 'up',
  compute: (entities, range) => {
    const rows = q(entities).type('task').status('done').between(range.from, range.to, 'updatedAt').all()
    return { value: rows.length, series: daily(rows, { from: range.from, to: range.to, field: 'updatedAt' }) }
  },
})

defineMetric({
  id: 'tasks-overdue',
  name: 'Overdue',
  goal: 'down',
  compute: (entities) => {
    const rows = q(entities).type('task').open().due({ before: new Date() }).all()
    return { value: rows.length, series: [] }
  },
})

defineMetric({
  id: 'meeting-load',
  name: 'Meeting hours',
  unit: 'h',
  goal: 'down',
  compute: (entities, range) => {
    const rows = q(entities).type('event').between(range.from, range.to, 'at').all()
    const hours = rows.map((e) => ({
      ...e,
      value: e.end ? Math.max(0, (new Date(e.end) - new Date(e.at)) / 3600000) : 0.5,
    }))
    return {
      value: round(hours.reduce((a, e) => a + e.value, 0)),
      series: daily(hours, { from: range.from, to: range.to, reduce: 'sum' }),
    }
  },
})

defineMetric({
  id: 'decisions',
  name: 'Decisions logged',
  goal: 'up',
  compute: (entities, range) => {
    const rows = q(entities).type('decision').between(range.from, range.to, 'createdAt').all()
    return { value: rows.length, series: daily(rows, { from: range.from, to: range.to, field: 'createdAt' }) }
  },
})

defineMetric({
  id: 'risks-open',
  name: 'Open risks',
  goal: 'down',
  compute: (entities) => ({ value: q(entities).type('risk').open().count(), series: [] }),
})

defineMetric({
  id: 'docs-ingested',
  name: 'Documents read',
  goal: 'up',
  compute: (entities, range) => {
    const rows = q(entities).type('doc').between(range.from, range.to, 'at').all()
    return { value: rows.length, series: daily(rows, { from: range.from, to: range.to }) }
  },
})

/**
 * Every distinct metric series found in imported data becomes queryable
 * without anyone defining it. This is what makes a new spreadsheet column show
 * up in the metric picker on its own.
 */
export function discoveredSeries(entities) {
  const names = new Map()
  for (const e of Object.values(entities)) {
    if (e.type !== 'metric' || !e.series) continue
    if (!names.has(e.series)) names.set(e.series, { name: e.series, unit: e.unit, count: 0 })
    names.get(e.series).count++
  }
  return [...names.values()].sort((a, b) => b.count - a.count)
}

/** Compile a saved custom-metric config into the same shape as a built-in. */
export function compileCustom(config) {
  return {
    id: config.id,
    name: config.name,
    unit: config.unit || '',
    goal: config.goal || 'up',
    custom: true,
    config,
    compute: (entities, range) => {
      let rows = q(entities)
      if (config.entityType && config.entityType !== 'any') rows = rows.type(config.entityType)
      if (config.seriesName) rows = rows.series(config.seriesName)
      if (config.tags?.length) rows = rows.tagged(config.tags)
      if (config.people?.length) rows = rows.person(config.people)
      if (config.onlyOpen) rows = rows.status(OPEN_STATUSES)
      const field = config.dateField || 'at'
      const scoped = rows.between(range.from, range.to, field).all()
      const points = daily(scoped, { from: range.from, to: range.to, field, reduce: config.reduce || 'count' })
      const total =
        config.reduce === 'count' ? scoped.length
          : config.reduce === 'avg' ? avg(scoped.map((r) => Number(r.value) || 0))
            : config.reduce === 'last' ? (scoped.at(-1)?.value ?? 0)
              : config.reduce === 'max' ? Math.max(0, ...scoped.map((r) => Number(r.value) || 0))
                : scoped.reduce((a, r) => a + (Number(r.value) || 0), 0)
      return { value: round(total), series: points }
    },
  }
}

/** All metrics available right now: built-ins, discovered series, custom. */
export function availableMetrics(entities, customMetrics = []) {
  const discovered = discoveredSeries(entities).map((s) =>
    compileCustom({
      id: `series:${s.name}`,
      name: s.name,
      unit: s.unit,
      seriesName: s.name,
      entityType: 'metric',
      reduce: 'last',
      goal: 'neutral',
      discovered: true,
    })
  )
  return [...listMetrics(), ...discovered, ...customMetrics.map(compileCustom)]
}

export function evaluate(metric, entities, range) {
  const spec = typeof metric === 'string' ? getMetric(metric) : metric
  if (!spec) return null
  const result = spec.compute(Object.values(entities), range) || { value: 0, series: [] }
  const points = result.series || []
  return {
    id: spec.id,
    name: spec.name,
    unit: spec.unit || '',
    goal: spec.goal || 'up',
    value: result.value,
    series: points,
    trend: trend(points),
    momentum: momentum(points),
  }
}

const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0)
