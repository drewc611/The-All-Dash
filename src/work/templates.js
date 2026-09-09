/**
 * Board templates.
 *
 * A template is a board shape plus a couple of starter rules - never sample
 * rows, because an empty board you understand beats a full one you have to
 * clear out. Each one is the smallest set of columns that makes its job work.
 */

import { makeColumn, makeGroup, makeView } from './schema.js'
import { makeAutomation } from './automations.js'
import { DEFAULT_STATUS_LABELS, PRIORITY_LABELS } from './columns.js'

const status = (labels) => makeColumn('status', 'Status', { labels })
const labelSet = (...pairs) => pairs.map(([text, tone, maps]) => ({ id: text.toLowerCase().replace(/[^a-z0-9]+/g, '-'), text, tone, maps: maps || 'open' }))

export const TEMPLATES = [
  {
    id: 'projects',
    name: 'Project plan',
    blurb: 'Owners, timelines, priorities and a dependency chain.',
    build: () => {
      const owner = makeColumn('person', 'Owner')
      const state = status(structuredClone(DEFAULT_STATUS_LABELS))
      const timeline = makeColumn('timeline', 'Timeline')
      const priority = makeColumn('priority', 'Priority', { labels: structuredClone(PRIORITY_LABELS) })
      const progress = makeColumn('progress', 'Progress')
      const depends = makeColumn('dependency', 'Depends on')
      const notes = makeColumn('longtext', 'Notes')
      const groups = [makeGroup('Discovery'), makeGroup('Build', 'good'), makeGroup('Launch', 'warning'), makeGroup('Done', 'neutral')]
      return {
        name: 'Project plan',
        itemNoun: 'Task',
        dependencyMode: 'push',
        groups,
        columns: [owner, state, timeline, priority, progress, depends, notes],
        views: [
          makeView('table', 'Main table'),
          makeView('timeline', 'Timeline', { timelineColumn: timeline.id, colorBy: state.id }),
          makeView('kanban', 'By status', { groupBy: state.id }),
          makeView('workload', 'Workload', { personColumn: owner.id, timelineColumn: timeline.id }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'status-becomes', columnId: state.id, value: 'done' },
            actions: [{ kind: 'move-to-group', groupId: groups[3].id }, { kind: 'set-column', columnId: progress.id, value: 100 }],
          }),
        ],
      }
    },
  },
  {
    id: 'sprint',
    name: 'Sprint backlog',
    blurb: 'Points, epics and a board that empties itself each sprint.',
    build: () => {
      const state = status(labelSet(['Backlog', 'neutral'], ['In progress', 'warning', 'doing'], ['In review', 'accent', 'doing'], ['Blocked', 'critical', 'blocked'], ['Shipped', 'good', 'done']))
      const owner = makeColumn('person', 'Assignee')
      const points = makeColumn('number', 'Points', { decimals: 0 })
      const epic = makeColumn('dropdown', 'Epic', { labels: labelSet(['Platform', 'accent'], ['Growth', 'good'], ['Reliability', 'serious']), multi: false })
      const due = makeColumn('date', 'Due')
      const bug = makeColumn('checkbox', 'Bug')
      return {
        name: 'Sprint backlog',
        itemNoun: 'Story',
        groups: [makeGroup('Sprint'), makeGroup('Next sprint', 'good'), makeGroup('Icebox', 'neutral')],
        columns: [owner, state, points, epic, due, bug],
        views: [
          makeView('table', 'Main table', { summaries: { [points.id]: 'sum' } }),
          makeView('kanban', 'Sprint board', { groupBy: state.id }),
          makeView('chart', 'Points by assignee', { dimension: owner.id, measure: points.id, reduce: 'sum' }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'status-becomes', columnId: state.id, value: 'blocked' },
            actions: [{ kind: 'notify', text: '{item} is blocked' }],
          }),
        ],
      }
    },
  },
  {
    id: 'crm',
    name: 'Sales pipeline',
    blurb: 'Deals, stages, a weighted forecast that keeps itself current.',
    build: () => {
      const stage = status(labelSet(['New', 'neutral'], ['Qualified', 'accent', 'doing'], ['Proposal', 'warning', 'doing'], ['Negotiation', 'serious', 'doing'], ['Won', 'good', 'done'], ['Lost', 'critical', 'cancelled']))
      const owner = makeColumn('person', 'Owner')
      const value = makeColumn('number', 'Deal value', { unit: '$' })
      const probability = makeColumn('number', 'Probability %', { decimals: 0 })
      const forecast = makeColumn('formula', 'Forecast', { formula: '{Deal value} * {Probability %} / 100', unit: '$' })
      const close = makeColumn('date', 'Expected close')
      const contact = makeColumn('text', 'Contact')
      const email = makeColumn('email', 'Email')
      const phone = makeColumn('phone', 'Phone')
      return {
        name: 'Sales pipeline',
        itemNoun: 'Deal',
        groups: [makeGroup('This quarter'), makeGroup('Next quarter', 'good'), makeGroup('Closed', 'neutral')],
        columns: [owner, stage, value, probability, forecast, close, contact, email, phone],
        views: [
          makeView('table', 'Main table', { summaries: { [value.id]: 'sum', [forecast.id]: 'sum' } }),
          makeView('kanban', 'Pipeline', { groupBy: stage.id }),
          makeView('chart', 'Value by stage', { dimension: stage.id, measure: value.id, reduce: 'sum' }),
          makeView('form', 'New lead', { fields: [contact.id, email.id, phone.id, value.id] }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'status-becomes', columnId: stage.id, value: 'won' },
            actions: [{ kind: 'notify', text: 'Won: {item}' }, { kind: 'add-update', text: 'Closed won.' }],
          }),
        ],
      }
    },
  },
  {
    id: 'bugs',
    name: 'Bug tracker',
    blurb: 'Severity, environment, reporter, and a rule for anything critical.',
    build: () => {
      const state = status(labelSet(['Reported', 'neutral'], ['Triaged', 'accent', 'doing'], ['Fixing', 'warning', 'doing'], ['Blocked', 'critical', 'blocked'], ['Released', 'good', 'done']))
      const severity = makeColumn('priority', 'Severity', {
        labels: [
          { id: 'low', text: 'Low', tone: 'neutral', value: 0 },
          { id: 'medium', text: 'Medium', tone: 'accent', value: 0 },
          { id: 'high', text: 'High', tone: 'warning', value: 1 },
          { id: 'critical', text: 'Critical', tone: 'critical', value: 2 },
        ],
      })
      const owner = makeColumn('person', 'Owner')
      const reporter = makeColumn('text', 'Reported by')
      const environment = makeColumn('dropdown', 'Environment', { labels: labelSet(['Production', 'critical'], ['Staging', 'warning'], ['Local', 'neutral']), multi: false })
      const link = makeColumn('link', 'Trace')
      const found = makeColumn('date', 'Found')
      return {
        name: 'Bug tracker',
        itemNoun: 'Bug',
        groups: [makeGroup('Open', 'critical'), makeGroup('In flight', 'warning'), makeGroup('Released', 'good')],
        columns: [owner, state, severity, environment, reporter, found, link],
        views: [
          makeView('table', 'Main table'),
          makeView('kanban', 'By state', { groupBy: state.id }),
          makeView('chart', 'Bugs by severity', { dimension: severity.id, reduce: 'count' }),
          makeView('form', 'Report a bug', { fields: [reporter.id, environment.id, severity.id, link.id] }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'item-created' },
            conditions: [{ columnId: severity.id, op: 'is', value: 'critical' }],
            actions: [{ kind: 'notify', text: 'Critical bug filed: {item}' }],
          }),
        ],
      }
    },
  },
  {
    id: 'content',
    name: 'Content calendar',
    blurb: 'Channels, publish dates and a calendar view that is the point.',
    build: () => {
      const state = status(labelSet(['Idea', 'neutral'], ['Drafting', 'warning', 'doing'], ['In review', 'accent', 'doing'], ['Scheduled', 'serious', 'doing'], ['Published', 'good', 'done']))
      const writer = makeColumn('person', 'Writer')
      const channel = makeColumn('dropdown', 'Channel', { labels: labelSet(['Blog', 'accent'], ['Newsletter', 'good'], ['Social', 'warning'], ['Video', 'serious']) })
      const publish = makeColumn('date', 'Publish')
      const link = makeColumn('link', 'Draft')
      const brief = makeColumn('longtext', 'Brief')
      return {
        name: 'Content calendar',
        itemNoun: 'Piece',
        groups: [makeGroup('This month'), makeGroup('Next month', 'good'), makeGroup('Ideas', 'neutral')],
        columns: [writer, state, channel, publish, link, brief],
        views: [
          makeView('calendar', 'Calendar', { dateColumn: publish.id, colorBy: channel.id }),
          makeView('table', 'Main table'),
          makeView('kanban', 'By stage', { groupBy: state.id }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'date-arrives', columnId: publish.id, offset: -2 },
            actions: [{ kind: 'notify', text: '{item} publishes in two days' }],
          }),
        ],
      }
    },
  },
  {
    id: 'hiring',
    name: 'Hiring pipeline',
    blurb: 'One row per candidate, a stage per column, a rating that sorts.',
    build: () => {
      const stage = status(labelSet(['Applied', 'neutral'], ['Screening', 'accent', 'doing'], ['Interviewing', 'warning', 'doing'], ['Offer', 'serious', 'doing'], ['Hired', 'good', 'done'], ['Passed', 'critical', 'cancelled']))
      const role = makeColumn('dropdown', 'Role', { labels: labelSet(['Engineering', 'accent'], ['Design', 'good'], ['Sales', 'warning']), multi: false })
      const owner = makeColumn('person', 'Interviewer')
      const rating = makeColumn('rating', 'Rating')
      const email = makeColumn('email', 'Email')
      const cv = makeColumn('link', 'CV')
      const next = makeColumn('date', 'Next step')
      return {
        name: 'Hiring pipeline',
        itemNoun: 'Candidate',
        groups: [makeGroup('Active'), makeGroup('On hold', 'warning'), makeGroup('Closed', 'neutral')],
        columns: [owner, stage, role, rating, next, email, cv],
        views: [
          makeView('kanban', 'Pipeline', { groupBy: stage.id }),
          makeView('table', 'Main table'),
          makeView('form', 'Application', { fields: [role.id, email.id, cv.id] }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'status-becomes', columnId: stage.id, value: 'offer' },
            actions: [{ kind: 'notify', text: 'Offer stage: {item}' }],
          }),
        ],
      }
    },
  },
  {
    id: 'clients',
    name: 'Client work',
    blurb: 'Time tracked per row, a rate, and an invoice total that adds up.',
    build: () => {
      const state = status(structuredClone(DEFAULT_STATUS_LABELS))
      const client = makeColumn('text', 'Client')
      const owner = makeColumn('person', 'Consultant')
      const tracked = makeColumn('time', 'Time')
      const rate = makeColumn('number', 'Rate', { unit: '$' })
      const total = makeColumn('formula', 'Billable', { formula: '{Time} * {Rate}', unit: '$' })
      const billed = makeColumn('checkbox', 'Invoiced')
      const due = makeColumn('date', 'Due')
      const groups = [makeGroup('In progress'), makeGroup('Ready to invoice', 'warning'), makeGroup('Invoiced', 'good')]
      return {
        name: 'Client work',
        itemNoun: 'Job',
        groups,
        columns: [client, owner, state, tracked, rate, total, billed, due],
        views: [
          makeView('table', 'Main table', { summaries: { [total.id]: 'sum', [tracked.id]: 'hours' } }),
          makeView('chart', 'Billable by client', { dimension: client.id, measure: total.id, reduce: 'sum' }),
        ],
        automations: [
          makeAutomation({
            trigger: { kind: 'status-becomes', columnId: state.id, value: 'done' },
            actions: [{ kind: 'move-to-group', groupId: groups[1].id }, { kind: 'notify', text: '{item} is ready to invoice' }],
          }),
        ],
      }
    },
  },
  {
    id: 'goals',
    name: 'Goals and OKRs',
    blurb: 'A target, a current number, and the percentage between them.',
    build: () => {
      const state = status(labelSet(['Off track', 'critical', 'blocked'], ['At risk', 'warning', 'doing'], ['On track', 'good', 'doing'], ['Achieved', 'good', 'done']))
      const owner = makeColumn('person', 'Owner')
      const target = makeColumn('number', 'Target')
      const current = makeColumn('number', 'Current')
      const attainment = makeColumn('formula', 'Attainment', { formula: 'PERCENT({Current}, {Target})', unit: '%' })
      const quarter = makeColumn('dropdown', 'Quarter', { labels: labelSet(['Q1', 'accent'], ['Q2', 'good'], ['Q3', 'warning'], ['Q4', 'serious']), multi: false })
      const timeline = makeColumn('timeline', 'Window')
      return {
        name: 'Goals and OKRs',
        itemNoun: 'Goal',
        groups: [makeGroup('Company'), makeGroup('Team', 'good'), makeGroup('Personal', 'neutral')],
        columns: [owner, state, target, current, attainment, quarter, timeline],
        views: [
          makeView('table', 'Main table', { summaries: { [attainment.id]: 'avg' } }),
          makeView('chart', 'Attainment by owner', { dimension: owner.id, measure: attainment.id, reduce: 'avg' }),
          makeView('timeline', 'Windows', { timelineColumn: timeline.id, colorBy: state.id }),
        ],
        automations: [],
      }
    },
  },
  {
    id: 'simple',
    name: 'Simple tasks',
    blurb: 'A list with an owner, a status and a date. Nothing else.',
    build: () => ({
      name: 'Tasks',
      itemNoun: 'Task',
      groups: [makeGroup('To do'), makeGroup('Done', 'good')],
      columns: [makeColumn('person', 'Owner'), status(structuredClone(DEFAULT_STATUS_LABELS)), makeColumn('date', 'Due'), makeColumn('checkbox', 'Starred')],
      views: [makeView('table', 'Main table'), makeView('kanban', 'Board')],
      automations: [],
    }),
  },
]

export const templateById = (id) => TEMPLATES.find((t) => t.id === id) || null
