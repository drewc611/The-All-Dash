---
name: all-dash
description: Work with The All Dash from Claude through its MCP server. Use when the user asks about their day, what is late or blocked, project pipelines, invoices, expenses, burn rate, the morning brief, or wants a task added, closed or rescheduled, or wants an agent decision recorded in the audit ledger.
---

# The All Dash

The `all-dash` MCP server (registered in `.mcp.json`) exposes two sources:

- **Workspace file**: an export of the browser app (Settings → Your data →
  Export). Tools prefixed `workspace_` read it with the same engines the app
  uses (triage, insights, status update) and can append or update tasks in it;
  the user re-imports the file to see changes.
- **Platform API**: the FastAPI service in `backend/`. Tools prefixed
  `platform_` read projects, tasks, invoices, expenses, the finance summary,
  the daily brief and the audit ledger, and can create or toggle tasks, run
  the daily engine, and append decisions to the ledger.

`search` and `fetch` span both sources and return ids you can pass to the
specific tools.

## How to answer

1. Start with `workspace_overview` or `platform_brief` for the shape of the day.
2. Use `workspace_triage` (severity filter) or `platform_tasks_today` (context
   filter: work or personal) for the list to act on.
3. Cite items by title and due date. Money comes back in cents; show it as
   currency with two decimals.
4. Changes: prefer proposing and confirming with the user before calling
   `platform_create_task`, `platform_toggle_task`, `workspace_add_task` or
   `workspace_update_task`.
5. Any judgement you make for the user (what to do first, what to defer, what
   to close) is a decision: record it with `platform_log_decision` including a
   confidence between 0 and 1 and a one-sentence rationale. The ledger is
   append-only and hash-chained; never claim to have edited or removed an entry.

## Morning review

Use the `morning-review` prompt from the server, or run: `platform_brief`,
`workspace_triage` with severity `serious`, `platform_finance_summary`, then
write five lines: what is late, what is due, what is blocked, the money, and
the one thing to do first.
