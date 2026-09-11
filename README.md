# The All Dash

[![CI](https://github.com/drewc611/The-All-Dash/actions/workflows/ci.yml/badge.svg)](https://github.com/drewc611/The-All-Dash/actions/workflows/ci.yml)
[![React 19](https://img.shields.io/badge/React-19-20232a?logo=react&logoColor=61dafb)](package.json)
[![Vite 8](https://img.shields.io/badge/Vite-8-646cff?logo=vite&logoColor=white)](vite.config.js)
[![Installable PWA](https://img.shields.io/badge/PWA-installs_on_iPhone_and_Android-5a0fc8?logo=pwa&logoColor=white)](#get-it-on-your-phone)
[![Runtime dependency](https://img.shields.io/badge/runtime_dependency-React_only-2a78d6)](package.json)
[![Data stays on device](https://img.shields.io/badge/your_data-stays_on_your_device-2a78d6)](#storage)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.141-009688?logo=fastapi&logoColor=white)](backend/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)](frontend/)
[![Kubernetes](https://img.shields.io/badge/AWS_EKS-kustomize-326ce5?logo=kubernetes&logoColor=white)](k8s/)
[![MCP server](https://img.shields.io/badge/MCP-Claude_·_Copilot_·_ChatGPT-111111?logo=modelcontextprotocol&logoColor=white)](mcp/)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin_marketplace-d97757?logo=anthropic&logoColor=white)](#install-the-claude-plugin)

A command center for one project or one person. Feed it the documents you already
have (meeting notes, a calendar export, a transcript, a spreadsheet) and it
builds the dashboard from what it finds: tasks with owners and due dates, today's
agenda, decisions, risks, milestones, live metrics, reminders, and analytics that
say what needs attention.

Everything runs in the browser. Nothing is uploaded anywhere. There is no server,
no account, and no runtime dependency beyond React. It installs to a phone like
an app and works offline. A separate, optional
[platform tier](#platform-tier-api-workspace-and-eks) adds a FastAPI service, a
Celery worker, a hash-chained AI audit ledger, a Next.js workspace, an MCP
server for Claude, Copilot and ChatGPT, and Kubernetes manifests for AWS EKS.

## What it does

- **Reads what you already have.** Drop in Markdown or plain-text notes,
  meeting transcripts, `.ics` calendars, CSV and Excel sheets, Word and
  PowerPoint files, JSON, and exports from Jira, Linear, Asana, Todoist,
  Trello, GitHub, Google, Outlook and Apple Calendar, Zoom and Teams. Each
  parser turns its file into the same flat entity, so every widget works on
  every source.
- **Builds the day.** Today's agenda, the focus list, what is due this week,
  reminders that fire in the browser, and a recent-activity stream, filtered
  by person or topic with one click.
- **Boards, the way a work tool does them.** Groups, twenty-two column kinds,
  and seven views over the same rows: table, Kanban, timeline, calendar,
  chart, workload and a fillable form. Rules fire when a status changes or a
  date arrives, formulas compute from other columns, dependencies push the
  dates that follow, timers bill by the row, and every row is also a task
  everywhere else in the app.
- **Triage.** A ranked worklist of what is wrong right now: overdue and blocked
  work, stalled items, milestones that passed with tasks still open, clashing
  meetings, unowned urgent work, metrics off target. Each row carries the
  button that clears it.
- **Metrics and analytics.** Counters built in, series discovered from
  spreadsheet columns, and metrics you define by hand, all on one wall with
  sparklines and period-over-period change, then any series as a line with a
  7-day average. A relationship map, a load heatmap and a leaderboard show who
  carries what.
- **The web, read into the dashboard.** Give the platform a URL and the page
  (or the whole site) comes back as Markdown and goes through the same parsers
  as a pasted note: the tasks, dates, people, decisions and numbers on a wiki
  page, a status page, a vendor's changelog or a public tracker become
  entities you can triage. Scrape, map, crawl and batch are native and free;
  search, JavaScript rendering and screenshots use Firecrawl when you add a
  key; extract and agent use a model you configure on the backend and record
  what they did in the audit ledger. Agents get the same seven tools over MCP.
- **A stash that outlives what you saved.** Paste a link and the whole article
  is kept, not the URL: it reads offline, it is searched by the words inside it
  rather than its headline, and a page you are watching shows you what changed
  since you read it. Highlights, and your own ideas, sit in the same list.
  Pocket shut in 2025 and handed people a CSV of links with the articles gone;
  this archive is a file on your disk and an export that carries the text.
- **A Studio: camera, player, compression, YouTube.** Shoot a clip or a photo
  from the webcam and it lands in the Library beside the notes from the same
  meeting. Shrink a video without uploading it anywhere — the built-in encoder
  decodes to a canvas and records the canvas at a bitrate you choose, and an
  optional ffmpeg.wasm engine goes faster and writes MP4. Music and recordings
  play from a bar in the shell rather than inside a view, so the sound carries
  on while you work a board, and the OS media keys drive it. YouTube embeds
  through youtube-nocookie.com, off until you switch it on.
- **A brain that learns who you are, with no model.** Rules over your own
  data work out who you work with, which topics slip, when you are active,
  how far ahead you plan. Facts are recorded automatically; opinions ("#infra
  usually finishes late", "Priya carries 40% of the open work") wait for your
  yes, and once accepted they change triage, reminders and the start view. It
  all becomes a folder of Markdown files on your disk, kept in sync.
- **A router in front of the models, that grades their answers.** One chain
  across a dozen providers, tried in order, where a *bad answer* falls through
  as readily as a 500: an answer citing a task you do not have is a failure,
  and the next provider gets a turn. A ceiling checked before the call, not
  after. A cache keyed on the facts the answer was built from, so editing one
  of them throws the answer away. And a table saying what each provider costs
  per answer that actually worked, which is the only honest way to compare a
  cheap model against a reliable one.
- **An assistant that cites and proposes.** Ask questions of your own data
  through Claude, any OpenAI-compatible endpoint, or a local Ollama. Answers
  cite items as chips; changes arrive as proposals you apply or skip. A privacy
  dial keeps note bodies on the machine. Voice in, voice out.
- **A status update in one click.** Done, in progress, blocked, overdue,
  decisions, the numbers that moved, the next seven days, as Markdown.
- **Your own extension harness.** New file format, widget, metric or command
  means one file registered on `window.AllDash`; nothing else changes.
- **A team platform when you want one.** Projects with pipelines, work and
  personal tasks, invoices, expenses, burn rate and margin, a daily update
  engine that writes a morning brief at 4 AM, and an append-only, hash-chained
  ledger of every decision an automation or an agent made, with a confidence
  score.
- **Agents as first-class users.** One MCP server gives Claude, GitHub Copilot
  and ChatGPT the same tools: read the brief, triage, add or close tasks, and
  log their own judgements to the ledger. A Claude Code plugin installs it in
  two commands.

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # node:test, no browser needed; CI also runs it in three timezones
npm run build
```

Open it, click **Load a sample project**, and you get six documents run through
the real parsers, not fixture data.

## What it looks like

![Today: agenda, focus list, reminders, pulse and recent activity, with person and topic filters above the board](docs/screenshots/today.png)

**Boards.** Groups, typed columns and seven views over the same rows. Open a
row for its columns, its conversation and everything that has changed on it.

<p>
  <img src="docs/screenshots/boards-table.png" width="49%" alt="A project board: groups, owner, status, timeline, priority and progress columns with per-group summaries" />
  <img src="docs/screenshots/boards-item.png" width="49%" alt="One row open: every column, an update with an @mention, and the activity log" />
</p>

**Stash.** Save the article, not the link. It reads offline, it is searched by
the words inside it, and a watched page shows you what moved since you read it.

<p>
  <img src="docs/screenshots/stash-search.png" width="49%" alt="Searching saved pages by a word that appears only in one article's body, with the match highlighted in the snippet" />
  <img src="docs/screenshots/stash-changes.png" width="49%" alt="A changelog re-checked: two blocks added since it was saved, marked in green with a plus" />
</p>

**Studio.** Shoot it, shrink it, play it. The player lives in the shell, so the
sound carries on while you work somewhere else.

<p>
  <img src="docs/screenshots/studio-camera.png" width="49%" alt="The camera mid-recording: preview, elapsed timer, photo and stop buttons, device and resolution pickers" />
  <img src="docs/screenshots/studio-compress.png" width="49%" alt="A compressed video: the plan, then the result showing the file went from 439 KB to 51 KB" />
</p>

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

**Phone and dark mode.** Same app. The rail becomes a bottom tab bar, the
widget grid goes single-column, and the theme follows the OS or the toggle in
Settings.

<p>
  <img src="docs/screenshots/mobile.png" width="24%" alt="Today on a phone" />
  <img src="docs/screenshots/mobile-triage.png" width="24%" alt="Triage on a phone in dark mode" />
  <img src="docs/screenshots/boards-mobile.png" width="24%" alt="A sprint board on a phone" />
</p>
<p>
  <img src="docs/screenshots/today-dark.png" width="49%" alt="Today in dark mode" />
  <img src="docs/screenshots/boards-dark.png" width="49%" alt="A board in dark mode" />
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

## Boards

A board is a shape: which columns exist, how rows are grouped, which views are
saved on it, and which rules watch it. The rows are ordinary entities with a
`meta.board` tag, which is the whole trick. A row you type into a board is a
task, so it shows up in Today, in Triage, on the timeline, in the brain's
Markdown files and in every export, and none of those had to learn what a
board is.

![The main table: groups, typed columns, per-group summaries and a row open in the item panel](docs/screenshots/boards-table.png)

### Columns

Twenty-two kinds. Six of them bind to a field the rest of the app already
reads, which is why a board row behaves like a task without any syncing.

| Kind | What it holds | Binds to |
| --- | --- | --- |
| Status | Your own coloured labels, each meaning open, in progress, done, blocked or cancelled | `status` |
| People | Names, with initials avatars and suggestions from everything you have imported | `people` |
| Date | One day | `due` |
| Timeline | A start and an end | `at` / `end` |
| Priority | Low to Critical | `priority` |
| Tags | Free labels | `tags` |
| Text, Long text, Email, Phone, Link | The plain ones | |
| Number, Rating, Progress, Checkbox | The countable ones, with a unit | |
| Dropdown | One or many labels | |
| Time tracking | A timer you start and stop, per row | |
| Dependency | Other rows on the board | |
| Formula | Arithmetic over the other columns | |
| Created, Last updated, Item ID | Read-only facts | |

Formulas are parsed and walked, never `eval`-ed, so a board someone sends you
cannot run code in your tab. `{Deal value} * {Probability %} / 100` is a
weighted forecast; `IF({Current} >= {Target}, "hit", "short")` is a judgement;
`DAYS({Start}, {End})` is a duration. Sixteen functions, the usual operators,
and a column reference in braces.

![A sales pipeline: deal value, probability, and a formula column carrying the weighted forecast, summed under the group](docs/screenshots/boards-formula.png)

### Seven views over the same rows

Every view reads one saved filter list, one sort and one group-by, so
switching view never changes what you are looking at, only how.

| View | What it is for |
| --- | --- |
| Table | Rows in groups, a summary line under each group and one under the board |
| Kanban | One lane per label; dropping a card writes that label, rules and all |
| Timeline | A Gantt chart with dependency elbows and a today line |
| Calendar | A month at a time; dropping a card writes that day |
| Chart | Count, sum or average, split by any column |
| Workload | Who is carrying what, by week, against a capacity you set |
| Form | A fillable form that adds a row, built from the same cell editors |

<p align="center">
  <img src="docs/screenshots/boards-kanban.png" width="49%" alt="Kanban lanes with cards carrying owner, dates and status" />
  <img src="docs/screenshots/boards-timeline.png" width="49%" alt="Gantt view with a bar per row and a zoom control" />
</p>
<p align="center">
  <img src="docs/screenshots/boards-chart.png" width="49%" alt="Chart view: deal value summed by stage" />
  <img src="docs/screenshots/boards-workload.png" width="49%" alt="Workload view: load per person per week against a capacity" />
</p>

### Rules

A rule is a trigger, some conditions and a list of actions, and it is data the
app interprets. Seven triggers (created, a status becomes something, a column
changes, someone is assigned, an item moves group, a date arrives, an item
goes overdue) and nine actions (set a column, move it, assign someone, notify,
post an update, create a subitem, create an item on another board, push its
dates, archive it). Date rules fire once a day per row, on the same minute
tick the reminders use.

Rules that trigger rules are allowed, three deep. Past that the chain stops,
because "when Done, set Not started" should not lock the tab.

![The automations panel: a live rule with its run count, and recipes to start from](docs/screenshots/boards-automations.png)

### The rest of it

Subitems, an updates feed where `@name` puts a notification in the bell, an
activity log that records every cell that changed and what it changed from,
bulk select with move, duplicate and delete, per-column summaries (sum,
average, median, breakdown, overdue, tracked time), drag to reorder or
regroup, board duplication with or without the rows, and CSV out.

CSV and Excel come in as boards, not just as tasks: the header row becomes
columns with the right kinds, a status-shaped column becomes labels with your
own vocabulary, and a small repeating vocabulary becomes a dropdown.

Nine templates cover the usual jobs, each one the smallest set of columns that
makes its job work: project plan, sprint backlog, sales pipeline, bug tracker,
content calendar, hiring pipeline, client work, goals and OKRs, and a plain
task list.

<p align="center">
  <img src="docs/screenshots/boards-form.png" width="49%" alt="A form view collecting a new lead" />
  <img src="docs/screenshots/boards-calendar.png" width="49%" alt="A content calendar with items on their publish dates" />
</p>

### What boards do not do

No permissions, guests or per-user views: this half of the app is one person's
browser, and everything in it stays there. No file uploads on a row, because
localStorage is the wrong place for binaries. No documents. If you need people
to share a board, that is what the platform tier below is for.

## Stash

A read-later that keeps the reading.

### Why this is not a browser

A page cannot embed most of the web. Anything with a login, and most of what
is worth reading, sends `X-Frame-Options: DENY` or a `frame-ancestors` policy,
and the browser renders a blank rectangle — the site telling your browser no,
with no trick around it from inside a tab. Even where framing is allowed, the
same-origin policy means the embedding page cannot read a word of what is in
there, and `fetch` to another origin is refused by CORS. A browser built
entirely in the browser tier is a bookmark list beside an empty box.

So the platform tier fetches the page, once, and hands back Markdown. The app
renders it, which means the app **owns** the text, which is what makes
everything below possible. An iframe would give a rectangle nobody can touch.

### What "better than Pocket" actually means

Pocket kept a link, a title and a snippet on somebody else's server. It shut
down in 2025 and exported its users a CSV of URLs with the articles gone.

| | Pocket | Here |
|---|---|---|
| What is kept | A link | The article text |
| Where | Their server | Your IndexedDB |
| Offline | The app's cache | Always, it never needed the network to begin with |
| Search | Title, tags, some excerpts | Every word of every article, BM25 ranked |
| The page changes | You never find out | A diff against the version you read |
| The page dies | So does your saved copy | You still have it |
| Your own writing | Not a thing | An idea is a first-class item |
| It shuts down | You get a CSV of links | The export carries the text |
| The item itself | A dead end | An entity: triage it, board it, cite it |

The last row is the one that only works here. A saved article is an ordinary
entity of type `page`, so it turns up in the Library, on the Timeline, in the
command bar and on a board without any of those learning what an article is.

![The stash: saved pages and your own ideas in one list, unread marked in the gutter](docs/screenshots/stash-list.png)

### Search

A real inverted index with BM25 ranking, built in memory from the archive on
load. Words in a title count triple. Rarer words score higher, and a short
document that says all your terms beats a long one that buries them, which is
what length normalisation is for. Quotes force an exact phrase:
`"the last line of defence"` is not the same query as `last line defence`.

The index is built over prose, not source. Nobody searches for `##`, and a
result snippet showing heading markers mid-sentence reads as a bug.

![Searching the words inside saved articles, not their titles](docs/screenshots/stash-search.png)

### Watching

Every save is a version. Re-fetching compares the new text against the one you
read and reports what moved, and a page that has not changed does not grow a
version — the fingerprint is checked first, so twelve hours of polling a static
page costs nothing.

The diff is over blocks, not lines. Prose rewraps, and a line diff of rewrapped
prose reports that the whole article changed, which is true and useless.
Comparison ignores whitespace, smart quotes and dash style, so a site that
switched its typography has not "changed". Added and removed blocks carry a
`+` or `−` as well as a colour, because roughly one man in twelve cannot tell
those two colours apart.

Something you had already read that changes underneath you goes back to unread.
That is the entire point of watching it.

![Two blocks added to a changelog since it was saved, each marked with a plus as well as a colour](docs/screenshots/stash-changes.png)

### Reading

Markdown rendered at a 66-character measure, 18px, 1.65 line height, with a
progress bar and nothing else competing. Reading time uses 238 words per minute,
which is the meta-analytic mean for silent reading of English non-fiction
(Brysbaert, 2019) rather than a number that looked about right.

Select a passage and it becomes a highlight. Highlights are anchored by their
quoted text, not by an offset, because an offset does not survive the page
being re-fetched — and the version you highlighted is still in the archive
either way.

![The reader: a 66-character measure, a progress bar, and a highlight kept below](docs/screenshots/stash-reader.png)

### What the stash does not do

No accounts, no sync, no sharing, no recommendations, no feed. No YouTube or
video saving — that is the Studio. No JavaScript-rendered pages unless the
platform tier has Firecrawl configured, because a static fetch gets a shell
from a single-page app and saying so beats saving an empty article.

> Brysbaert, M. (2019). How many words do we read per minute? A review and
> meta-analysis of reading rate. *Journal of Memory and Language, 109*, 104047.
> https://doi.org/10.1016/j.jml.2019.104047

## Studio

Media is the one half of this app that is about bytes rather than records, so
it gets its own storage and its own rules. A recording, a photo and a saved
YouTube link are all ordinary entities of type `media` — they appear in the
Library, on the Timeline, in search and on a board — but the bytes live in
IndexedDB and the entity only holds a pointer. Everything else in the app is a
few hundred kilobytes of text in `localStorage`; a minute of 1080p video is
twenty times that on its own, so the two never share a drawer.

![The camera recording, with the elapsed timer and the device and resolution pickers](docs/screenshots/studio-camera.png)

### Camera

`getUserMedia` for the preview, a canvas for stills, `MediaRecorder` for
clips. Pick a camera and a microphone, front or back, 1080p down to 480p,
sound on or off; pause and resume mid-recording. Every capture is written to
IndexedDB, gets a poster frame, and lands in the gallery and the Library.

A front camera is previewed mirrored, because an un-mirrored preview of your
own face is unsettling to look at. The saved photo is never mirrored — a
mirrored photo puts the writing in the room backwards.

Closing the view releases the camera. A lit indicator light on a view nobody
is looking at is not acceptable.

### Compression

Two engines behind one interface.

| | Built in | ffmpeg.wasm |
|---|---|---|
| Dependency | None | ~32MB from a CDN, once |
| Offline | Yes | Only after the first run |
| Speed | Real time — a ten-minute clip takes ten minutes | Much faster than the clip |
| Writes | WebM (VP9 or VP8) | MP4 (H.264) or WebM (VP9) |
| Default | Yes | Off until Settings → Media |

The built-in path decodes the source into a `<video>`, draws each frame the
decoder produces onto a canvas at the target size, captures that canvas as a
`MediaStream`, and records the stream at a chosen bitrate. Audio is routed
through a `MediaStreamDestination` so it is encoded without being played
aloud. The real-time cost is not a bug to optimise away: a `<video>` decodes
at the speed of the clip, and raising `playbackRate` would finish sooner and
produce a sped-up video, because the canvas stream is captured against the
wall clock.

Presets name the **short** edge, so a portrait phone clip scales the way you
expect instead of being squashed to letterbox height, and nothing is ever
upscaled. Bitrate comes from bits-per-pixel-per-frame rather than a fixed
number per preset, which is the only thing that survives a portrait source or
a 60fps one. The plan — output size, bitrate, estimated bytes, estimated time
— is shown before anything runs, because a person about to spend ten minutes
re-encoding deserves to know that first. The estimate is labelled as one: a
real encoder spends fewer bits on a static shot than on confetti.

![The plan before an encode: output size, bitrate, estimated bytes and estimated time](docs/screenshots/studio-compress-plan.png)

### The player

One `<audio>` element, created in a module and never mounted into React.
That is the whole trick behind music that keeps playing: a component that owns
the element stops the sound the moment you change view, so the element lives
outside the tree and React only reads its state. Queue, shuffle that pins the
current track first, repeat off/all/one, seek, volume, and the OS media keys
and lock screen through the Media Session API.

### YouTube

Paste a link — watch, share, Shorts, embed, music, playlist, or a bare
eleven-character id, with `?t=` start times in any of the three formats
Google uses. There is no search: that needs a Data API key, a Google Cloud
project and a daily quota, and pasting a link is one keystroke more.

This is the only surface in the browser app that talks to a server you did not
choose, so it is off until you switch it on in Settings → Media, and the copy
says plainly what changes when you do. Embeds use `youtube-nocookie.com`,
which sets no tracking cookies for someone who merely opens the view. Google
still sees which video you play and when.

![The gallery with a storage meter, and the player bar still running at the bottom](docs/screenshots/studio-gallery.png)

### Storage

Media lives in IndexedDB with a visible meter: what these files cost, what the
rest of the origin costs, and what is left. "Tidy up orphans" deletes bytes no
record points at any more — closing a tab mid-recording leaves some. "Ask to
keep it" requests `navigator.storage.persist()`, which stops the browser
evicting the library under disk pressure.

The workspace export does **not** carry the bytes. It keeps the records and
their titles; a single video is a thousand times the size of everything else
you have, and an export you cannot email is not an export.

### What the Studio does not do

No editing, no trimming, no filters, no green screen. No uploads, no sharing,
no accounts. No YouTube search, no downloads from YouTube. Nothing here leaves
the device except the YouTube embed you turned on yourself.

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

## The router

A gateway in front of the models. Most of what a gateway does is plumbing and
is done here in the obvious way; four things are done differently, and those
are the reason it exists.

### Twelve providers, three wire formats

Anthropic, OpenAI, Groq, Cerebras, Mistral, DeepSeek, Together, OpenRouter,
Azure, Ollama, LM Studio, and anything else that answers `/chat/completions`.

That reads like twelve integrations. It is three. Almost everything on that
list speaks the OpenAI wire format and differs by a base URL and a price list,
so the catalogue is a table of base URLs and the wire layer has three cases in
it. Saying so is more useful than implying each one was hard.

![The chain: three providers in order, each showing what a typical question would cost](docs/screenshots/router-chain.png)

### A 200 is not a success

Every gateway falls back on an HTTP error. That misses the failures that cost
you something: a stream cut off mid-sentence, an answer citing a task that
does not exist, a proposal with a field the store would reject, a model that
returned the empty string and a 200.

This app can check, because it knows what the answer was supposed to be
grounded in. Citations either resolve to real entities or they do not, and
that is a fact rather than a heuristic. So a reply is graded against the
workspace it claims to describe:

| Grade | What it means | Falls through |
|---|---|---|
| `ok` | Answered, and everything it cited exists | No |
| `empty` | 200, and nothing in the body | Yes |
| `truncated` | Hit the token cap mid-thought | Yes |
| `unresolved-citation` | Cited something that is not in your workspace | Yes |
| `bad-action` | Claimed changes, none survived validation | Yes |
| `refusal` | Declined, in under 320 characters | Yes, once |

The last row is deliberate: one model declining might be that model, two
independent models declining is a fact about the request, so the chain stops
rather than touring the catalogue looking for a yes. Truncation is checked
before citations, because a cut-off reply usually ends mid-citation and would
otherwise be reported as the wrong failure.

A graded failure counts against that provider's health exactly as a 503 would,
and three failures in a row rest it for five minutes instead of retrying it
into the ground on every request.

### The ceiling is checked first

Spend is reported after the fact everywhere else: you discover the bill by
receiving it. The useful moment is before the request, because that is the
only point at which anyone can still decide not to.

So the estimate is computed up front and the ceiling **refuses**. A budget
that only warns is a log line. The estimate uses the output cap rather than a
guess at likely output, because a ceiling has to be checked against the most a
call could cost or it is not a ceiling.

There is a third outcome besides allow and refuse. A model the catalogue does
not price cannot be checked, and waving it through silently would make the
ceiling a decoration — so that is surfaced and you decide once.

Refusing is also the *whole* response. It does not quietly drop to a cheaper
model on your behalf, because that changes the answer without telling you.

### A cache that expires when the facts do

Semantic caching embeds the question and returns a near neighbour's answer.
That needs an embedding model and a vector store — a service to deploy and a
bill to pay in order to save money — and it has a failure mode nobody
advertises. "What is our Q3 revenue" and "what is our Q4 revenue" are very
close in embedding space and have different answers. A threshold loose enough
to be useful is loose enough to return the wrong quarter, confidently.

This caches on the question *and* on a fingerprint of the workspace context
the answer was built from. Two things follow:

- It never answers a different question. The key is lexical, so there is no
  similarity threshold to tune and nothing to get wrong. Case, whitespace and
  trailing punctuation are normalised; nothing else is, so "what is done" and
  "what is not done" can never collapse into one key.
- **It expires itself.** Change a due date the answer depended on and the
  fingerprint changes, so the entry is gone. A gateway sitting in front of an
  API has no idea the underlying facts moved. This one is inside the app that
  moved them.

### Cost per answer that worked

The comparison table reports calls, success rate, latency, spend — and spend
divided by *good answers*, which is the number that actually decides anything.
A model at a third of the price that fails a third of the time is not cheaper,
and no per-token price list will tell you that. Your own ledger will.

Cache hits are recorded at zero with what they saved, so the cache's value
shows up in the same units as the spend it avoided.

![The comparison table: one model at 100% good, two at 0% marked in red, with cost per good answer](docs/screenshots/router-ledger.png)

### Honest limits

Prices are a table stamped with the date they were taken, and vendors change
them. Tokens are estimated from character and word counts, not counted, because
no tokeniser ships in 40KB — the estimate runs about 10% high, which is the
right direction for something that gates spending. Both numbers are close
enough to compare providers and not close enough to reconcile an invoice, and
the app says so on the screen rather than only here.

**Not built, on purpose:** OIDC directory sync, Prometheus scrape endpoints,
distributed tracing, and hierarchical team or customer budgets. They need a
server, an org chart and more than one user. This is one person's browser with
their own keys in it, and four impressive-looking features that fall over the
first time anyone leans on them would be worse than not having them.

## The brain

The app keeps a brain about the person using it: a profile, the people they
work with, the topics they carry, their rhythm, and a short list of opinions.
Nothing in it comes from a model. Every line is a rule over the entities, the
documents and a handful of usage counters, so each fact can be traced to the
rows it came from and recomputed from scratch at any time.

<p>
  <img src="docs/screenshots/brain.png" width="74%" alt="The Brain view: facts, opinions waiting for a yes or no, people and topics tables" />
  <img src="docs/screenshots/mobile-brain.png" width="24%" alt="The Brain view on a phone" />
</p>

Two grades of knowledge:

- **Facts** are recorded automatically and shown for editing or deletion:
  "Usually here 9-11am on Mon, Wed", "Works most with Priya, Sam", "Finished
  6 dated tasks in the app; 50% after the due date", "Plans about 3 days
  ahead", "Most meetings fall on Wednesdays".
- **Opinions** are judgements with evidence, proposed until you accept them:
  a tag that usually slips, a person carrying most of the open work, a
  weekday that holds most of your meetings, a habit of finishing late, a view
  you open more than Today. Dismiss one and it stays quiet until the evidence
  changes.

An accepted opinion changes the dashboard. Triage raises anything tagged with
a slipping tag, owned by an overloaded person, or due on your busiest meeting
day one step earlier, and the row says why ("Raised by your brain: #infra
usually slips"). "You finish most tasks late" moves reminders to a day ahead.
"You open Triage more than Today" makes Triage the start view. Widening the
range, likewise. Forget an opinion and the setting goes back.

![Triage rows raised by the brain, each saying why](docs/screenshots/brain-triage.png)

The whole brain is a folder of Markdown files, `README.md`, `profile.md`,
`habits.md`, `insights.md`, `people/<name>.md`, `topics/<tag>.md`, each with a
small front matter block, regenerated whenever something learned changes. In
Chrome and Edge, *Connect a folder* keeps them written to a directory on your
disk (File System Access API; the handle survives reloads, the browser asks
for permission again after a restart). Everywhere else, *Download .zip*. Your
own notes under any file are kept and re-attached on every regeneration, so
`people/priya-raman.md` can carry "Prefers async updates" beneath the numbers.

The same files reach agents: the MCP server's `workspace_brain` tool and the
`alldash://workspace/brain` resource render them from a workspace export, and
the browser assistant's context carries the facts and accepted opinions unless
you turn that off in Settings. The store keeps only what cannot be recomputed:
your name, role and focus, your notes, which opinions you accepted or
dismissed, and the usage counters. *Reset the brain* clears exactly that.

## The agents

Five of them, over a memory that has to earn its place. The whole thing runs
with no API key and no network; a model, when you have one configured, writes
the prose and nothing else.

<p>
  <img src="docs/screenshots/agents-answer.png" alt="An answer with every claim cited, the contradictions found, and what the Critic cut" width="100%">
</p>

| Agent | What it does | Ever a model? |
|---|---|---|
| **Librarian** | Finds passages across your records, your saved articles and the genome, one BM25 index over all three | Never |
| **Analyst** | Contradictions, agreement, and words in your question that appear in nothing you saved | Never |
| **Tutor** | Cuts spaced-repetition cards from your own sentences and schedules them with SM-2 | Never |
| **Planner** | Turns a contradiction into a task and an agreement into a claim worth keeping. Proposes; never writes | Never |
| **Critic** | Cuts every claim that cannot be traced to a passage that was actually retrieved | Never |

Retrieval and verification are never a model's job, however good the model is.
A retriever that invents a passage has not made a mistake — it has removed the
only reason to trust anything downstream of it. So the model gets exactly one
job, writing, and its output goes through the same Critic as everything else:
if a sentence cites something that was not retrieved, it is cut before you see
it, and if the whole draft fails, the assembled answer stands instead. Turning
the model off changes how the answer reads, not what it says.

**Contradictions are found by arithmetic, not by opinion.** Two passages about
the same subject where one negates the other, or where both state a figure in
the same unit and the figures differ. Polarity is judged on the sentence that
is actually about the shared subject, because a forty-line meeting note
contains the word "not" somewhere and judging the whole document by that says
it denies everything in it. Everything subtler is left alone: a contradiction
detector that cries wolf gets switched off in a week and then catches nothing.

### The genome

A claim is a Markdown file with front matter — a generation, the claim it
descended from, the records it was drawn from, and a tally of how often it has
been cited, confirmed and contradicted since.

```md
---
id: gene_1xbdan21sjtahg
generation: 3
parents: [gene_9fz2k1, gene_44ba0x]
sources: [risk_hs3t2v2zvjyx, task_imdss133ulpc]
cited: 14
confirmed: 9
contradicted: 1
retired: false
---

The rollback script is the riskiest part of the Atlas cutover.
```

<p>
  <img src="docs/screenshots/agents-genome.png" alt="The genome: claims ranked by fitness, with their generation and evidence" width="100%">
</p>

That tally is the point. **Fitness is support × usefulness × recency:**

- **Support** is confirmed against contradicted, Laplace-smoothed — a new claim
  sits at 0.5 rather than at certainty, and one contradiction against nine
  confirmations moves it to 0.77 rather than throwing it out. One person
  disagreeing once is not a refutation.
- **Usefulness** saturates. The difference between never cited and cited twice
  matters; the difference between the fortieth and the forty-first does not.
- **Recency** decays on a 90-day half-life.

Below a floor a claim is **retired** — archived, out of retrieval, never
deleted. The floor is set against the decay curve rather than picked: a claim
nothing ever confirmed and nothing ever cited lasts about 95 days, and one
confirmation buys it 132. A passing thought lasts a quarter; something you
agreed with once lasts two.

**Rewording does not edit a claim, it has a child.** The parent is recorded,
the counters carry over at half, and the lineage stays in the file. Every AI
memory feature can tell you what it currently thinks. This one can tell you how
it changed its mind.

Matching is on the claim text, not on similarity. A threshold loose enough to
match a rewording is loose enough to merge two claims that disagree, and
merging those is how a memory starts lying.

A claim is an ordinary entity, the way a saved article is, so it turns up in
the Library, on the Timeline, in the command bar and in the export without any
of them learning what a claim is.

### Study

<p>
  <img src="docs/screenshots/agents-study.png" alt="A cloze card cut from a saved passage" width="100%">
</p>

Cards are cut from your own sentences by deleting the load-bearing term — the
figure, the name, the rare word — not written by a model. A cloze made from a
sentence you saved has an answer that is certainly in your material; a question
a model generated has an answer that might be. Scheduling is SM-2 (Wozniak &
Gorzelanczyk, 1994), unmodified: the interesting work is choosing what to ask,
and the interval arithmetic has been settled for thirty years.

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
| `g` then `t` `w` `r` `l` `a` `k` `m` `d` `b` `g` `s` | Today, Boards, Triage, Timeline, Analytics, Stash, Studio, Library, Brain, Agents, Settings |
| `Esc` | Close whatever is open |

## Layout

```
src/
  core/       registry (the harness), store, query engine, time, format, ids
  agents/     the five: librarian, analyst, tutor, planner, critic, and the pipeline
  genome/     claims as Markdown files, and the selection that keeps them honest
  data/       entity schema, the sample project
  ingest/     parser registry entry point, shared text and table readers, zip, export detection
  engine/     metrics, reminders, insight rules, triage
  work/       boards: column types, view queries, the rule engine, formulas, templates, CSV
  media/      blob storage, the two encoders, camera and recorder, the player, YouTube links
  stash/      the page archive, readability, the search index, the block diff
  ai/         providers (fetch + streaming), context builder, reply protocol, proposals, key storage
              router: provider catalogue, cost and budget, the plan, response grading, the grounded cache
  ui/         shell, dashboard, command bar, inspector, assistant, views, widgets, charts
  ui/work/    the seven board views, cell editors, the item panel, the rule builder
  ui/media/   camera, compressor, gallery, YouTube, the shell player
  ui/stash/   the saved list, the reader, highlights, the change view
  styles/     tokens, base, layout, components, viz, media, stash
tests/        node:test cases over parsing, querying, analytics, triage, boards, media, the stash, the router, the brain and the assistant protocol
backend/ frontend/ mcp/ k8s/   the platform tier, described in its own section below
```

## Deliberately not here

No drag-and-drop library. Widgets and board rows reorder with buttons that work
identically with a mouse, a thumb and a keyboard; dragging is the fast path on
top, built on the browser's own drag events. No state library — one object, one
`useSyncExternalStore`. No chart library. No router. No backend. No AI SDK: the
three providers differ by a URL, a header and a line format, and a single
line reader serves all of them. No model-driven writes: the assistant proposes,
a person applies. No PDF reading:
extracting text from PDFs without a dependency is unreliable, and shipping
something that half-works would be worse than saying so. Add it as a parser
plugin when you need it. No video editor: the Studio compresses and records,
and a trim UI that cannot cut on a keyframe is a toy. No YouTube search, which
would need a Google Cloud project and a daily quota to save you pasting a
link.

## Platform tier: API, workspace and EKS

The browser app needs nothing but a browser. For a team that wants shared
state, scheduled processing, money tracking and an API that agents can call,
the repository also carries a containerised platform: a FastAPI service, a
Celery worker, a hash-chained AI audit ledger, a Next.js 16 workspace, and the
Kubernetes manifests to run it on AWS EKS. The two tiers share the entity idea
and the MCP server exposes both.

![The workspace: project pipelines, the day's checklist, the AI audit stream and the margin ribbon](docs/screenshots/workspace.png)

### Repository tree

```
The-All-Dash/
├── src/                        Browser app (React + Vite): parsers, engines, widgets, assistant
│   ├── brain/                  learn.js (rules), markdown.js (files), sync.js (folder), bundle.js (zip)
│   └── work/                   columns.js (22 kinds), query.js, automations.js, formula.js, templates.js, store.js
├── public/  tests/  docs/      PWA assets, node:test suite, screenshots, docs/openapi.json
├── backend/                    Platform API and worker (Python 3.12)
│   ├── app/
│   │   ├── main.py             FastAPI factory, request-id middleware, routers
│   │   ├── config.py           ALLDASH_* settings; production refuses to start without keys
│   │   ├── db.py  models.py    Async SQLAlchemy 2.0; money in cents; string enums with checks
│   │   ├── schemas.py          Pydantic v2, strict (unknown fields rejected)
│   │   ├── security.py         X-API-Key, constant-time compare
│   │   ├── audit.py            The ledger: SHA-256 over row + previous hash, advisory-locked appends, verify
│   │   ├── routers/            /projects /tasks /invoices /expenses /ai-audit-logs /daily /finance /web /healthz /readyz
│   │   ├── web/                guard (SSRF), fetch (robots, limits), html→Markdown, sitemap, firecrawl, llm, service
│   │   ├── services/           daily.py (the daily update engine), finance.py (burn rate, margin)
│   │   └── worker.py           Celery app, beat schedule, three periodic decisions
│   ├── alembic/                Migrations; 0001 also installs the append-only trigger on ai_audit_logs
│   ├── scripts/seed.py         Sample workspace, idempotent
│   ├── tests/                  pytest: auth, CRUD, pipeline, checklist, invoices, finance, chain, brief
│   └── Dockerfile              Multi-stage slim, uid 10001, tini, healthcheck
├── frontend/                   Next.js 16 App Router + Tailwind (TypeScript strict, React 19)
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
│   └── secrets.example.yaml    Templates for the five Secrets (never applied as-is)
├── docker-compose.yml  .env.example
├── .mcp.json  .vscode/mcp.json  .claude/skills/all-dash/  .github/copilot-instructions.md
├── .claude-plugin/             marketplace.json + plugin.json: `/plugin marketplace add drewc611/The-All-Dash`
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

**Frontend (Next.js 16).** Left: project pipelines as stage tracks with task
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

# 2b. NetworkPolicies are inert on a stock EKS cluster: turn enforcement on in the VPC CNI
#     (or install Calico). Without this the default-deny policies do nothing.
aws eks update-addon --cluster-name $CLUSTER --addon-name vpc-cni \
  --configuration-values '{"enableNetworkPolicy":"true"}' --resolve-conflicts PRESERVE

# 3. Bootstrap secrets (values from a password manager or AWS Secrets Manager; never from git)
PG_PASS=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-40)
REDIS_PASS=$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-40)
API_KEY=$(openssl rand -hex 32)
MCP_TOKEN=$(openssl rand -hex 32)
WEB_PASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
kubectl -n alldash create secret generic postgres-credentials \
  --from-literal=POSTGRES_USER=alldash \
  --from-literal=POSTGRES_PASSWORD="$PG_PASS" \
  --from-literal=ALLDASH_DATABASE_URL="postgresql+asyncpg://alldash:$PG_PASS@postgres.alldash.svc.cluster.local:5432/alldash"
kubectl -n alldash create secret generic alldash-api \
  --from-literal=ALLDASH_API_KEYS="$API_KEY" --from-literal=BACKEND_API_KEY="$API_KEY" \
  --from-literal=ALLDASH_FIRECRAWL_API_KEY="" \
  --from-literal=ALLDASH_LLM_PROVIDER="" --from-literal=ALLDASH_LLM_MODEL="" \
  --from-literal=ALLDASH_LLM_API_KEY="" --from-literal=ALLDASH_LLM_BASE_URL=""   # web tier extras, fill in to turn on
kubectl -n alldash create secret generic alldash-mcp --from-literal=MCP_AUTH_TOKEN="$MCP_TOKEN"
kubectl -n alldash create secret generic redis-credentials \
  --from-literal=REDIS_PASSWORD="$REDIS_PASS" \
  --from-literal=ALLDASH_REDIS_URL="redis://:$REDIS_PASS@redis.alldash.svc.cluster.local:6379/0"
kubectl -n alldash create secret generic alldash-frontend \
  --from-literal=FRONTEND_AUTH_USER=drew --from-literal=FRONTEND_AUTH_PASSWORD="$WEB_PASS"   # the workspace login

# 4. Storage class and snapshot class (cluster-scoped, applied with the base)
# 5. Point the overlay at your registry, host and VPC CIDR (PUBLIC_HOST and VPC_CIDR in config-patch.yaml)
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

### Security notes

- **The workspace has a login.** `frontend/proxy.ts` enforces HTTP Basic
  auth from the `alldash-frontend` Secret and refuses to serve in production
  until it is set (`FRONTEND_AUTH_DISABLED=true` opts out behind an
  authenticating proxy such as ALB OIDC or oauth2-proxy). Mutating calls to
  `/api/*` must come from the same origin (Sec-Fetch-Site or Origin), every
  page carries a nonce-based Content-Security-Policy, HSTS, `frame-ancestors
  'none'`, and the health endpoints stay open for the kubelet.
- **The API is not on the Ingress.** Only the frontend and the MCP server are
  published; the API is reached on the cluster network by pods that hold the
  key. Every request needs `X-API-Key` (compared as SHA-256 digests in
  constant time), bodies are capped at 1 MiB (413) and must declare a length
  (411), the audit `inputs` payload at 64 KiB, and `/docs` and `/openapi.json`
  are off in production unless `ALLDASH_EXPOSE_DOCS=true`. `X-Forwarded-*`
  headers are trusted from loopback only; set `FORWARDED_ALLOW_IPS` when a
  proxy sits in front.
- **The MCP server fails closed.** HTTP mode will not start without
  `MCP_AUTH_TOKEN`; `MCP_ALLOW_UNAUTHENTICATED=true` is for a laptop and then
  binds to 127.0.0.1 with localhost-only Host headers (DNS rebinding cannot
  reach it). `MCP_ALLOWED_HOSTS` pins host names on the cluster.
- **Redis and Postgres both need a password**, from the `redis-credentials`
  and `postgres-credentials` Secrets, on top of the default-deny
  NetworkPolicies. Celery accepts JSON only.
- **NetworkPolicies need an enforcer.** EKS ignores them until the VPC CNI's
  network-policy feature (or Calico) is on; the playbook's step 2b turns it
  on. The load balancer's CIDR is `VPC_CIDR` in the prod overlay.
- **Pods** run as uid 10001 on a read-only filesystem with all capabilities
  dropped, no service-account token, restricted Pod Security, and CPU and
  memory limits; the workflow token is read-only.
- **The browser app** never sends an API key over plain HTTP to anything but
  localhost, keeps keys out of workspace exports, and treats model output as
  proposals.

### The web tier: search, scrape, map, crawl, batch, extract, agent

`/web/*` turns the web into input. Everything native is deterministic and
needs no account; the two paid dependencies are optional and their absence
is reported with a 501, never hidden.

| Endpoint | What it does | Needs |
|---|---|---|
| `POST /web/scrape` | One URL to Markdown, plain text, links or HTML. `render: true` runs JavaScript first; `formats: ["screenshot"]` returns an image. | Nothing; render and screenshot need Firecrawl |
| `POST /web/map` | Every URL a site publishes: its sitemaps (from robots.txt, `/sitemap.xml`, sitemap indexes), then the links off the front page. `search` filters. | Nothing |
| `POST /web/crawl` | Breadth-first over one site, bounded by `limit`, `max_depth` and path globs (`include: ["/docs/*"]`). Over the synchronous cap, or with `?async=true`, it becomes a worker job. | Nothing |
| `POST /web/batch` | Up to 1000 URLs, a few at a time, in order. Large batches become jobs. | Nothing |
| `POST /web/search` | Web search with page content. | Firecrawl |
| `POST /web/extract` | Scrape up to 10 URLs, then answer a prompt or fill a JSON Schema. | A model |
| `POST /web/agent` | Describe what you need. With `start_url` it maps the site, ranks pages against the goal, reads them and extracts; without one it searches. | A model (search: Firecrawl) |
| `GET /web/jobs/{id}` | Status and pages of a crawl or batch job. | |
| `GET /web/capabilities` | What this deployment has switched on. | |

**How it stays safe.** Every URL, and every redirect hop, is resolved and
checked before a byte is fetched: http and https only, public addresses
only, never the cluster's own names, never link-local (instance metadata)
or private ranges. robots.txt is honoured (including `Crawl-delay`), one
request per host per half second, a 5 MiB cap, a 20-second timeout, and the
NetworkPolicies let the API and worker reach only public 80 and 443. Extract
and agent are decisions made on your behalf, so each one lands in the audit
ledger with the model, the sources and the prompt.

<p>
  <img src="docs/screenshots/import-url.png" width="49%" alt="Import from the web sheet with a page address and a crawl option" />
  <img src="docs/screenshots/library-web.png" width="49%" alt="Library after importing a page and crawling a site: documents with source links and the items they produced" />
</p>

**Why it matters.** Most of what a project needs to know is on a page
somewhere: a vendor's status page, a public roadmap, a wiki, a changelog, a
tender, a competitor's pricing. Scrape puts one of those into the dashboard
in the shape the rest of the app already understands, crawl brings a whole
docs site, map tells you what a site has before you read it, and batch
keeps a list of pages fresh. With a model configured, extract turns "what
does the team plan cost" into a JSON answer with its sources, and agent
does the map-read-extract loop from a sentence. In the browser app, *Import
a web page* (first run, Library, the command bar) uses the same endpoints
through Settings → Platform, and importing a page again refreshes what it
produced.

```bash
# Turn on the extras (both optional)
export ALLDASH_FIRECRAWL_API_KEY=fc-...                       # search, render, screenshots
export ALLDASH_LLM_PROVIDER=anthropic ALLDASH_LLM_MODEL=claude-sonnet-5 ALLDASH_LLM_API_KEY=sk-ant-...   # extract, agent
# or ALLDASH_LLM_PROVIDER=openai with ALLDASH_LLM_BASE_URL for any chat-completions endpoint, or ollama

curl -s -H "X-API-Key: $KEY" -X POST localhost:8000/web/scrape -d '{"url":"https://example.com/docs"}' -H 'content-type: application/json'
curl -s -H "X-API-Key: $KEY" -X POST localhost:8000/web/crawl  -d '{"url":"https://example.com","limit":50,"include":["/docs/*"]}' -H 'content-type: application/json'
curl -s -H "X-API-Key: $KEY" -X POST localhost:8000/web/agent  -d '{"goal":"pricing per seat and the enterprise terms","start_url":"https://example.com"}' -H 'content-type: application/json'
```

From Claude, Copilot or ChatGPT the same operations are `web_scrape`,
`web_map`, `web_crawl`, `web_batch`, `web_job`, `web_search`, `web_extract`,
`web_agent` and `web_capabilities` on the MCP server.

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

**The five agents are on it too.** `agents_ask` runs the Librarian, Analyst,
Tutor, Planner and Critic over the exported workspace and hands back an answer
where every claim carries the id of the record supporting it — anything that
could not be traced has already been cut. The `genome_*` tools read and move
the claims they have learned, `study_*` is the spaced-repetition queue, and
`alldash://workspace/genome` serves the whole genome as the directory of
Markdown files it is stored as.

Three rules hold over MCP exactly as they do on screen. No model is called —
the caller is already one, and putting two in series with nobody checking the
first is how a citation stops meaning anything. `agents_ask` writes nothing,
including the crediting the browser does automatically, so an agent cannot
change which claims survive by asking about them often enough. And the Planner
still only proposes: `agents_apply` is the writing half, and it is a separate
call.

### Install the Claude plugin

The repository is also a Claude Code plugin marketplace. Two commands install
the skill and the MCP server, in the terminal, the desktop app or Claude Code
on the web:

```
/plugin marketplace add drewc611/The-All-Dash
/plugin install all-dash@the-all-dash
```

Then export your workspace from the app (Settings → *Your data* → Export) and
save it as `~/.all-dash/workspace.json`. To try it before you have used the
app at all, seed the sample project instead — no browser needed:

```bash
npm run sample-workspace          # writes ~/.all-dash/workspace.json
```

Or point the server at a running platform:

```bash
export ALLDASH_WORKSPACE_FILE=~/Downloads/all-dash-2026-09-08.json   # or the default path above
export ALLDASH_API_URL=http://localhost:8000 ALLDASH_API_KEY=...   # optional: the API is not on the Ingress;
                                                                      # on a cluster use kubectl port-forward svc/backend 8000, or the in-cluster URL from a pod
```

Ask "what's late?", "review my day", or "add a task to send the deck by
Friday". The skill has Claude cite items by title, propose before it writes,
and log every judgement to the ledger with a confidence score. Tools show up
under `all-dash`; the `morning-review` and `explain-signal` prompts come with
it.

**On your phone.** The Claude iOS and Android apps do not run plugins, but
they do connect to remote MCP servers: deploy the platform, then in the Claude
app open Settings → Connectors, add `https://<your-host>/mcp`, and paste the
bearer token from the `alldash-mcp` Secret. The same tools appear in chat.

## Get it on your phone

The build ships a web manifest, PNG icons for every launcher, home-screen
shortcuts and a small service worker, so it installs to a phone's home screen
or a desktop dock and opens offline. The worker caches the app shell only;
there is no network traffic to cache, and your workspace never leaves the
device — with one exception you have to switch on yourself: turning YouTube
on in Settings → Media embeds a player from `youtube-nocookie.com`, and from
then on Google sees which video you play and when. Nothing else about the
workspace is sent with it, and the switch is off until you flip it.

1. Serve the `dist/` folder over HTTPS from the root of a host (Netlify,
   Vercel, S3 + CloudFront, a GitHub Pages *user* site, or `npm run preview`
   on your LAN for a try). The manifest, service worker and assets use
   root-relative paths, so a sub-path such as `github.io/The-All-Dash/`
   needs `base` set in `vite.config.js` and the paths in
   `public/manifest.webmanifest` and `public/sw.js` adjusted to match.
2. **iPhone or iPad:** open it in Safari, tap Share, then *Add to Home Screen*.
3. **Android:** open it in Chrome and tap *Install app* in the banner or the
   menu.
4. **Mac or Windows:** Chrome and Edge show an install icon in the address bar.

Long-press the installed icon for the **Today**, **Triage** and **Analytics**
shortcuts. The app keeps working with no connection; reminders fire while the
tab or the installed app is open.

To use the dashboard from the Claude app on your phone, deploy the
[platform tier](#platform-tier-api-workspace-and-eks) and add
`https://<your-host>/mcp` as a connector in Claude's settings (see
[Install the Claude plugin](#install-the-claude-plugin)).

## Storage

`localStorage`, under `all-dash:v1`. Export and restore as JSON from Settings →
*Your data*. Clearing site data clears the workspace, so export before you do
anything drastic.
