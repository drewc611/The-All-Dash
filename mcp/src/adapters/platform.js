/**
 * The platform API (backend/), spoken over plain fetch with the X-API-Key
 * header. Every method maps to one endpoint; nothing is cached, because the
 * point of asking is the current answer.
 */
export class PlatformAdapter {
  constructor(baseUrl, apiKey) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.apiKey = apiKey
  }

  async call(path, { method = 'GET', body, params } = {}) {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { 'x-api-key': this.apiKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (res.status === 204) return null
    const text = await res.text()
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? data)
      throw new Error(`Platform API ${res.status} on ${method} ${path}: ${detail}`)
    }
    return data
  }

  health() { return this.call('/readyz') }
  brief(date) { return this.call(date ? `/daily/${date}` : '/daily/latest') }
  runDaily(date) { return this.call('/daily/run', { method: 'POST', params: { sync: 'true', on: date } }) }
  pipeline(context) { return this.call('/projects/pipeline', { params: { context } }) }
  projects(params) { return this.call('/projects', { params }) }
  tasksToday(context, on) { return this.call('/tasks/today', { params: { context, on } }) }
  tasks(params) { return this.call('/tasks', { params }) }
  createTask(body) { return this.call('/tasks', { method: 'POST', body }) }
  patchTask(id, body) { return this.call(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body }) }
  toggleTask(id) { return this.call(`/tasks/${encodeURIComponent(id)}/toggle`, { method: 'POST' }) }
  invoices(params) { return this.call('/invoices', { params }) }
  expenses(params) { return this.call('/expenses', { params }) }
  finance(params) { return this.call('/finance/summary', { params }) }
  auditLogs(params) { return this.call('/ai-audit-logs', { params }) }
  auditVerify() { return this.call('/ai-audit-logs/verify') }
  logDecision(body) { return this.call('/ai-audit-logs', { method: 'POST', body: { actor: 'assistant', ...body } }) }

  /** Client-side text search across the record types, for `search`. */
  async search(query, { limit = 20 } = {}) {
    const needle = query.toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (text) => needle.every((t) => text.toLowerCase().includes(t))
    const [tasks, projects, invoices, expenses] = await Promise.all([
      this.tasks({ limit: 200 }),
      this.projects({ limit: 200 }),
      this.invoices({ limit: 200 }),
      this.expenses({ limit: 200 }),
    ])
    const out = []
    for (const t of tasks.items) if (hit(`${t.title} ${t.notes} ${t.context} ${t.priority} ${t.status}`)) out.push({ kind: 'task', id: t.id, title: t.title, record: t })
    for (const p of projects.items) if (hit(`${p.name} ${p.description} ${p.context} ${p.stage}`)) out.push({ kind: 'project', id: p.id, title: p.name, record: p })
    for (const i of invoices.items) if (hit(`${i.number} ${i.client} ${i.status}`)) out.push({ kind: 'invoice', id: i.id, title: `${i.number} ${i.client}`, record: i })
    for (const e of expenses.items) if (hit(`${e.vendor} ${e.category} ${e.notes}`)) out.push({ kind: 'expense', id: e.id, title: `${e.vendor} ${e.category}`, record: e })
    return out.slice(0, limit)
  }

  /** Resolve an id whatever record type it belongs to. */
  async get(id) {
    const paths = ['/tasks/', '/projects/', '/invoices/', '/expenses/', '/ai-audit-logs/']
    for (const p of paths) {
      try {
        const record = await this.call(`${p}${encodeURIComponent(id)}`)
        return { kind: p.replaceAll('/', '').replace('ai-audit-logs', 'audit-log').replace(/s$/, ''), record }
      } catch (error) {
        if (!/ 404 /.test(error.message)) throw error
      }
    }
    return null
  }
}
