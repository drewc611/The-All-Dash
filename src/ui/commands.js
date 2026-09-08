import { defineCommand } from '../core/registry.js'
import { addEntity, updateSettings, getState, exportWorkspace, resetBoard } from '../core/store.js'
import { seedWorkspace } from '../data/seed.js'
import { buildReport } from '../engine/report.js'
import { rangeFor } from '../core/time.js'

/** Built-in commands. Plugins add their own with AllDash.defineCommand. */

const go = (view, name, keywords) =>
  defineCommand({
    id: `go:${view}`,
    name,
    group: 'Go to',
    keywords,
    run: ({ navigate }) => navigate(view),
  })

go('today', 'Today', ['home', 'dashboard', 'agenda'])
go('timeline', 'Timeline', ['calendar', 'schedule', 'week'])
go('analytics', 'Analytics', ['metrics', 'charts', 'numbers'])
go('library', 'Library', ['documents', 'files', 'search', 'inbox'])
go('settings', 'Settings', ['preferences', 'theme', 'export'])

defineCommand({
  id: 'import',
  name: 'Import a file',
  hint: 'Notes, transcripts, calendars, spreadsheets',
  keywords: ['upload', 'csv', 'xlsx', 'ics', 'add'],
  run: () => document.getElementById('global-file-input')?.click(),
})

defineCommand({
  id: 'paste',
  name: 'Paste notes',
  hint: 'Read text straight from the clipboard into the dashboard',
  keywords: ['text', 'notes', 'meeting'],
  run: () => window.dispatchEvent(new CustomEvent('alldash:paste')),
})

defineCommand({
  id: 'new-task',
  name: 'Add a task',
  hint: 'Type it with @owner, #tag and a due date',
  keywords: ['todo', 'capture'],
  run: () => {
    const title = prompt('New task')
    if (title?.trim()) addEntity({ type: 'task', title: title.trim(), source: { kind: 'manual', name: 'Command bar' } })
  },
})

defineCommand({
  id: 'status-update',
  name: 'Copy my status update',
  hint: 'Done, in progress, blocked, decisions, numbers that moved, next 7 days - as Markdown',
  keywords: ['report', 'weekly', 'standup', 'summary', 'update'],
  run: async () => {
    const state = getState()
    const markdown = buildReport(state.entities, { range: rangeFor(state.ui.range), customMetrics: state.customMetrics })
    const say = (message, tone) => window.dispatchEvent(new CustomEvent('alldash:toast', { detail: { message, tone } }))
    try {
      await navigator.clipboard.writeText(markdown)
      say('Status update copied as Markdown.', 'good')
    } catch {
      say('Clipboard blocked. Open the Status update widget on Today and copy from there.', 'critical')
    }
  },
})

defineCommand({
  id: 'theme',
  name: 'Switch theme',
  hint: 'Cycle system, light, dark',
  keywords: ['dark', 'light', 'appearance'],
  run: () => {
    const order = ['system', 'light', 'dark']
    const current = getState().settings.theme
    updateSettings({ theme: order[(order.indexOf(current) + 1) % order.length] })
  },
})

defineCommand({
  id: 'density',
  name: 'Toggle density',
  keywords: ['compact', 'comfortable', 'spacing'],
  run: () => {
    const current = getState().settings.density
    updateSettings({ density: current === 'compact' ? 'comfortable' : 'compact' })
  },
})

defineCommand({
  id: 'export',
  name: 'Export workspace',
  hint: 'Download everything as JSON',
  keywords: ['backup', 'download', 'save'],
  run: () => {
    const blob = new Blob([exportWorkspace()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all-dash-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  },
})

defineCommand({
  id: 'seed',
  name: 'Load the sample project',
  hint: 'Four documents run through the real parsers',
  keywords: ['demo', 'example', 'sample'],
  run: () => seedWorkspace(),
})

defineCommand({
  id: 'reset-board',
  name: 'Reset this board',
  hint: 'Put the widgets back where they started',
  keywords: ['layout', 'widgets', 'default'],
  run: ({ navigate }) => {
    const view = window.location.hash.replace('#', '') || 'today'
    resetBoard(view)
    navigate(view)
  },
})
