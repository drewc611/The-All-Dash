import { ApiError, loadWorkspace } from '@/lib/api'
import { AuditStream } from '@/components/AuditStream'
import { DailyTasks } from '@/components/DailyTasks'
import { Header } from '@/components/Header'
import { MarginRibbon } from '@/components/MarginRibbon'
import { ProjectPipelines } from '@/components/ProjectPipelines'

export const dynamic = 'force-dynamic'

type Ctx = 'work' | 'personal' | 'all'

const pickContext = (raw: string | string[] | undefined): Ctx =>
  raw === 'work' || raw === 'personal' ? raw : 'all'

export default async function Workspace({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const context = pickContext(searchParams['context'])
  try {
    const data = await loadWorkspace(context)
    return (
      <main className="mx-auto flex min-h-dvh max-w-[1600px] flex-col gap-4 px-4 pb-32 pt-4 md:px-6">
        <Header context={context} brief={data.brief} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <section className="lg:col-span-3" aria-label="Project pipelines">
            <ProjectPipelines rows={data.pipeline} />
          </section>
          <section className="lg:col-span-5" aria-label="Daily tasks">
            <DailyTasks initial={data.checklist} context={context} />
          </section>
          <section className="lg:col-span-4" aria-label="AI audit log">
            <AuditStream entries={data.audit} verification={data.verification} />
          </section>
        </div>
        <MarginRibbon finance={data.finance} />
      </main>
    )
  } catch (error) {
    const message = error instanceof ApiError ? `The API answered ${error.status}: ${error.message}` : 'The API is not reachable.'
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 px-6">
        <h1 className="text-xl font-semibold tracking-tight">Workspace unavailable</h1>
        <p className="text-ink-2">{message}</p>
        <p className="text-ink-muted">
          Check <code className="font-mono">BACKEND_URL</code> and <code className="font-mono">BACKEND_API_KEY</code> on the frontend, and that the
          backend&apos;s <code className="font-mono">/readyz</code> reports ok.
        </p>
      </main>
    )
  }
}
