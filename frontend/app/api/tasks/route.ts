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
  const priority = typeof body.priority === 'string' && PRIORITIES.has(body.priority) ? body.priority : 'P2'
  const context = typeof body.context === 'string' && CONTEXTS.has(body.context) ? body.context : 'personal'
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
