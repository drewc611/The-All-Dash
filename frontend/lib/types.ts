/** Mirrors backend/app/schemas.py. Keep the two in step. */

export type Context = 'work' | 'personal'
export type ProjectStage = 'idea' | 'planning' | 'in_progress' | 'review' | 'done'
export type ProjectStatus = 'active' | 'paused' | 'done'
export type TaskPriority = 'P1' | 'P2' | 'P3'
export type TaskStatus = 'open' | 'doing' | 'done'
export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'void'
export type AuditActor = 'system' | 'worker' | 'user' | 'assistant'

export interface Project {
  id: string
  name: string
  description: string
  context: Context
  stage: ProjectStage
  status: ProjectStatus
  budget_cents: number
  currency: string
  target_date: string | null
  created_at: string
  updated_at: string
}

export interface ProjectPipeline {
  project: Project
  open_tasks: number
  done_tasks: number
  p1_open: number
  spent_cents: number
  invoiced_cents: number
}

export interface Task {
  id: string
  project_id: string | null
  title: string
  notes: string
  context: Context
  priority: TaskPriority
  status: TaskStatus
  due_date: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface Invoice {
  id: string
  project_id: string | null
  number: string
  client: string
  amount_cents: number
  currency: string
  status: InvoiceStatus
  issued_on: string
  due_on: string
  paid_on: string | null
}

export interface AuditLog {
  id: string
  seq: number
  created_at: string
  actor: AuditActor
  action: string
  subject_type: string
  subject_id: string
  decision: string
  rationale: string
  confidence: number
  inputs: Record<string, unknown>
  prev_hash: string
  hash: string
}

export interface AuditVerification {
  ok: boolean
  checked: number
  first_bad_seq: number | null
  head_hash: string | null
}

export interface BurnRate {
  window_days: number
  expenses_cents: number
  daily_cents: number
  monthly_cents: number
  previous_window_cents: number
  change_pct: number | null
}

export interface FinanceSummary {
  as_of: string
  currency: string
  invoiced_cents: number
  collected_cents: number
  outstanding_cents: number
  overdue_cents: number
  overdue_count: number
  expenses_cents: number
  margin_cents: number
  margin_pct: number | null
  burn: BurnRate
}

export interface DailyBrief {
  id: string
  brief_date: string
  generated_at: string
  triggered_by: string
  summary: string
  payload: {
    p1_due_today: Task[]
    past_due_invoices: Invoice[]
    yesterday: Record<string, number>
    finance: FinanceSummary
    overdue_marked: string[]
  }
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}
