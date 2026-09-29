'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { ago } from '@/lib/format'
import type { Proposal } from '@/lib/types'

/**
 * The morning queue: what the worker suggested overnight, each one waiting on
 * you.
 *
 * There is no "apply all" and no setting that adds one, and that is the whole
 * design. The products that run a company unattended all have the switch, and
 * a review queue with an approve-everything button is a queue nobody reads, at
 * which point the one proposal that mattered goes through with the rest.
 *
 * Nothing here is optimistic. An optimistic tick would show a change landing
 * before the task has been read back, which is exactly the "did it actually
 * work?" gap this exists to close. The row changes when the API says what the
 * task reads now, and the words say which of the outcomes it was.
 *
 * A row that can no longer apply says so before the button is pressed, using
 * the API's per-request `blocked_because` rather than a stored flag: whether a
 * proposal still applies is a fact about the task now, not about when the
 * proposal was written.
 */

const STATUS_WORDS: Record<string, string> = { open: 'Open', doing: 'Doing', done: 'Done' }

const show = (field: Proposal['field'], value: string) => (field === 'status' ? (STATUS_WORDS[value] ?? value) : value)

/** What happened, in words, once a decision has come back. */
function outcome(p: Proposal): string {
  switch (p.state) {
    case 'applied':
      // `observed` is what the task read back as, not what was sent.
      return `Applied. The task now reads ${show(p.field, p.observed)}.`
    case 'declined':
      return 'Declined. It will not be proposed again.'
    case 'stale':
      // On an expired proposal the API stores the reason where it would
      // otherwise store the value.
      return `Not applied: ${p.observed || 'the task changed'}.`
    case 'failed':
      return `Did not take. The task reads ${show(p.field, p.observed)}.`
    default:
      return ''
  }
}

export function Proposals({ initial }: { initial: Proposal[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Proposal[]>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const waiting = rows.filter((r) => r.state === 'proposed')
  const decided = rows.filter((r) => r.state !== 'proposed')
  if (!rows.length) return null

  const decide = async (row: Proposal, how: 'apply' | 'decline') => {
    setBusy(row.id)
    setError(null)
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(row.id)}/${how}`, { method: 'POST' })
      if (!res.ok) {
        setError(`Could not ${how} "${row.task_title}" (${res.status})`)
        return
      }
      const next = (await res.json()) as Proposal
      setRows((list) => list.map((r) => (r.id === next.id ? next : r)))
      // The checklist is server-rendered, so it still shows the old value.
      if (next.state === 'applied') startTransition(() => router.refresh())
    } catch {
      setError(`Could not ${how} "${row.task_title}": the API is not reachable`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="card" aria-label="Proposed changes">
      <div className="card-head">
        <h2 className="card-title">Proposed changes</h2>
        <span className="text-[11px] text-ink-muted">
          {waiting.length ? `${waiting.length} waiting on you · nothing applied` : 'Nothing waiting'}
        </span>
      </div>

      <ul className="divide-y divide-line">
        {waiting.map((row) => {
          const because = row.blocked_because
          const label = `${row.field} of "${row.task_title}" from ${show(row.field, row.from_value)} to ${show(row.field, row.to_value)}`
          const note = `note-${row.id}`
          return (
            <li key={row.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-medium leading-snug">{row.task_title}</span>
                <span className="flex-none text-[11px] text-ink-muted">{ago(row.created_at)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="chip">{show(row.field, row.from_value)}</span>
                <span aria-hidden="true">→</span>
                <span className="chip bg-accent-soft text-accent border-transparent">{show(row.field, row.to_value)}</span>
                <span className="text-ink-muted">{row.reason}</span>
              </div>
              {because && (
                // Said before the button is pressed, not discovered after it.
                <p id={note} role="status" className="text-[11px] text-critical">
                  Cannot apply: {because}.
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy === row.id || Boolean(because)}
                  aria-describedby={because ? note : undefined}
                  aria-label={`Apply: ${label}`}
                  onClick={() => decide(row, 'apply')}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy === row.id}
                  aria-label={`Decline: ${label}`}
                  onClick={() => decide(row, 'decline')}
                >
                  Decline
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      {decided.length > 0 && (
        <ul className="divide-y divide-line border-t border-line" aria-label="Decided this visit">
          {decided.map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 px-4 py-2 text-[11px] text-ink-muted">
              <span className="font-medium text-ink-2">{row.task_title}</span>
              <span role="status">{outcome(row)}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="px-4 pb-3 text-[11px] text-critical">{error}</p>}
    </section>
  )
}
