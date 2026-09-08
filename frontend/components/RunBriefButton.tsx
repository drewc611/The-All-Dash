'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/** Runs the daily update engine now, the same call the 4 AM CronJob makes. */
export function RunBriefButton() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    setError(null)
    start(async () => {
      const res = await fetch('/api/daily', { method: 'POST' })
      if (!res.ok) {
        setError(`Failed (${res.status})`)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" className="btn" onClick={run} disabled={pending}>
        {pending ? 'Building…' : 'Rebuild the brief'}
      </button>
      {error && <span className="text-[11px] text-critical">{error}</span>}
    </div>
  )
}
