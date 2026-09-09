export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)
}

export function moneyExact(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
}

export function day(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ago(iso: string, now: Date = new Date()): string {
  const delta = now.getTime() - new Date(iso).getTime()
  const minutes = Math.round(delta / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function todayIso(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const STAGE_LABEL: Record<string, string> = {
  idea: 'Idea',
  planning: 'Planning',
  in_progress: 'In progress',
  review: 'Review',
  done: 'Done',
}

export const ACTION_LABEL: Record<string, string> = {
  daily_brief_built: 'Brief built',
  invoice_marked_overdue: 'Invoice overdue',
  burn_rate_computed: 'Burn rate',
  proposal: 'Proposal',
}
