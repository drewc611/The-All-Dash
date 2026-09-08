import type { AuditLog, AuditVerification } from '@/lib/types'
import { ACTION_LABEL, ago } from '@/lib/format'

/** Right column: the ledger, newest first, with the chain's verification state on top. */
export function AuditStream({ entries, verification }: { entries: AuditLog[]; verification: AuditVerification }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">AI audit log</h2>
        <span
          className={`chip ml-auto border-transparent ${verification.ok ? 'bg-good-soft text-good' : 'bg-critical-soft text-critical'}`}
          title={verification.ok ? `${verification.checked} entries, every hash matches` : `Chain broken at seq ${verification.first_bad_seq}`}
        >
          {verification.ok ? `Chain intact · ${verification.checked}` : `Tampered at #${verification.first_bad_seq}`}
        </span>
      </div>
      {!entries.length ? (
        <p className="px-4 py-8 text-center text-ink-muted">No decisions logged yet. Build the brief to see the first one.</p>
      ) : (
        <ol className="divide-y divide-line">
          {entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 px-4 py-3">
              <ConfidenceBadge value={entry.confidence} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                  <span className="chip">{ACTION_LABEL[entry.action] ?? entry.action.replace(/_/g, ' ')}</span>
                  <span>{entry.actor}</span>
                  <span>· {ago(entry.created_at)}</span>
                  <span className="ml-auto font-mono">#{entry.seq}</span>
                </div>
                <div className="mt-1 font-medium leading-snug">{entry.decision}</div>
                {entry.rationale && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-2">{entry.rationale}</div>}
                <div className="mt-1 truncate font-mono text-[10px] text-ink-muted" title={entry.hash}>
                  {entry.hash.slice(0, 16)}… ← {entry.prev_hash.slice(0, 8)}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Confidence as a ring with the percentage inside, coloured by band. */
export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 85 ? 'text-good' : pct >= 60 ? 'text-warning' : 'text-critical'
  const r = 14
  const c = 2 * Math.PI * r
  return (
    <span className="relative grid h-9 w-9 flex-none place-items-center" title={`Confidence ${pct}%`} aria-label={`Confidence ${pct}%`}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="3" className="text-surface-sunken" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          className={tone}
        />
      </svg>
      <span className="relative text-[10px] font-semibold tabular-nums">{pct}</span>
    </span>
  )
}
