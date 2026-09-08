# The All Dash

A command center for one project or one person. Feed it the documents you already
have — meeting notes, a calendar export, a transcript, a spreadsheet — and it
builds the dashboard from what it finds: tasks with owners and due dates, today's
agenda, decisions, risks, milestones, live metrics, reminders, and analytics that
say what needs attention.

Everything runs in the browser. Nothing is uploaded anywhere. There is no server,
no account, and no runtime dependency beyond React.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # 51 tests, no browser needed
npm run build
```

Open it, click **Load a sample project**, and you get four documents run through
the real parsers — not fixture data.

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
                                             └──▶ insight rules ──▶ "what needs attention"
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
harness* lists what is plugged in right now.

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
| `g` then `t` `l` `a` `d` `s` | Today, Timeline, Analytics, Library, Settings |
| `Esc` | Close whatever is open |

## Layout

```
src/
  core/       registry (the harness), store, query engine, time, format, ids
  data/       entity schema, the sample project
  ingest/     parser registry entry point, shared text and table readers, zip
  engine/     metrics, reminders, insight rules
  ui/         shell, board, command bar, inspector, views, widgets, charts
  styles/     tokens, base, layout, components, viz
tests/        42 node:test cases over parsing, querying and analytics
```

## Deliberately not here

No drag-and-drop grid library (buttons reorder widgets and work identically with a
mouse, a thumb and a keyboard). No state library — one object, one
`useSyncExternalStore`. No chart library. No router. No backend. No PDF reading:
extracting text from PDFs without a dependency is unreliable, and shipping
something that half-works would be worse than saying so. Add it as a parser
plugin when you need it.

## Install it

The build ships a web manifest and a small service worker, so it installs to a
phone's home screen or a desktop dock and opens offline. The worker caches the
app shell only; there is no network traffic to cache.

## Storage

`localStorage`, under `all-dash:v1`. Export and restore as JSON from Settings →
*Your data*. Clearing site data clears the workspace, so export before you do
anything drastic.
