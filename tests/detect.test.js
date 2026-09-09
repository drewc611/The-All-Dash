import test from 'node:test'
import assert from 'node:assert/strict'

import { detectFlavor, applyFlavor, trelloToTable, githubToTable, looksLikeTrello, looksLikeGithubIssues } from '../src/ingest/detect.js'
import { parseDelimited, toTable } from '../src/ingest/parsers/csv.js'
import { entitiesFromTable } from '../src/ingest/tabular.js'
import { listParsers } from '../src/core/registry.js'
import { dayKey } from '../src/core/time.js'
import '../src/ingest/parsers/json.js'
import '../src/ingest/parsers/csv.js'

const source = { docId: 'd1', name: 'export.csv', kind: 'csv' }

test('detectFlavor recognises the common task exports from their header row', () => {
  assert.equal(detectFlavor({ name: 'x.csv', text: 'Issue key,Summary,Issue Type,Status,Priority,Assignee,Due date,Labels\nA-1,Fix it,Bug,Done,High,Sam,,\n' }).id, 'jira')
  assert.equal(detectFlavor({ name: 'x.csv', text: 'Task ID,Created At,Completed At,Name,Section/Column,Assignee,Due Date,Tags,Notes\n' }).id, 'asana')
  assert.equal(detectFlavor({ name: 'x.csv', text: 'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE\n' }).id, 'todoist')
  assert.equal(detectFlavor({ name: 'x.csv', text: 'ID,Team,Title,Description,Status,Estimate,Priority,Assignee,Labels,Cycle Number,Cycle Name,Due Date\n' }).id, 'linear')
  assert.equal(detectFlavor({ name: 'x.csv', text: 'Task,Owner,Status\nA,Sam,open\n' }), null)
})

test('detectFlavor recognises calendar and transcript producers, and board JSON', () => {
  assert.equal(detectFlavor({ name: 'cal.ics', text: 'BEGIN:VCALENDAR\nPRODID:-//Google Inc//Google Calendar 70.9054//EN\n' }).id, 'google-calendar')
  assert.equal(detectFlavor({ name: 'cal.ics', text: 'BEGIN:VCALENDAR\nPRODID:Microsoft Exchange Server 2010\n' }).id, 'outlook')
  assert.equal(detectFlavor({ name: 'cal.ics', text: 'BEGIN:VCALENDAR\nPRODID:-//Apple Inc.//macOS 14.0//EN\n' }).id, 'apple-calendar')
  assert.equal(detectFlavor({ name: 'cal.ics', text: 'BEGIN:VCALENDAR\nPRODID:-//Someone//EN\n' }), null)
  assert.equal(detectFlavor({ name: 'meeting.vtt', text: 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n<v Sam Ojo>Hello from Microsoft Teams</v>\n' }).id, 'teams')
  assert.equal(detectFlavor({ name: 'board.json', text: '{"name":"Atlas","idBoard":"1","cards":[{"idList":"l1"}],"lists":[]}' }).id, 'trello')
  assert.equal(detectFlavor({ name: 'issues.json', text: '[{"number":1,"title":"Bug","html_url":"https://github.com/x/y/issues/1","labels":[]}]' }).id, 'github')
  assert.equal(detectFlavor({ name: 'data.json', text: '[{"a":1}]' }), null)
})

test('a Todoist export keeps only task rows, maps priority 4 to urgent and DATE to the due date', () => {
  const text = [
    'TYPE,CONTENT,DESCRIPTION,PRIORITY,INDENT,AUTHOR,RESPONSIBLE,DATE,DATE_LANG,TIMEZONE',
    'section,Launch,,,,,,,,',
    'task,Write the brief,Some detail,4,1,Sam (1),Priya (2),2026-10-02,en,UTC',
    'note,A comment,,,,,,,,',
    'task,Order stickers,,1,1,Sam (1),,2026-10-09,en,UTC',
  ].join('\n')
  const flavor = detectFlavor({ name: 'todoist.csv', text })
  const table = applyFlavor(toTable(parseDelimited(text)), flavor)
  assert.equal(table.rows.length, 2)
  assert.ok(table.headers.includes('Title') && table.headers.includes('Due date') && table.headers.includes('Owner'))
  const tasks = entitiesFromTable(table, source).filter((e) => e.type === 'task')
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].title, 'Write the brief')
  assert.equal(tasks[0].priority, 2)
  assert.equal(dayKey(tasks[0].due), '2026-10-02')
  assert.deepEqual(tasks[0].people, ['Priya'])
  assert.equal(tasks[1].priority, 0)
})

test('an Asana export gets a status from its Completed At column and a section tag', () => {
  const text = [
    'Task ID,Created At,Completed At,Last Modified,Name,Section/Column,Assignee,Assignee Email,Start Date,Due Date,Tags,Notes,Projects',
    '1,2026-09-01,2026-09-03,2026-09-03,Ship it,Done,Sam Ojo,sam@x.com,,2026-09-05,,notes here,Atlas',
    '2,2026-09-01,,2026-09-02,Write docs,In progress,Priya Raman,priya@x.com,,2026-09-12,docs,,Atlas',
  ].join('\n')
  const table = applyFlavor(toTable(parseDelimited(text)), detectFlavor({ name: 'asana.csv', text }))
  const tasks = entitiesFromTable(table, source).filter((e) => e.type === 'task')
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].status, 'done')
  assert.equal(tasks[1].status, 'open')
  assert.ok(tasks[1].tags.includes('in-progress'))
  assert.deepEqual(tasks[1].people, ['Priya Raman'])
})

test('a Jira export reads Summary as the title, Issue Type as a tag and Highest as urgent', () => {
  const text = [
    'Issue key,Summary,Issue Type,Status,Priority,Assignee,Reporter,Due date,Labels,Sprint',
    'AT-12,Rollback script,Bug,In Progress,Highest,Priya Raman,Sam Ojo,2026-09-20,infra,Sprint 4',
  ].join('\n')
  const table = applyFlavor(toTable(parseDelimited(text)), detectFlavor({ name: 'jira.csv', text }))
  const [task] = entitiesFromTable(table, source).filter((e) => e.type === 'task')
  assert.equal(task.title, 'Rollback script')
  assert.equal(task.status, 'doing')
  assert.equal(task.priority, 2)
  assert.deepEqual(task.people, ['Priya Raman'])
  assert.ok(task.tags.includes('bug'))
})

test('a Trello board becomes one task per card, with list names as status when they read like one', () => {
  const board = {
    name: 'Atlas',
    lists: [{ id: 'l1', name: 'To Do' }, { id: 'l2', name: 'Doing' }, { id: 'l3', name: 'Done' }],
    members: [{ id: 'm1', fullName: 'Sam Ojo' }],
    cards: [
      { name: 'Write brief', idList: 'l1', idMembers: ['m1'], labels: [{ name: 'launch' }], due: '2026-10-01T17:00:00.000Z', desc: 'x', closed: false },
      { name: 'Ship', idList: 'l3', idMembers: [], labels: [], due: null, desc: '', closed: false },
      { name: 'Archived', idList: 'l1', idMembers: [], labels: [], due: null, desc: '', closed: true },
    ],
  }
  assert.equal(looksLikeTrello(board), true)
  const tasks = entitiesFromTable(trelloToTable(board), source).filter((e) => e.type === 'task')
  assert.equal(tasks.length, 3)
  assert.equal(tasks[0].status, 'open')
  assert.deepEqual(tasks[0].people, ['Sam Ojo'])
  assert.ok(tasks[0].tags.includes('launch') && tasks[0].tags.includes('to-do'))
  assert.equal(tasks[1].status, 'done')
  assert.equal(tasks[2].status, 'done')
  const parser = listParsers().find((p) => p.id === 'json')
  const viaParser = parser.parse({ name: 'board.json', text: JSON.stringify(board), docId: 'd2', kind: 'json' })
  assert.equal(viaParser.filter((e) => e.type === 'task').length, 3)
})

test('GitHub issues JSON maps assignees and labels from objects and keeps the issue number', () => {
  const issues = [
    { number: 7, title: 'Crash on import', state: 'open', html_url: 'https://github.com/x/y/issues/7', assignees: [{ login: 'priya' }], labels: [{ name: 'bug' }], created_at: '2026-09-01T10:00:00Z', milestone: { title: 'v1', due_on: '2026-10-01T00:00:00Z' }, body: 'Steps' },
    { number: 8, title: 'Old one', state: 'closed', html_url: 'https://github.com/x/y/issues/8', assignees: [], labels: [], created_at: '2026-08-01T10:00:00Z' },
  ]
  assert.equal(looksLikeGithubIssues(issues), true)
  const tasks = entitiesFromTable(githubToTable(issues), source).filter((e) => e.type === 'task')
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].title, '#7 Crash on import')
  assert.deepEqual(tasks[0].people, ['Priya'])
  assert.ok(tasks[0].tags.includes('bug') && tasks[0].tags.includes('v1'))
  assert.equal(dayKey(tasks[0].due), '2026-10-01')
  assert.equal(tasks[1].status, 'done')
})
