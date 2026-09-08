import type { FinanceSummary } from '@/lib/types'
import { money, moneyExact } from '@/lib/format'

/** Floating summary ribbon: the money picture for the trailing window, always on screen. */
export function MarginRibbon({ finance }: { finance: FinanceSummary }) {
  const margin = finance.margin_pct
  const marginTone = margin === null ? 'text-ink-muted' : margin >= 30 ? 'text-good' : margin >= 0 ? 'text-warning' : 'text-critical'
  const burnChange = finance.burn.change_pct
  return (
    <aside
      className="fixed inset-x-3 bottom-3 z-30 mx-auto flex max-w-[1200px] flex-nowrap items-center gap-x-6 overflow-x-auto rounded-2xl border border-line bg-surface/95 px-4 py-2.5 shadow-ribbon backdrop-blur md:inset-x-6 md:bottom-4 md:flex-wrap md:gap-y-2 md:px-5 md:py-3"
      aria-label="Financial summary"
    >
      <Stat label={`Collected · ${finance.burn.window_days}d`} value={money(finance.collected_cents, finance.currency)} />
      <Stat label="Spent" value={money(finance.expenses_cents, finance.currency)} />
      <Stat
        label="Margin"
        value={margin === null ? money(finance.margin_cents, finance.currency) : `${margin.toFixed(1)}%`}
        sub={margin === null ? 'nothing collected yet' : money(finance.margin_cents, finance.currency)}
        tone={marginTone}
      />
      <Stat
        label="Burn / day"
        value={moneyExact(finance.burn.daily_cents, finance.currency)}
        sub={burnChange === null ? undefined : `${burnChange > 0 ? '+' : ''}${burnChange.toFixed(1)}% vs prior window`}
        tone={burnChange === null ? undefined : burnChange > 5 ? 'text-critical' : burnChange < -5 ? 'text-good' : undefined}
      />
      <Stat label="Outstanding" value={money(finance.outstanding_cents, finance.currency)} />
      {finance.overdue_count > 0 && (
        <Stat
          label="Overdue"
          value={money(finance.overdue_cents, finance.currency)}
          sub={`${finance.overdue_count} invoice${finance.overdue_count === 1 ? '' : 's'}`}
          tone="text-critical"
        />
      )}
    </aside>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="flex min-w-[96px] flex-none flex-col">
      <span className="label">{label}</span>
      <span className={`text-lg font-semibold leading-tight tabular-nums tracking-tight ${tone ?? ''}`}>{value}</span>
      {sub && <span className="text-[11px] text-ink-muted">{sub}</span>}
    </div>
  )
}
