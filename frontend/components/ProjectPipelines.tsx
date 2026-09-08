import type { ProjectPipeline, ProjectStage } from '@/lib/types'
import { STAGE_LABEL, day, money } from '@/lib/format'

const STAGES: ProjectStage[] = ['idea', 'planning', 'in_progress', 'review', 'done']

/** Left column: every active project as a stage track with its counts and money. */
export function ProjectPipelines({ rows }: { rows: ProjectPipeline[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Project pipelines</h2>
        <span className="ml-auto text-[11px] text-ink-muted">{rows.length} active</span>
      </div>
      {!rows.length ? (
        <p className="px-4 py-8 text-center text-ink-muted">No active projects.</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ project, open_tasks, done_tasks, p1_open, spent_cents, invoiced_cents }) => {
            const total = open_tasks + done_tasks
            const pct = total ? Math.round((done_tasks / total) * 100) : 0
            const stageIndex = STAGES.indexOf(project.stage)
            const overBudget = project.budget_cents > 0 && spent_cents > project.budget_cents
            return (
              <li key={project.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{project.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      <span className={`chip ${project.context === 'personal' ? 'border-transparent bg-accent-soft text-accent' : ''}`}>
                        {project.context}
                      </span>
                      <span>{STAGE_LABEL[project.stage]}</span>
                      {project.target_date && <span>· due {day(project.target_date)}</span>}
                    </div>
                  </div>
                  {p1_open > 0 && (
                    <span className="chip border-transparent bg-critical-soft text-critical" title={`${p1_open} open P1`}>
                      {p1_open} P1
                    </span>
                  )}
                </div>

                <ol className="flex gap-1" aria-label="Stage">
                  {STAGES.map((stage, i) => (
                    <li
                      key={stage}
                      title={STAGE_LABEL[stage]}
                      className={`h-1.5 flex-1 rounded-full ${
                        i < stageIndex ? 'bg-good' : i === stageIndex ? 'bg-accent' : 'bg-surface-sunken'
                      }`}
                    />
                  ))}
                </ol>

                <div className="flex items-center gap-3 text-[11px] text-ink-2">
                  <span className="tabular-nums">
                    {done_tasks}/{total} tasks
                  </span>
                  <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </span>
                  <span className="tabular-nums">{pct}%</span>
                </div>

                {(spent_cents > 0 || invoiced_cents > 0 || project.budget_cents > 0) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums text-ink-muted">
                    {invoiced_cents > 0 && <span>Invoiced {money(invoiced_cents, project.currency)}</span>}
                    <span className={overBudget ? 'font-semibold text-critical' : ''}>
                      Spent {money(spent_cents, project.currency)}
                      {project.budget_cents > 0 && ` of ${money(project.budget_cents, project.currency)}`}
                    </span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
