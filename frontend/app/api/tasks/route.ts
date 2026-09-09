import { NextResponse } from 'next/server'

import { ApiError, createTask } from '@/lib/api'

export const dynamic = 'force-dynamic'

const PRIORITIES = new Set(['P1', 'P2', 'P3'])
const CONTEXTS = new Set(['work', 'personal'])

export async function POST(request: Request) {
  let body: { title?: unknown; priority?: unknown; context?: unknown; due_date?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ detail: 'Body must be JSON' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  // A field that is present but invalid is an error, not a silent default.
  if (body.priority !== undefined && !(typeof body.priority === 'string' && PRIORITIES.has(body.priority))) {
    return NextResponse.json({ detail: 'priority must be P1, P2 or P3' }, { status: 422 })
  }
  if (body.context !== undefined && !(typeof body.context === 'string' && CONTEXTS.has(body.context))) {
    return NextResponse.json({ detail: 'context must be work or personal' }, { status: 422 })
  }
  const priority = (body.priority as string | undefined) ?? 'P2'
  const context = (body.context as string | undefined) ?? 'personal'
  const due = typeof body.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.due_date) ? body.due_date : null
  if (!title || !due) return NextResponse.json({ detail: 'title and due_date are required' }, { status: 422 })
  try {
    const created = await createTask({
      title,
      priority: priority as 'P1' | 'P2' | 'P3',
      context: context as 'work' | 'personal',
      due_date: due,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'failed' }, { status })
  }
}
