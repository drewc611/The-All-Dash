# Copilot instructions for The All Dash

Two products live in this repository and share one idea: everything is a flat
**entity** (task, event, note, metric, milestone, risk, decision, person, doc).

- `src/` is the browser app (React + Vite, plain CSS, no runtime dependency beyond
  React). Parsers in `src/ingest/` produce entities; widgets in `src/ui/widgets/`
  query them through `src/core/query.js`; `src/engine/` holds metrics, insights,
  triage, reminders and the status update. The assistant in `src/ai/` never
  writes to the store: it proposes, the user applies.
- `backend/` (FastAPI + Celery), `frontend/` (Next.js 14) and `k8s/` are the
  platform tier: projects, work/personal tasks, invoices, expenses, a
  hash-chained AI audit ledger (`backend/app/audit.py`) and the daily update
  engine (`backend/app/services/daily.py`).
- `mcp/` is the MCP server that exposes both to Claude, Copilot and ChatGPT.

## Conventions

- Money is integer cents. Dates that mean a calendar day are `YYYY-MM-DD` and
  local; never build them with `new Date("YYYY-MM-DD")` (see `src/core/time.js`).
- Every system decision in the platform goes through `audit.record(...)`. Do not
  add UPDATE or DELETE paths for `ai_audit_logs`.
- Tests: `npm test` (browser app, run under three timezones in CI),
  `cd backend && pytest`, `cd mcp && npm test`. Add a test with every behaviour change.
- Keep the browser app dependency-free. Charts are hand-drawn SVG; the AI
  providers are plain `fetch`.
- Commit messages explain the why in prose; no model identifiers in repo artifacts.

## Using the MCP server from Copilot

`.vscode/mcp.json` registers the `all-dash` server. In agent mode ask for
`workspace_triage`, `platform_brief`, `platform_tasks_today` or `search` /
`fetch`. When you decide something on the user's behalf (reprioritise,
reschedule, close), record it with `platform_log_decision` so it lands in the
ledger with a confidence score.
