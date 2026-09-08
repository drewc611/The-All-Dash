/**
 * The harness.
 *
 * Everything pluggable in The All Dash lands here: widgets that draw, parsers
 * that read files, commands that do things, and metric definitions that turn
 * raw entities into a number. Three maps and four register functions - that is
 * the whole extension surface, and it is exposed on `window.AllDash` so a
 * plugin can be a single <script> tag with no build step.
 */

const widgets = new Map()
const parsers = []
const commands = new Map()
const metrics = new Map()

const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

/** Subscribe to registry changes (a late-loaded plugin re-renders the board). */
export function onRegistryChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * @param {object} spec
 * @param {string} spec.id            stable key, used in saved layouts
 * @param {string} spec.name          shown in the widget picker
 * @param {string} spec.description
 * @param {string} [spec.category]    grouping in the picker
 * @param {'sm'|'md'|'lg'|'xl'} [spec.size]  default board span
 * @param {Function} spec.render      React component, gets { entities, config, widget }
 * @param {Array} [spec.options]      config fields: { key, label, type, choices }
 */
export function defineWidget(spec) {
  if (!spec?.id || typeof spec.render !== 'function') {
    throw new Error('defineWidget needs an id and a render function')
  }
  widgets.set(spec.id, { size: 'md', category: 'General', options: [], ...spec })
  notify()
  return spec.id
}

/**
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {string[]} spec.extensions  e.g. ['.csv', '.tsv']
 * @param {number} [spec.priority]    higher wins when several parsers match
 * @param {(input: {name, text, buffer, mime}) => boolean} spec.match
 * @param {(input) => Promise<Entity[]>|Entity[]} spec.parse
 */
export function defineParser(spec) {
  if (!spec?.id || typeof spec.parse !== 'function') {
    throw new Error('defineParser needs an id and a parse function')
  }
  const existing = parsers.findIndex((p) => p.id === spec.id)
  const entry = { priority: 0, extensions: [], binary: false, ...spec }
  if (existing >= 0) parsers[existing] = entry
  else parsers.push(entry)
  parsers.sort((a, b) => b.priority - a.priority)
  notify()
  return spec.id
}

/**
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name        shown in the command bar
 * @param {string} [spec.hint]
 * @param {string} [spec.group]
 * @param {string[]} [spec.keywords]
 * @param {(ctx) => void} spec.run  gets { store, navigate, close }
 */
export function defineCommand(spec) {
  if (!spec?.id || typeof spec.run !== 'function') {
    throw new Error('defineCommand needs an id and a run function')
  }
  commands.set(spec.id, { group: 'Actions', keywords: [], ...spec })
  notify()
  return spec.id
}

/**
 * A metric is a named reduction over entities. Widgets and the analytics view
 * both read from here, so a user-defined metric shows up everywhere at once.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.name
 * @param {string} [spec.unit]       '', '$', '%', 'h'
 * @param {'up'|'down'|'flat'} [spec.goal]  which direction is good
 * @param {(entities, range) => {value:number, series?:Array}} spec.compute
 */
export function defineMetric(spec) {
  if (!spec?.id || typeof spec.compute !== 'function') {
    throw new Error('defineMetric needs an id and a compute function')
  }
  metrics.set(spec.id, { unit: '', goal: 'up', ...spec })
  notify()
  return spec.id
}

export const getWidget = (id) => widgets.get(id)
export const listWidgets = () => [...widgets.values()]
export const listParsers = () => [...parsers]
export const listCommands = () => [...commands.values()]
export const getMetric = (id) => metrics.get(id)
export const listMetrics = () => [...metrics.values()]

if (typeof window !== 'undefined') {
  window.AllDash = Object.assign(window.AllDash || {}, {
    defineWidget,
    defineParser,
    defineCommand,
    defineMetric,
    listWidgets,
    listParsers,
    listMetrics,
  })
}
