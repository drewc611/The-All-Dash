import { z } from 'zod'

import { slim } from './adapters/workspace.js'

/**
 * Tool, resource and prompt registration.
 *
 * Names are prefixed by source: `workspace_*` reads and writes the browser
 * app's export, `platform_*` talks to the API. `search` and `fetch` span
 * both and follow the shape ChatGPT connectors require, so the same server
 * serves Claude, Copilot and ChatGPT without a mode switch.
 */

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const fail = (message) => ({ isError: true, content: [{ type: 'text', text: message }] })

const guard = (fn) => async (args, extra) => {
  try {
    return await fn(args, extra)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}

const Severity = z.enum(['critical', 'serious', 'warning', 'info'])
const Context = z.enum(['work', 'personal'])
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')

export function registerAll(server, { workspace, platform, publicUrl = '' }) {
  const link = (kind, id) => (publicUrl ? `${publicUrl.replace(/\/+$/, '')}/${kind}/${id}` : `alldash://${kind}/${id}`)

  // ---------------------------------------------------------- search / fetch

  server.registerTool(
    'search',
    {
      title: 'Search everything',
      description:
        'Full-text search across the workspace export (tasks, events, notes, decisions, risks, metrics, documents) and the platform (projects, tasks, invoices, expenses). Returns ids for fetch and the specific tools.',
      inputSchema: { query: z.string().min(1).describe('Words to match; all must appear') },
    },
    guard(async ({ query }) => {
      const results = []
      if (workspace) {
        for (const e of await workspace.search(query, { limit: 15 })) {
          results.push({ id: `ws:${e.id}`, title: `${e.title} (${e.type})`, url: link('workspace', e.id) })
        }
      }
      if (platform) {
        for (const r of await platform.search(query, { limit: 15 })) {
          results.push({ id: `pf:${r.id}`, title: `${r.title} (${r.kind})`, url: link(r.kind, r.id) })
        }
      }
      return text({ results })
    })
  )

  server.registerTool(
    'fetch',
    {
      title: 'Fetch one item',
      description: 'The full record for an id returned by search (ws:… for the workspace, pf:… for the platform).',
      inputSchema: { id: z.string().min(1) },
    },
    guard(async ({ id }) => {
      const [prefix, ...rest] = id.split(':')
      const key = rest.join(':')
      if (prefix === 'ws' && workspace) {
        const e = await workspace.get(key)
        if (!e) return fail(`No workspace item ${key}`)
        const body = [e.body, e.people.length ? `People: ${e.people.join(', ')}` : '', e.tags.length ? `Tags: ${e.tags.join(', ')}` : '', e.due ? `Due: ${e.due}` : '', e.at ? `At: ${e.at}` : '', e.source?.name ? `From: ${e.source.name}` : '']
          .filter(Boolean)
          .join('\n')
        return text({ id, title: e.title, text: body || e.title, url: link('workspace', e.id), metadata: slim(e) })
      }
      if (prefix === 'pf' && platform) {
        const found = await platform.get(key)
        if (!found) return fail(`No platform record ${key}`)
        const r = found.record
        return text({ id, title: r.title || r.name || r.number || r.decision || key, text: JSON.stringify(r, null, 2), url: link(found.kind, key), metadata: { kind: found.kind } })
      }
      return fail(`Unknown id ${id}: expected ws:<id> or pf:<id>`)
    })
  )

  // -------------------------------------------------------------- workspace

  if (workspace) {
    server.registerTool(
      'workspace_overview',
      { title: 'Workspace overview', description: 'Counts, open and overdue tasks, meetings today, triage totals, insight rules and the top metrics from the workspace export.', inputSchema: {} },
      guard(async () => text(await workspace.overview()))
    )
    server.registerTool(
      'workspace_triage',
      {
        title: 'Workspace triage',
        description: 'What is wrong right now, most urgent first: overdue, due soon, blocked, stalled, slipping milestones, stale risks, unowned urgent work, clashing meetings, aging questions, metrics off target. Same rules as the Triage view.',
        inputSchema: { severity: Severity.optional().describe('Only this severity') },
      },
      guard(async ({ severity }) => text(await workspace.triage(severity)))
    )
    server.registerTool(
      'workspace_status_update',
      { title: 'Status update', description: 'The Markdown status update the app writes: done, in progress, blocked, overdue, decisions, numbers that moved, next 7 days.', inputSchema: {} },
      guard(async () => text(await workspace.statusUpdate()))
    )
    server.registerTool(
      'workspace_search',
      {
        title: 'Search the workspace',
        description: 'Entities matching the words, optionally of one type.',
        inputSchema: { query: z.string().min(1), type: z.enum(['task', 'event', 'note', 'metric', 'milestone', 'risk', 'decision', 'doc']).optional(), limit: z.number().int().min(1).max(100).optional() },
      },
      guard(async ({ query, type, limit }) => text(await workspace.search(query, { type, limit })))
    )
    server.registerTool(
      'workspace_add_task',
      {
        title: 'Add a task to the workspace',
        description: 'Appends an open task to the export file. The user re-imports the file to see it in the app.',
        inputSchema: {
          title: z.string().min(1).max(400),
          due: Day.optional(),
          people: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          priority: z.number().int().min(0).max(2).optional().describe('0 normal, 1 high, 2 urgent'),
          body: z.string().max(4000).optional(),
        },
      },
      guard(async (args) => text(slim(await workspace.addTask(args))))
    )
    server.registerTool(
      'workspace_update_task',
      {
        title: 'Update a workspace task',
        description: 'Change status, priority, due date, people, tags or title of an entity in the export file.',
        inputSchema: {
          id: z.string().min(1),
          status: z.enum(['open', 'doing', 'done', 'blocked', 'cancelled']).optional(),
          priority: z.number().int().min(0).max(2).optional(),
          due: Day.nullable().optional(),
          people: z.array(z.string()).optional(),
          tags: z.array(z.string()).optional(),
          title: z.string().min(1).max(400).optional(),
        },
      },
      guard(async ({ id, ...patch }) => text(slim(await workspace.updateTask(id, patch))))
    )
    server.registerTool(
      'workspace_brain',
      {
        title: 'What the app knows about the user',
        description: 'The brain: facts, habits, people, topics and accepted opinions, learned by rules from the workspace (no model). Without a file, returns the README index and the list of files; with one, that file (profile.md, habits.md, insights.md, people/<slug>.md, topics/<slug>.md).',
        inputSchema: { file: z.string().optional() },
      },
      guard(async ({ file }) => {
        const files = await workspace.brain()
        if (!file) return text(`${files.find((f) => f.path === 'README.md').text}\nAll files: ${files.map((f) => f.path).join(', ')}`)
        const found = files.find((f) => f.path === file)
        if (!found) return fail(`No brain file ${file}. Files: ${files.map((f) => f.path).join(', ')}`)
        return text(found.text)
      })
    )
    server.registerResource(
      'workspace-brain',
      'alldash://workspace/brain',
      { title: 'The brain', description: 'What the app has learned about the user, as Markdown (rules only, no model)', mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: (await workspace.brain()).map((f) => `<!-- ${f.path} -->\n${f.text}`).join('\n\n') }] })
    )
    server.registerResource(
      'workspace-status-update',
      'alldash://workspace/status-update',
      { title: 'Status update', description: 'Markdown status update from the workspace export', mimeType: 'text/markdown' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await workspace.statusUpdate() }] })
    )
  }

  // --------------------------------------------------------------- platform

  if (platform) {
    server.registerTool(
      'platform_brief',
      { title: 'Morning brief', description: 'The daily brief: P1 items due today, past-due invoices, yesterday\'s activity, the money picture and burn rate. Latest by default.', inputSchema: { date: Day.optional() } },
      guard(async ({ date }) => text(await platform.brief(date)))
    )
    server.registerTool(
      'platform_run_daily',
      { title: 'Run the daily update engine', description: 'Builds (or rebuilds) the brief for a date now, marking overdue invoices as an audited decision.', inputSchema: { date: Day.optional() } },
      guard(async ({ date }) => text(await platform.runDaily(date)))
    )
    server.registerTool(
      'platform_pipeline',
      { title: 'Project pipelines', description: 'Every active project with its stage, task counts, open P1s, spent and invoiced.', inputSchema: { context: Context.optional() } },
      guard(async ({ context }) => text(await platform.pipeline(context)))
    )
    server.registerTool(
      'platform_tasks_today',
      { title: 'Today\'s checklist', description: 'Open tasks due today or earlier plus today\'s finished ones, P1 first.', inputSchema: { context: Context.optional(), on: Day.optional() } },
      guard(async ({ context, on }) => text(await platform.tasksToday(context, on)))
    )
    server.registerTool(
      'platform_list_tasks',
      {
        title: 'List tasks',
        description: 'Tasks with filters.',
        inputSchema: { context: Context.optional(), status: z.enum(['open', 'doing', 'done']).optional(), priority: z.enum(['P1', 'P2', 'P3']).optional(), project_id: z.string().optional(), open_only: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() },
      },
      guard(async (params) => text(await platform.tasks(params)))
    )
    server.registerTool(
      'platform_create_task',
      {
        title: 'Create a task',
        description: 'Adds a task to the platform.',
        inputSchema: { title: z.string().min(1).max(400), context: Context.default('work'), priority: z.enum(['P1', 'P2', 'P3']).default('P2'), due_date: Day.optional(), project_id: z.string().optional(), notes: z.string().max(8000).optional() },
      },
      guard(async (body) => text(await platform.createTask(body)))
    )
    server.registerTool(
      'platform_update_task',
      {
        title: 'Update a task',
        description: 'Patch title, notes, context, priority, status, due date or project of a task.',
        inputSchema: { id: z.string().min(1), title: z.string().min(1).max(400).optional(), notes: z.string().optional(), context: Context.optional(), priority: z.enum(['P1', 'P2', 'P3']).optional(), status: z.enum(['open', 'doing', 'done']).optional(), due_date: Day.nullable().optional(), project_id: z.string().nullable().optional() },
      },
      guard(async ({ id, ...body }) => text(await platform.patchTask(id, body)))
    )
    server.registerTool(
      'platform_toggle_task',
      { title: 'Toggle a task', description: 'Open ⇄ done.', inputSchema: { id: z.string().min(1) } },
      guard(async ({ id }) => text(await platform.toggleTask(id)))
    )
    server.registerTool(
      'platform_invoices',
      { title: 'Invoices', description: 'Invoices, optionally only past due or by status.', inputSchema: { status: z.enum(['draft', 'sent', 'paid', 'overdue', 'void']).optional(), past_due: z.boolean().optional(), limit: z.number().int().min(1).max(200).optional() } },
      guard(async (params) => text(await platform.invoices(params)))
    )
    server.registerTool(
      'platform_expenses',
      { title: 'Expenses', description: 'Expenses in a date range or category.', inputSchema: { since: Day.optional(), until: Day.optional(), category: z.string().optional(), limit: z.number().int().min(1).max(200).optional() } },
      guard(async (params) => text(await platform.expenses(params)))
    )
    server.registerTool(
      'platform_finance_summary',
      { title: 'Finance summary', description: 'Collected, spent, margin, burn rate with its change, outstanding and overdue for the trailing window. Amounts are integer cents.', inputSchema: { as_of: Day.optional(), window_days: z.number().int().min(7).max(365).optional() } },
      guard(async (params) => text(await platform.finance(params)))
    )
    server.registerTool(
      'platform_audit_log',
      { title: 'AI audit log', description: 'Recent entries of the hash-chained decision ledger, newest first.', inputSchema: { limit: z.number().int().min(1).max(200).optional(), action: z.string().optional(), actor: z.enum(['system', 'worker', 'user', 'assistant']).optional(), subject_id: z.string().optional() } },
      guard(async (params) => text(await platform.auditLogs(params)))
    )
    server.registerTool(
      'platform_audit_verify',
      { title: 'Verify the audit chain', description: 'Recomputes every hash; reports the first bad sequence number if any.', inputSchema: {} },
      guard(async () => text(await platform.auditVerify()))
    )
    server.registerTool(
      'platform_log_decision',
      {
        title: 'Log a decision to the ledger',
        description: 'Append a decision you made on the user\'s behalf (prioritised, deferred, closed, recommended) with a confidence score. Append-only; cannot be edited or removed.',
        inputSchema: {
          action: z.string().min(1).max(64).describe('Short snake_case verb, e.g. reprioritised_task'),
          subject_type: z.string().min(1).max(32),
          subject_id: z.string().max(64).optional(),
          decision: z.string().min(1).max(4000),
          rationale: z.string().max(8000).optional(),
          confidence: z.number().min(0).max(1),
          inputs: z.record(z.any()).optional(),
        },
      },
      guard(async (body) => text(await platform.logDecision(body)))
    )
    server.registerResource(
      'platform-brief',
      'alldash://platform/brief/latest',
      { title: 'Latest morning brief', description: 'The most recent daily brief from the platform', mimeType: 'application/json' },
      async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await platform.brief(), null, 2) }] })
    )
  }

  // ---------------------------------------------------------------- prompts

  server.registerPrompt(
    'morning-review',
    { title: 'Morning review', description: 'Five lines: late, due, blocked, money, and the one thing to do first.', argsSchema: { context: z.enum(['work', 'personal', 'all']).optional() } },
    ({ context }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Review my ${context && context !== 'all' ? context : ''} day.`.replace('  ', ' '),
              platform ? 'Call platform_brief, platform_tasks_today and platform_finance_summary.' : '',
              workspace ? 'Call workspace_overview and workspace_triage (severity serious, then warning).' : '',
              'Then answer in five short lines: what is late, what is due today, what is blocked, the money in one sentence, and the single thing to do first. Cite items by title.',
              platform ? 'Record the "do first" choice with platform_log_decision (action recommended_first_task, confidence between 0 and 1).' : '',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        },
      ],
    })
  )

  server.registerPrompt(
    'explain-signal',
    { title: 'Explain a triage signal', description: 'Why an item is flagged and the smallest useful action.', argsSchema: { title: z.string().describe('The flagged item\'s title') } },
    ({ title }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use search and workspace_triage to find "${title}". Explain in three sentences why it is flagged, what happens if nothing is done this week, and the smallest action that clears it. Offer to apply it with workspace_update_task.`,
          },
        },
      ],
    })
  )
}
