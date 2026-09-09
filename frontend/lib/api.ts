import 'server-only'

import type { AuditLog, AuditVerification, DailyBrief, FinanceSummary, Page, ProjectPipeline, Task } from './types'

/**
 * Server-side client for the platform API.
 *
 * Runs only in server components and route handlers: the API key comes from
 * the pod's environment and never reaches the browser. Every call is
 * `no-store` because a dashboard that shows yesterday's numbers is worse
 * than one that is slow.
 */

const BASE = (process.env.BACKEND_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
const KEY = process.env.BACKEND_API_KEY ?? ''

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
      ...(KEY ? { 'x-api-key': KEY } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // no JSON body
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Read everything the workspace needs, in parallel, tolerating a missing brief. */
export async function loadWorkspace(context: 'work' | 'personal' | 'all') {
  const ctx = context === 'all' ? '' : `?context=${context}`
  const [pipeline, checklist, audit, verification, finance, brief] = await Promise.all([
    call<ProjectPipeline[]>(`/projects/pipeline${ctx}`),
    call<Task[]>(`/tasks/today${ctx}`),
    call<Page<AuditLog>>('/ai-audit-logs?limit=40'),
    call<AuditVerification>('/ai-audit-logs/verify'),
    call<FinanceSummary>('/finance/summary'),
    call<DailyBrief>('/daily/latest').catch((e: unknown) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  ])
  return { pipeline, checklist, audit: audit.items, verification, finance, brief }
}

export const toggleTask = (id: string) => call<Task>(`/tasks/${encodeURIComponent(id)}/toggle`, { method: 'POST' })

export const createTask = (body: { title: string; context: 'work' | 'personal'; priority: 'P1' | 'P2' | 'P3'; due_date: string }) =>
  call<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) })

export const runDaily = () => call<{ status: string; brief_date: string }>('/daily/run?sync=true', { method: 'POST' })
