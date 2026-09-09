'use client'

import { useMemo, useOptimistic, useState, useTransition } from 'react'

import type { Task, TaskPriority } from '@/lib/types'
import { day, todayIso } from '@/lib/format'

/**
 * Centre column: the checklist. Toggling is optimistic, so a tick lands
 * instantly and rolls back only if the API says no. New tasks are added
 * from the box at the bottom and default to today.
 */

const PRIORITY: Record<TaskPriority, { label: string; className: string; dot: string }> = {
  P1: { label: 'P1', className: 'bg-critical-soft text-critical border-transparent', dot: 'bg-critical' },
  P2: { label: 'P2', className: 'bg-warning-soft text-ink-2 border-transparent', dot: 'bg-warning' },
  P3: { label: 'P3', className: 'bg-surface-sunken text-ink-muted', dot: 'bg-ink-muted' },
}

type Filter = 'all' | TaskPriority

export function DailyTasks({ initial, context }: { initial: Task[]; context: 'all' | 'work' | 'personal' }) {
  const [tasks, setTasks] = useState<Task[]>(initial)
  const [optimistic, applyOptimistic] = useOptimistic(tasks, (state: Task[], patch: { id: string; status: Task['status'] }) =>
    state.map((t) => (t.id === patch.id ? { ...t, status: patch.status } : t)),
  )
  const [pending, start] = useTransition()
  const [filter, setFilter] = useState<Filter>('all')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('P2')
  const [error, setError] = useState<string | null>(null)

  const shown = useMemo(() => optimistic.filter((t) => filter === 'all' || t.priority === filter), [optimistic, filter])
  const open = optimistic.filter((t) => t.status !== 'done').length
  const today = todayIso()

  const toggle = (task: Task) => {
    const next = task.status === 'done' ? 'open' : 'done'
    start(async () => {
      applyOptimistic({ id: task.id, status: next })
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/toggle`, { method: 'POST' })
      if (!res.ok) {
        setError(`Could not update "${task.title}" (${res.status})`)
        return
      }
      const updated = (await res.json()) as Task
      setTasks((list) => list.map((t) => (t.id === updated.id ? updated : t)))
    })
  }

  const add = (event: React.FormEvent) => {
    event.preventDefault()
    const text = title.trim()
    if (!text) return
    start(async () => {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: text, priority, context: context === 'all' ? 'personal' : context, due_date: today }),
      })
      if (!res.ok) {
        setError(`Could not add the task (${res.status})`)
        return
      }
      const created = (await res.json()) as Task
      setTasks((list) => [created, ...list])
      setTitle('')
      setError(null)
    })
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Today</h2>
        <span className="text-[11px] text-ink-muted">
          {open} open · {optimistic.length - open} done
        </span>
        <div className="ml-auto flex rounded-md border border-line bg-surface-sunken p-0.5" role="group" aria-label="Priority filter">
          {(['all', 'P1', 'P2', 'P3'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`h-6 rounded px-2 text-[11px] font-medium transition ${
                filter === f ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {f === 'all' ? 'All' : f}
            </button>
          ))}
        </div>
      </div>

      {!shown.length ? (
        <p className="px-4 py-8 text-center text-ink-muted">Nothing due. Add something below or enjoy it.</p>
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((task) => {
            const done = task.status === 'done'
            const overdue = !done && task.due_date !== null && task.due_date < today
            const p = PRIORITY[task.priority]
            return (
              <li key={task.id} className={`flex items-start gap-3 px-4 py-3 ${done ? 'opacity-60' : ''}`}>
                <button
                  type="button"
                  onClick={() => toggle(task)}
                  aria-label={`Mark "${task.title}" ${done ? 'open' : 'done'}`}
                  className={`mt-0.5 grid h-[18px] w-[18px] flex-none place-items-center rounded-[5px] border-[1.5px] transition ${
                    done ? 'border-accent bg-accent text-white' : 'border-line-strong hover:border-accent'
                  }`}
                >
                  {done && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m3.5 8.5 3 3 6-7" />
                    </svg>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`font-medium leading-snug ${done ? 'line-through' : ''}`}>{task.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                    <span className={`chip ${p.className}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
                      {p.label}
                    </span>
                    <span className="chip">{task.context}</span>
                    {task.due_date && (
                      <span className={overdue ? 'font-semibold text-critical' : ''}>
                        {overdue ? 'Overdue ' : 'Due '}
                        {day(task.due_date)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={add} className="flex flex-col gap-2 border-t border-line px-4 py-3 sm:flex-row">
        <input
          className="input"
          placeholder={`Add a ${context === 'all' ? 'personal' : context} task for today`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New task"
        />
        <select className="input sm:w-20" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} aria-label="Priority">
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
        <button type="submit" className="btn btn-primary" disabled={pending || !title.trim()}>
          Add
        </button>
      </form>
      {error && <p className="px-4 pb-3 text-[11px] text-critical">{error}</p>}
    </div>
  )
}
