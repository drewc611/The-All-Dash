import Link from 'next/link'

import type { DailyBrief } from '@/lib/types'
import { ago } from '@/lib/format'
import { RunBriefButton } from './RunBriefButton'

const TABS: Array<{ id: 'all' | 'work' | 'personal'; label: string }> = [
  { id: 'all', label: 'Everything' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
]

export function Header({ context, brief }: { context: 'all' | 'work' | 'personal'; brief: DailyBrief | null }) {
  return (
    <header className="card flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-[12px] font-bold text-white">AD</span>
        <div>
          <h1 className="text-[15px] font-semibold tracking-tight">Workspace</h1>
          <p className="text-[11px] text-ink-muted">
            {brief ? `Brief built ${ago(brief.generated_at)} by ${brief.triggered_by}` : 'No brief built yet'}
          </p>
        </div>
      </div>
      <nav className="flex rounded-md border border-line bg-surface-sunken p-0.5" aria-label="Context">
        {TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.id === 'all' ? '/' : `/?context=${tab.id}`}
            aria-current={context === tab.id ? 'page' : undefined}
            className={`h-6 rounded px-3 text-[12px] font-medium leading-6 transition ${
              context === tab.id ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="md:ml-auto">
        <RunBriefButton />
      </div>
      {brief && (
        <p className="basis-full text-[12px] leading-relaxed text-ink-2 md:mt-1">{brief.summary}</p>
      )}
    </header>
  )
}
