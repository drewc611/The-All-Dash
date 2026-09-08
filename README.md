# The All Dash

A command center for one project or one person. Feed it the documents you already
have — meeting notes, a calendar export, a transcript, a spreadsheet — and it
builds the dashboard from what it finds: tasks with owners and due dates, today's
agenda, decisions, risks, milestones, live metrics, reminders, and analytics that
say what needs attention.

Everything runs in the browser. Nothing is uploaded anywhere. There is no server,
no account, and no runtime dependency beyond React. A separate, optional
[platform tier](#platform-tier-api-workspace-and-eks) adds a FastAPI service, a
Celery worker, a hash-chained AI audit ledger, a Next.js workspace, an MCP
server for Claude, Copilot and ChatGPT, and Kubernetes manifests for AWS EKS.
An optional assistant answers
questions from your own data through a model you choose (Claude, any
OpenAI-compatible endpoint, or a local Ollama), cites the items it used, and
proposes changes for you to apply rather than making them.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node:test, no browser needed; CI also runs it in three timezones
npm run build
```

Open it, click **Load a sample project**, and you get six documents run through
the real parsers — not fixture data.

## What it looks like

![Today: agenda, focus list, reminders, pulse and recent activity, with person and topic filters above the board](docs/screenshots/today.png)

**Triage.** Everything that is wrong right now, most urgent first: overdue and
blocked work, milestones that passed with tasks still open, stalled items,
clashing meetings, off-target metrics. Each row carries the one or two buttons
that clear it, and a spark that asks the assistant why it was flagged.

![Triage view with severity tiles and per-row actions](docs/screenshots/triage.png)

**Assistant.** Grounded in the live store, citing items as chips that open the
inspector. Ask for a change and it arrives as a proposal card with a before and
after; nothing is written until you press Apply.

<p>
  <img src="docs/screenshots/assistant.png" width="49%" alt="Assistant answering with citation chips" />
  <img src="docs/screenshots/assistant-proposals.png" width="49%" alt="Assistant proposing two changes with Apply and Skip buttons" />
</p>

**Relationship map and load heatmap.** Documents on the left, the work they
produced in the middle, the people carrying it on the right; hover a node to
trace its thread. Below it, open tasks per person across the coming weeks.

![Relationship map widget](docs/screenshots/map.png)

**Analytics.** Every metric on one wall — built-in, discovered from spreadsheet
columns, or built by hand — with sparklines and period-over-period deltas, then
any series as a line with a 7-day average.

![Analytics: the metric wall and series explorer](docs/screenshots/analytics.png)

**Timeline.** Meetings on their start time, tasks and milestones on their due
date, one vertical run of days.

![Timeline view](docs/screenshots/timeline.png)

**Command bar and inspector.** `⌘K` searches every item and every command at
once. Click anything to open it, edit it, and see what else came from the same
document.

<p>
  <img src="docs/screenshots/command-bar.png" width="49%" alt="Command bar searching across entities and commands" />
  <img src="docs/screenshots/inspector.png" width="49%" alt="Inspector panel for a calendar event" />
</p>

**Phone and dark mode.** Same app. The rail becomes a bottom tab bar, boards go
single-column, and the theme follows the OS or the toggle in Settings.

<p>
  <img src="docs/screenshots/mobile.png" width="24%" alt="Today on a phone" />
  <img src="docs/screenshots/mobile-triage.png" width="24%" alt="Triage on a phone in dark mode" />
  <img src="docs/screenshots/today-dark.png" width="50%" alt="Today in dark mode" />
</p>

## The one idea

Everything becomes an **entity**: one flat record with a type, a title, optional
dates, people, tags and a value.

```js
{ id, type, title, body, at, end, due, status, priority,
  tags[], people[], value, unit, series, meta, source, confidence }
```

A meeting note, a calendar invite, a spreadsheet row and a hand-typed reminder all
normalise to that shape. Parsers only produce entities. Widgets only query them.
Neither knows the other exists.

That is why adding a file format costs one file, and adding a panel costs one
file, and neither costs a change anywhere else.

```
file ──▶ parser registry ──▶ entities ──▶ store ──▶ query layer ──▶ widgets
                                             │
                                             ├──▶ metric engine ──▶ charts
                                             ├──▶ reminder engine ──▶ notifications
                                             ├──▶ insight rules ──▶ "what needs attention"
                                             ├──▶ triage ──▶ worklist with actions
                                             └──▶ context builder ──▶ assistant ──▶ proposals
```

## What it reads

| Format | What comes out |
|---|---|
| `.md` `.txt` | Checkboxes, `Action:` / `Decision:` / `Risk:` / `Question:` lines, `Attendees:`, `## Timeline` sections, `Label: 42` metrics |
| `.vtt` `.srt` | Speaker turns, then commitments ("I'll rewrite the rollback script"), asks, decisions and stated worries |
| `.ics` `.ical` | Events with attendees, location and duration; recurrence expanded a year each way; action items hidden in invite descriptions |
| `.csv` `.tsv` | Task tables (owner, status, due, priority) or metric tables (a date column plus any numeric columns) |
| `.xlsx` `.xlsm` | Every sheet, via a 90-line ZIP reader over the browser's own `DecompressionStream`. No dependency |
| `.docx` | Headings, lists, checkboxes and tables, through the same ZIP reader, then read as notes |
| `.pptx` | Every slide's title and bullets, then read as notes |
| `.json` `.ndjson` | An exported workspace, an entity array, or any array of records treated as a table |
| `.html` | Flattened to text, then read as notes |

Exports from the tools people already use are recognised from their own headers
and read with that tool's quirks handled, with nothing to install or connect:
**Jira** and **Linear** CSV (summary, issue type, sprint, priority words),
**Asana** CSV (status from *Completed At*, section as a tag), **Todoist** CSV
(task rows only, priority 4 is urgent, *DATE* is the due date), **Trello** board
JSON (cards in lists, list names that read like a status become one, members
become owners), **GitHub** issues JSON (assignees and labels from objects,
milestone due dates), and Google, Outlook and Apple calendars. The Library shows
what was recognised. An unrecognised file still takes the generic route.

Dates are read the way people write them: `2026-03-04`, `by Friday`, `next
tuesday`, `Mar 20`, `3/20/26`, `EOD`, `in 2 weeks`. When it cannot tell, it
returns nothing rather than guessing.

A line like this:

```
- [ ] P0 Draft the launch brief @Sam #launch by Friday
```

becomes an open task titled "Draft the launch brief", owned by Sam, tagged
`launch`, urgent, due this Friday at 17:00 — with a link back to the file and
line it came from.

## The harness

Four registries, exposed on `window.AllDash`, so a plugin can be a single
`<script>` tag with no build step.

```js
AllDash.defineWidget({
  id: 'burn-rate',
  name: 'Burn rate',
  description: 'Spend against the month',
  category: 'Analytics',
  size: 'sm',
  render: ({ entityList, range, config, setConfig, onOpen }) => /* JSX */,
})

AllDash.defineParser({
  id: 'jira-csv',
  name: 'Jira export',
  extensions: ['.csv'],
  priority: 50,                       // highest matching priority wins
  match: ({ name, text }) => /Issue key/.test(text),
  parse: ({ name, text, buffer, docId }) => [/* entities */],
})

AllDash.defineMetric({
  id: 'wip',
  name: 'Work in progress',
  goal: 'down',
  compute: (entities, range) => ({ value, series }),
})

AllDash.defineCommand({ id: 'standup', name: 'Copy standup', run: ({ navigate }) => {} })
```

Register at any time — the board re-renders when a registry changes. Widgets
added by a plugin appear in the widget picker immediately. Settings → *The
harness* lists what is plugged in right now. A widget that throws gets its own
card saying so, with a button to reset its settings; the rest of the board
keeps rendering.

## Metrics

Three kinds, all the same shape downstream:

- **Built-in** — open tasks, overdue, completed, meeting hours, decisions, risks.
- **Discovered** — every numeric spreadsheet column becomes a queryable series on
  import. Nobody defines it. A discovered series has no known good direction, so
  its change is shown in neutral grey rather than guessed at as green or red.
- **Custom** — Settings → *Build a metric*: pick an entity type, a reducer
  (count/sum/avg/min/max/last), a date field, and optional tag or series filters.
  Live preview, then save. It shows up in every metric widget at once.

Every metric is evaluated against the window immediately before it, so the
headline delta is a real period-over-period comparison. A custom metric can
carry a **target**; the app reports progress and, from the fitted trend, how
many days until it is reached. Discovered series are checked pairwise for
correlation and the strongest pair is surfaced.

Analytics underneath: least-squares trend with an R², half-window momentum,
straight-line forecast, Pearson correlation, z-score anomalies, streaks, and
moving averages — about 100 lines in `src/core/query.js`, no dependency.

## Triage

Insights speak in sentences about the whole project. Triage speaks in rows about
single items, and it is a worklist rather than a report. Each row has a
severity, the reason it was raised, and the actions that clear it:

| Signal | Severity | Actions |
|---|---|---|
| Task past due | serious; critical when urgent or a week late | Mark done, Push a week |
| Task due in 48h | warning; serious when high priority | Mark done, Push a week |
| Blocked task | serious; critical after a week | Unblock, Mark done |
| In progress, untouched 14 days | warning | Mark done |
| Milestone within 14 days, or passed and not done | warning to critical, with the open tasks that share its tags | Mark done, Push a week |
| Open risk untouched 7 days | warning; serious after 21 | Mark done |
| Urgent task with no owner | warning | Assign |
| Two meetings overlapping in the next two days | warning | |
| Question open 14 days | info | |
| Custom metric off target with no trend toward it, or an unusual day | warning / info | |

Every row can be muted for a week. Mutes are the only thing stored; the signal
itself is derived on every render, so closing a task removes its row the
instant the store changes. The rail shows the count of critical and serious rows.

## Assistant

`⌘J` opens it. Every answer is grounded in a context block built from the live
store: a numeric snapshot, the metrics in the current window, what the rules
flagged, the top of triage, and up to forty items chosen by a small retriever
(matches for the question first, then the standing baseline: overdue, due this
week, blocked, open risks, today's meetings, milestones, recent decisions).
Items are printed with their ids, and the model is asked to cite them as
`[[id]]`; the panel turns each citation into a chip that opens the inspector.

The model cannot change anything. Asked to update, reschedule, assign, create
or close something, it emits a fenced `actions` block with a JSON array, and the
panel shows one proposal card per action with the before and after. Apply or
skip each one, or apply all. Unknown ids, bad statuses and unsupported ops are
dropped on the way in, so a model that invents an item cannot touch anything.

Three ways to reach a model, all plain `fetch` from the browser with streaming,
no SDK and no server in between:

| Provider | Endpoint | Key |
|---|---|---|
| Anthropic | Messages API, `claude-opus-5` by default | Your own key, sent straight to Anthropic |
| OpenAI-compatible | Anything speaking `/chat/completions`: OpenAI, Groq, OpenRouter, Mistral, LM Studio, vLLM, LocalAI | Bearer token |
| Ollama | `http://localhost:11434`, nothing leaves the machine | None; start Ollama with `OLLAMA_ORIGINS` set to this site |

The key lives in `sessionStorage` (gone when the tab closes) or, if you tick
*Remember on this device*, in `localStorage` under its own name. It is never part
of the workspace export. Two privacy dials: *What the model sees* can be titles,
dates, people and tags only, so no note or transcript text leaves the machine
even with a hosted model; and *Items per question* caps the context.

Voice is the browser's own speech APIs, no upload: a microphone button
transcribes into the box, *Read replies aloud* speaks the answer, and
*Hands-free* sends when you stop talking and listens again after the reply.
The buttons only render where the browser supports them.

The conversation lives in the panel and is gone when it closes. Nothing the
model says is stored unless you apply it.

## What needs attention

Rules that run over everything and return a sentence with its evidence attached.
Each finding lists the entities behind it, so you can click through and disagree.

Overdue work · tasks aging with no date · one person holding most of the open work
· heavy meeting weeks with the focus time left over · commitments with no owner ·
risks nobody has touched in a week · questions that never became decisions ·
metrics moving more than 35% across the window · daily closing streaks.

## Status update

The weekly message every team writes by hand is assembled from the store:
done, in progress, blocked and at risk, overdue, decisions, numbers that moved,
the next seven days, the calendar, open questions. Every line is a real entity;
nothing is invented. It is a widget on Today (copy or download as Markdown) and
a command (`Copy my status update`).

## Filters

Chips above a board scope it to a person or a tag. They are derived from what
is in the data, most common first. Widgets also take per-instance settings
from the gear in their header, generated from the `options` each widget
declares — a plugin widget gets that panel for free.

## Reminders

Derived, never stored. Anything with a due date or a start time produces one; the
store only keeps what you *did* about it (snoozed until, dismissed). Re-importing
a corrected calendar corrects the reminders too, with no reconciliation step.
System notifications are opt-in; the in-app list is always there.

## Design

Plain CSS, no framework. Tokens in `src/styles/tokens.css` are the single source
for colour, spacing, type and motion; light values sit on bare `:root`, dark
redefines only what changes under both the OS media query and an explicit theme
stamp, so the in-app toggle wins in both directions.

Charts are hand-drawn SVG. Series colours are a validated categorical palette:
adjacent-pair CVD ΔE ≥ 8, normal-vision ΔE ≥ 15. Marks are thin, the grid
recedes, there is exactly one y-axis, hover is on by default, and text always
wears an ink token rather than the series colour.

Mobile is the same app, not a cut-down one. The rail becomes a bottom tab bar,
boards go single-column, sheets slide up from the bottom, hit targets grow to
36–48px, and safe-area insets are respected.

## Keyboard

| | |
|---|---|
| `⌘K` / `Ctrl K` or `/` | Command bar — searches every entity and every command at once |
| `⌘J` / `Ctrl J` | Assistant |
| `g` then `t` `r` `l` `a` `d` `s` | Today, Triage, Timeline, Analytics, Library, Settings |
| `Esc` | Close whatever is open |

## Layout

```
src/
  core/       registry (the harness), store, query engine, time, format, ids
  data/       entity schema, the sample project
  ingest/     parser registry entry point, shared text and table readers, zip, export detection
  engine/     metrics, reminders, insight rules, triage
  ai/         providers (fetch + streaming), context builder, reply protocol, proposals, key storage
  ui/         shell, board, command bar, inspector, assistant, views, widgets, charts
  styles/     tokens, base, layout, components, viz
tests/        97 node:test cases over parsing, querying, analytics, triage and the assistant protocol
backend/ frontend/ mcp/ k8s/   the platform tier, described in its own section below
```

## Deliberately not here

No drag-and-drop grid library (buttons reorder widgets and work identically with a
mouse, a thumb and a keyboard). No state library — one object, one
`useSyncExternalStore`. No chart library. No router. No backend. No AI SDK: the
three providers differ by a URL, a header and a line format, and a single
line reader serves all of them. No model-driven writes: the assistant proposes,
a person applies. No PDF reading:
extracting text from PDFs without a dependency is unreliable, and shipping
something that half-works would be worse than saying so. Add it as a parser
plugin when you need it.

## Platform tier: API, workspace and EKS

The browser app needs nothing but a browser. For a team that wants shared
state, scheduled processing, money tracking and an API that agents can call,
the repository also carries a containerised platform: a FastAPI service, a
Celery worker, a hash-chained AI audit ledger, a Next.js 14 workspace, and the
Kubernetes manifests to run it on AWS EKS. The two tiers share the entity idea
and the MCP server exposes both.

![The workspace: project pipelines, the day's checklist, the AI audit stream and the margin ribbon](docs/screenshots/workspace.png)

### Repository tree

```
The-All-Dash/
├── src/                        Browser app (React + Vite): parsers, engines, widgets, assistant
├── public/  tests/  docs/      PWA assets, node:test suite, screenshots, docs/openapi.json
├── backend/                    Platform API and worker (Python 3.12)
│   ├── app/
│   │   ├── main.py             FastAPI factory, request-id middleware, routers
│   │   ├── config.py           ALLDASH_* settings; production refuses to start without keys
│   │   ├── db.py  models.py    Async SQLAlchemy 2.0; money in cents; string enums with checks
│   │   ├── schemas.py          Pydantic v2, strict (unknown fields rejected)
│   │   ├── security.py         X-API-Key, constant-time compare
│   │   ├── audit.py            The ledger: SHA-256 over row + previous hash, advisory-locked appends, verify
│   │   ├── routers/            /projects /tasks /invoices /expenses /ai-audit-logs /daily /finance /healthz /readyz
│   │   ├── services/           daily.py (the daily update engine), finance.py (burn rate, margin)
│   │   └── worker.py           Celery app, beat schedule, three periodic decisions
│   ├── alembic/                Migrations; 0001 also installs the append-only trigger on ai_audit_logs
│   ├── scripts/seed.py         Sample workspace, idempotent
│   ├── tests/                  pytest: auth, CRUD, pipeline, checklist, invoices, finance, chain, brief
│   └── Dockerfile              Multi-stage slim, uid 10001, tini, healthcheck
├── frontend/                   Next.js 14 App Router + Tailwind (TypeScript strict)
│   ├── app/page.tsx            The three-column workspace (server component)
│   ├── app/api/                Route handlers that carry the key so the browser never sees it
│   ├── components/             ProjectPipelines, DailyTasks, AuditStream, MarginRibbon, Header
│   ├── lib/                    Typed API client (server-only), types mirroring schemas.py, formatting
│   └── Dockerfile              Standalone output, three-stage alpine, uid 10001
├── mcp/                        MCP server (Node 20): stdio and Streamable HTTP, workspace and platform adapters
├── k8s/
│   ├── base/                   Namespace (restricted PSS), ConfigMap, storage, Postgres, Redis, API, worker, beat,
│   │                           frontend, MCP, HPA, PDBs, NetworkPolicies, CronJobs, kustomization
│   ├── ingress/alb/            AWS Load Balancer Controller Ingress (ACM, 80→443)
│   ├── ingress/nginx-letsencrypt/  ingress-nginx Ingress + cert-manager ClusterIssuers (Let's Encrypt)
│   ├── overlays/prod/          Registry, tag and host patches; `kubectl apply -k k8s/overlays/prod`
│   └── secrets.example.yaml    Templates for the three Secrets (never applied as-is)
├── docker-compose.yml  .env.example
├── .mcp.json  .vscode/mcp.json  .claude/skills/all-dash/  .github/copilot-instructions.md
└── .github/workflows/ci.yml    Browser app in three timezones; backend, MCP, frontend, manifests
```

### Runtime architecture

```mermaid
flowchart TB
  user([Browser / phone]) -->|HTTPS 443| lb[AWS Load Balancer<br/>ALB via AWS LB Controller, or NLB in front of ingress-nginx]
  agents([Claude · Copilot · ChatGPT]) -->|HTTPS 443 · Bearer| lb
  lb -->|"/"| ing[Ingress alldash<br/>TLS: ACM or cert-manager + Let's Encrypt]
  lb -->|"/mcp"| ing
  subgraph eks[EKS cluster · namespace alldash · default-deny NetworkPolicies]
    ing -->|3000| fe[frontend ×2<br/>Next.js standalone]
    ing -->|8080| mcp[mcp ×2<br/>Streamable HTTP]
    fe -->|8000 · X-API-Key| api[backend ×2–6 HPA<br/>FastAPI + uvicorn<br/>init: alembic upgrade]
    mcp -->|8000 · X-API-Key| api
    cron[CronJob daily-brief<br/>0 4 * * * UTC] -->|POST /daily/run?sync=true| api
    api -->|5432| pg[(postgres<br/>PVC 20Gi gp3, encrypted)]
    api -->|6379| redis[(redis<br/>broker + results)]
    worker[worker ×2<br/>Celery] --> redis
    beat[beat ×1<br/>Celery beat] --> redis
    worker --> pg
    snap[CronJob postgres-snapshot<br/>30 3 * * *] -->|CHECKPOINT then VolumeSnapshot| pg
  end
  snap -.->|EBS CSI driver| ebs[(EBS snapshots<br/>VolumeSnapshotClass, Retain)]
  api -.->|ai_audit_logs| ledger[[Hash chain<br/>SHA-256, append-only trigger]]
```

Traffic: the load balancer terminates TLS and forwards to the Ingress, which
routes `/` to the workspace and `/mcp` to the MCP server. Only those two are
public. The workspace reaches the API on the cluster network with the key from
its own environment; browser writes go through Next.js route handlers, so the
key never leaves the pod. The MCP server does the same for agents. The API is
the only thing that talks to Postgres and Redis, apart from the worker, beat
and the snapshot job.

### The services

**Backend (FastAPI).** `/projects` (with `/projects/pipeline` for the left
column), `/tasks` with a `context` of `work` or `personal` and `/tasks/today`
for the checklist, `/invoices` (with `/invoices/mark-overdue`), `/expenses`,
`/finance/summary` and `/finance/burn-rate`, `/ai-audit-logs` (list, get,
append, `/verify`), `/daily/run` (the daily update engine: `sync=true` builds
inline for the cron ping, otherwise the worker does it), `/daily/latest`,
`/daily/{date}`, `/healthz`, `/readyz`, `/docs`, `/openapi.json`. Every
mutating route requires `X-API-Key`; production refuses to start without keys.

**Daily update engine.** For a date: P1 tasks due that day, invoices past due
(sent ones are marked overdue, each as an audited decision), yesterday's
activity (tasks completed and created, invoices paid, spend, decisions
logged), the money picture with a rolling burn rate against the window before
it, and a one-paragraph summary. Stored per date; a rebuild replaces it, so the
04:00 CronJob and Celery beat's 04:05 run agree.

**Worker (Celery + Redis).** Three periodic jobs: the brief at 04:05, overdue
marking hourly, and a six-hourly burn-rate decision. Each opens its own engine
(Celery forks), commits once, and lands in the ledger. Beat runs as a separate
single-replica Deployment so scaling workers never doubles the schedule.

**AI audit ledger.** `ai_audit_logs` rows carry `seq`, `prev_hash` and
`hash = SHA-256(prev_hash ‖ canonical JSON of the row)`. Appends take a Postgres
advisory lock so two workers cannot both claim a sequence number. `/verify`
recomputes the whole chain and names the first bad row. The initial migration
installs a trigger that rejects UPDATE and DELETE on the table, so even a
database client cannot edit history without leaving the chain broken.

**Frontend (Next.js 14).** Left: project pipelines as stage tracks with task
progress, open P1s, invoiced and spent against budget. Centre: the checklist
with P1/P2/P3 colour coding, optimistic toggles, an add box and a priority
filter; today's finished items stay visible. Right: the audit stream with a
confidence ring per decision and the chain's verification state. A floating
ribbon carries collected, spent, margin, burn per day and its change,
outstanding and overdue. Context tabs scope everything to work or personal.

### Run it locally

```bash
cp .env.example .env                      # set ALLDASH_API_KEYS and POSTGRES_PASSWORD
docker compose up --build                 # migrate → api :8000, worker, beat, frontend :3000
docker compose --profile seed run --rm seed
open http://localhost:3000                # the workspace
open http://localhost:8000/docs           # the API
```

Without Docker: `cd backend && python -m venv .venv && . .venv/bin/activate &&
pip install -r requirements-dev.txt && pytest`, then `uvicorn app.main:app`
with `ALLDASH_DATABASE_URL` pointing at a Postgres (or `sqlite+aiosqlite:///dev.db`
for a quick look), `celery -A app.worker worker -B`, and `cd frontend && npm
install && BACKEND_URL=http://localhost:8000 BACKEND_API_KEY=... npm run dev`.

### Build, tag and push to ECR

```bash
export AWS_REGION=us-east-1 AWS_ACCOUNT=123456789012 TAG=0.1.0
export ECR=$AWS_ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com

for repo in alldash-backend alldash-frontend alldash-mcp; do
  aws ecr describe-repositories --repository-names $repo >/dev/null 2>&1 \
    || aws ecr create-repository --repository-name $repo --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256
done
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR

docker build -t $ECR/alldash-backend:$TAG  backend
docker build -t $ECR/alldash-frontend:$TAG frontend
docker build -t $ECR/alldash-mcp:$TAG -f mcp/Dockerfile .      # context is the repo root

docker push $ECR/alldash-backend:$TAG
docker push $ECR/alldash-frontend:$TAG
docker push $ECR/alldash-mcp:$TAG
```

For multi-architecture nodes (Graviton), add `--platform linux/amd64,linux/arm64`
with `docker buildx build --push`.

### Deploy to EKS

Prerequisites on the cluster: the AWS Load Balancer Controller, the EBS CSI
driver with the snapshot controller and CRDs, metrics-server (for the HPA),
and, for the Let's Encrypt path, ingress-nginx and cert-manager.

```bash
# 0. Point kubectl at the cluster
aws eks update-kubeconfig --region $AWS_REGION --name my-cluster

# 1. Cluster add-ons (skip any you already run)
kubectl apply -k "github.com/kubernetes-csi/external-snapshotter/client/config/crd?ref=v8.2.0"
kubectl apply -k "github.com/kubernetes-csi/external-snapshotter/deploy/kubernetes/snapshot-controller?ref=v8.2.0"
aws eks create-addon --cluster-name my-cluster --addon-name aws-ebs-csi-driver   # needs an IRSA role
helm repo add eks https://aws.github.io/eks-charts && helm repo update
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=my-cluster --set serviceAccount.create=false \
  --set serviceAccount.name=aws-load-balancer-controller
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# 2. Namespace first, so the Secrets have somewhere to live
kubectl apply -f k8s/base/namespace.yaml

# 3. Bootstrap secrets (values from a password manager or AWS Secrets Manager; never from git)
PG_PASS=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-40)
API_KEY=$(openssl rand -hex 32)
MCP_TOKEN=$(openssl rand -hex 32)
kubectl -n alldash create secret generic postgres-credentials \
  --from-literal=POSTGRES_USER=alldash \
  --from-literal=POSTGRES_PASSWORD="$PG_PASS" \
  --from-literal=ALLDASH_DATABASE_URL="postgresql+asyncpg://alldash:$PG_PASS@postgres.alldash.svc.cluster.local:5432/alldash"
kubectl -n alldash create secret generic alldash-api \
  --from-literal=ALLDASH_API_KEYS="$API_KEY" --from-literal=BACKEND_API_KEY="$API_KEY"
kubectl -n alldash create secret generic alldash-mcp --from-literal=MCP_AUTH_TOKEN="$MCP_TOKEN"

# 4. Storage class and snapshot class (cluster-scoped, applied with the base)
# 5. Point the overlay at your registry and host
cd k8s/overlays/prod
kustomize edit set image \
  alldash-backend=$ECR/alldash-backend:$TAG \
  alldash-frontend=$ECR/alldash-frontend:$TAG \
  alldash-mcp=$ECR/alldash-mcp:$TAG
sed -i "s/alldash.example.com/dash.yourdomain.com/g" host-patch.yaml config-patch.yaml
cd -

# 6. Certificates
#    ALB path: request or import a certificate in ACM for dash.yourdomain.com;
#    the controller discovers it by host name. Nothing to apply.
#    Let's Encrypt path: install cert-manager and ingress-nginx, then in the overlay
#    replace ../../ingress/alb with ../../ingress/nginx-letsencrypt and edit the
#    email in k8s/ingress/nginx-letsencrypt/clusterissuer.yaml.
helm upgrade --install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true   # LE path only
helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx --create-namespace \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-type"=external \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-nlb-target-type"=ip \
  --set controller.service.annotations."service\.beta\.kubernetes\.io/aws-load-balancer-scheme"=internet-facing   # LE path only

# 7. Everything else
kubectl apply -k k8s/overlays/prod
kubectl -n alldash rollout status deploy/backend deploy/frontend deploy/mcp deploy/worker deploy/beat

# 8. DNS: CNAME dash.yourdomain.com to the load balancer
kubectl -n alldash get ingress alldash -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'

# 9. Verify
curl -s https://dash.yourdomain.com/api/readyz
kubectl -n alldash create job --from=cronjob/daily-brief daily-brief-now && kubectl -n alldash logs job/daily-brief-now
kubectl -n alldash create job --from=cronjob/postgres-snapshot snap-now && kubectl -n alldash get volumesnapshots
```

### Disaster recovery

The `postgres-snapshot` CronJob runs at 03:30 UTC: it checkpoints Postgres,
creates a `VolumeSnapshot` through the EBS CSI driver's `VolumeSnapshotClass`
(deletion policy Retain, tagged `purpose=postgres-backup`), waits for it to be
ready, and deletes snapshot objects older than 14 days. Restore by creating a
PVC from a snapshot and pointing the Postgres Deployment at it:

```bash
kubectl -n alldash get volumesnapshots
kubectl -n alldash scale deploy/postgres --replicas=0
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: postgres-data-restored, namespace: alldash }
spec:
  storageClassName: alldash-gp3
  dataSource: { name: postgres-data-20260908-033000, kind: VolumeSnapshot, apiGroup: snapshot.storage.k8s.io }
  accessModes: [ReadWriteOnce]
  resources: { requests: { storage: 20Gi } }
EOF
kubectl -n alldash patch deploy/postgres --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/volumes/0/persistentVolumeClaim/claimName","value":"postgres-data-restored"}]'
kubectl -n alldash scale deploy/postgres --replicas=1
```

Point `ALLDASH_DATABASE_URL` at RDS instead and the PVC, Postgres Deployment
and snapshot job become unnecessary; RDS automated backups take over.

### TLS

Two paths, chosen in the overlay. **ALB**: TLS terminates on the load balancer
with an ACM certificate discovered by host name; port 80 only redirects to 443;
the policy is TLS 1.3/1.2. cert-manager cannot feed an ALB, because ALB reads
ACM, not Kubernetes Secrets. **ingress-nginx + cert-manager**: the controller's
Service is an NLB provisioned by the AWS Load Balancer Controller; cert-manager
answers the HTTP-01 challenge, stores the certificate in the `alldash-tls`
Secret, renews it 30 days before expiry, and the Ingress forces HTTPS and sets
HSTS. Use the `letsencrypt-staging` issuer first to rehearse.

### Agents: Claude, Copilot and ChatGPT

`mcp/` is an MCP server over both tiers. `.mcp.json` registers it for Claude
Code, `.vscode/mcp.json` for Copilot agent mode, the `all-dash` skill tells
Claude how to use it, and the cluster publishes it at `/mcp` for ChatGPT
connectors and remote clients. Agents read briefs, triage and finances, add
and close tasks, and record their own judgements in the audit ledger with a
confidence score. See `mcp/README.md`.

## Install it

The build ships a web manifest and a small service worker, so it installs to a
phone's home screen or a desktop dock and opens offline. The worker caches the
app shell only; there is no network traffic to cache.

## Storage

`localStorage`, under `all-dash:v1`. Export and restore as JSON from Settings →
*Your data*. Clearing site data clears the workspace, so export before you do
anything drastic.
