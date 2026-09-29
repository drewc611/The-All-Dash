import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { API_KEY, API_URL, BACKEND_DIR, BACKEND_ENV, FRONTEND_DIR, PYTHON } from './env'

/**
 * Driving the backend from the side, for arranging a test and for checking what
 * the UI claims. The UI is what is under test; the API is the ground truth it
 * is compared against, which is why an assertion like "the checklist followed
 * the apply" is checked against the server and not only against the page.
 */

type Json = Record<string, unknown>

export async function api<T = Json>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

export interface TaskRow {
  id: string
  title: string
  priority: 'P1' | 'P2' | 'P3'
  status: 'open' | 'doing' | 'done'
  context: 'work' | 'personal'
  due_date: string | null
}

export interface ProposalRow {
  id: string
  task_id: string
  task_title: string
  field: string
  from_value: string
  to_value: string
  state: string
  observed: string
  blocked_because: string | null
}

/** A calendar day `offset` days from today, as the API takes it. */
export function day(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const tasks = async () => (await api<{ items: TaskRow[] }>('GET', '/tasks?limit=200')).items
export const proposals = async (state?: string) =>
  (await api<{ items: ProposalRow[] }>('GET', `/proposals?limit=200${state ? `&state=${state}` : ''}`)).items
export const taskByTitle = async (title: string) => {
  const found = (await tasks()).find((t) => t.title === title)
  if (!found) throw new Error(`no task called "${title}"`)
  return found
}

/**
 * Every task gone, and its proposals with it (they cascade). The audit ledger is
 * append-only by design and is left alone, so specs that look at it compare
 * against what was there before rather than expecting it empty.
 */
export async function reset(): Promise<void> {
  for (const t of await tasks()) await api('DELETE', `/tasks/${t.id}`)
}

export async function addTask(over: Partial<TaskRow> & { title: string }): Promise<TaskRow> {
  return api<TaskRow>('POST', '/tasks', { context: 'work', priority: 'P2', status: 'open', ...over })
}

/** The scenario the queue specs share: three tasks, all past their date and not started. */
export const LATE = {
  cert: 'Renew the staging certificate',
  key: 'Rotate the signing key',
  faq: 'Write the migration FAQ',
} as const

export async function seedLate(): Promise<void> {
  await addTask({ title: LATE.cert, priority: 'P3', due_date: day(-11) })
  await addTask({ title: LATE.key, priority: 'P3', due_date: day(-5) })
  await addTask({ title: LATE.faq, priority: 'P3', due_date: day(-3) })
}

/**
 * The worker's scan, run the way beat runs it. There is no API to ask for one
 * because nothing but the schedule should be filing proposals, so the test
 * stands in for the schedule by calling the same function on the same database.
 */
export function scan(): Array<{ rule: string; field: string; to: string }> {
  const out = spawnSync(PYTHON, [join(FRONTEND_DIR, 'e2e', 'support', 'scan.py')], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...BACKEND_ENV, PYTHONPATH: BACKEND_DIR },
  })
  if (out.status !== 0) throw new Error(`the worker scan failed:\n${out.stderr}`)
  return JSON.parse(out.stdout.trim().split('\n').pop() ?? '[]')
}
