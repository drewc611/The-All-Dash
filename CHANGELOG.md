# Changelog

All notable changes to the browser app are recorded here, in the format from
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning is
[semver](https://semver.org/spec/v2.0.0.html), with the `0.x` caveat that a
minor bump may break things.

Entries say what changed for a person using the app. A flag reaching a wider
channel gets its own line, because that is the change that affects people —
merging the code did not.

Channels and how a feature graduates between them: [docs/RELEASING.md](docs/RELEASING.md).

## [Unreleased]

### Added

- **Telamate** (`telamate`, beta). A self-hosted AI front desk that exports
  All Dash entities directly: callbacks as tasks, conversations as notes,
  contacts as people, daily counters as metrics. The Library now names its
  export, Settings → *Telamate* takes a URL, an admin token and a pull
  interval, and the same pull is a command. Three widgets - *Callbacks due*,
  *Conversations by channel*, *Front desk today* - and three metrics (open
  callbacks, conversations, callbacks closed) sit behind the flag.

  The token is kept with the other keys, never in a workspace export, and a
  restored file may not set the Telamate URL, for the reason the platform URL
  is refused: it decides where a secret is sent.

- **Plugins can ingest and draw.** `AllDash.ingestFile` and
  `AllDash.ingestText` run a plugin's own records through the same path a
  dropped file takes, and `AllDash.h` (React's `createElement`) lets a
  `<script>`-tag widget return an element without a build step.

- **The sample project now comes with a board.** "Load a sample project" filled
  Today, Triage, the Timeline and Analytics and left Boards completely empty:
  you clicked **Project plan** and got eight column headings and "0 items".
  Boards is the largest surface in the app - seven view kinds over the same
  rows, typed columns, rules - and the one-click demo never showed any of it.

  Ten rows across four groups, shaped so each view says something: four owners
  so Workload has more than one bar, every status used so no kanban column is
  empty, timelines from three weeks back to five weeks out so the Gantt has
  bars either side of today, a real dependency chain because the template's own
  blurb promises one, and progress values that are not all 0%.

  Templates still ship with no rows. That is a different job and a deliberate
  one: an empty board you understand beats a full one you have to clear out.

- **Rounds** (`rounds`, alpha). Standing work: a question asked of this
  workspace on a cadence, reported back with the records behind every answer.
  Daily, weekdays, weekly or monthly.

  Two things make it worth having rather than a reminder to ask the question
  yourself.

  **Every finding carries its sources, and the ones that do not are shown
  anyway.** The Critic cuts claims that cite nothing, or cite something that
  was never retrieved. Those cuts are the most interesting part of a brief -
  they are where the answer wanted to say something it could not stand up - so
  they are kept under their own heading rather than deleted on the way out. A
  clean-looking report with the doubtful half removed is how these things come
  to be believed.

  **Nothing is spent without a ceiling.** A round with no ceiling reads the
  workspace and does not call a model, which is what most of them should do:
  retrieval and the Critic are local, so a standing question about your own
  records costs nothing to ask every week. A round with a ceiling refuses
  before the call rather than after, against the cap on the reply rather than
  a guess at its length, because the worst case is the only number anyone can
  promise.

  A missed period is not a backlog. Away for a week, a daily round is owed
  once on your return, not seven times: nobody wants seven briefs about a
  Tuesday that is over.

  **What it is not.** There is no server here, so a round runs the next time
  you open the app after it comes due, not at nine o'clock while the laptop is
  shut. The view says so rather than implying a schedule it cannot keep. And
  with no model configured a finding is the passage it was retrieved from,
  which is accurate and is not prose - the source chip opens the record where
  the rest of it lives.

## [0.2.1] — 2026-09-15

A patch for one thing: v0.2.0 shipped without its container image.

### Fixed

- **The arm64 image no longer rebuilds the whole app under emulation.** The
  Dockerfile's build stage runs `npm ci` and vite, and everything it produces
  is static — HTML, CSS, JavaScript, images, none of it architecture-specific.
  It was not pinned to the build machine, so a `linux/arm64` build ran all of
  Node under QEMU to arrive at byte-identical output. That took 83 seconds one
  day and twenty-five minutes another; on v0.2.0 it passed thirty and hit the
  job's timeout. Pinning the stage to `$BUILDPLATFORM` leaves only the busybox
  runner stage per-architecture, and that stage does nothing but copy files.

### Known issue in v0.2.0

The v0.2.0 release page and its notes name `ghcr.io/drewc611/all-dash:0.2.0`
and `:latest`. **Neither tag exists.** The image build was cancelled at 29
minutes 41 seconds by the timeout that exists precisely so a wedged image
cannot hold a finished release hostage, and the release published thirteen
seconds later with all eight installers and no image. The notes were written
before the run, which is the same mistake as describing a build you have not
watched finish.

All eight v0.2.0 installers are real and unaffected. For the container, use
`:0.2.1` or `:latest` from this release.

## [0.2.0] — 2026-09-15

The first stable release, and the first one you can install rather than build.

Everything below has been in the code since the alpha and gated behind a flag.
What changes here is that the flags are on for everybody and there are
installers to download.

### Focus

A Pomodoro timer that knows which task you are working on, so a finished
session is attached to something rather than to a number in a log.

- **The timer is task-linked.** Start it against a task and the minutes land on
  that task.
- **A wallpaper per time of day**, drawn from your own Studio photographs when
  you have one taken in that hour, and from seven bundled photographs when you
  do not. All seven are works of the US National Park Service or Fish and
  Wildlife Service, public domain by statute — credits and sources in
  [`public/wallpapers/CREDITS.md`](public/wallpapers/CREDITS.md). A browser
  fetches one, averaging 118KB, and the service worker keeps it.
- **Three Analytics widgets** chart what the timer recorded: minutes per day,
  minutes per task, and the hours of the day you actually focus in. Every
  bucket is your local day, not UTC, so a late evening session counts towards
  the evening you had.
- **Glass** across the rail, topbar, cards and overlays. Tables, charts, code
  and form controls keep solid backing, because translucency is for chrome you
  look past and never for data you read. `prefers-reduced-transparency` turns
  it solid, and Settings → Appearance → Transparency is the switch beside it
  for anyone whose system has no such setting.

### Install it

- **Desktop.** `.dmg` for macOS on both Apple Silicon and Intel, `.msi` and an
  installer `.exe` for Windows, `.deb`, `.rpm` and an AppImage for Linux. Built
  with [Tauri](https://tauri.app), so the app uses the webview your operating
  system already has: the `.deb` is 4.2MB where an Electron equivalent would be
  around 150MB.
- **Container.** `ghcr.io/drewc611/all-dash:latest`, for amd64 and arm64.
- **Self-host.** A web tarball on the release page — serve the directory.

Nothing is signed yet, so macOS and Windows warn on first open.
[docs/PACKAGING.md](docs/PACKAGING.md) says exactly which certificates change
that and what they cost.

### Release process

- **Channels are read off the version and nothing else.** A build is alpha,
  beta, rc or stable because of its own version number, so it cannot claim a
  channel it does not have. Settings → Build shows which one you are on.
- **Flags carry a maturity.** Code reaches every channel the moment it merges;
  what gates exposure is how finished a feature says it is. Cutting a release
  therefore cannot widen an unfinished feature's audience by accident — that
  takes a deliberate one-line promotion. Overrides in Settings win in both
  directions, including turning a finished feature off because it is in the way.
- **`npm run release`** refuses a version that is not a legal step from the
  current one, and writes `package.json` and `src-tauri/tauri.conf.json`
  together.

### Licence

Proprietary, all rights reserved, © 2026 Andrew Clark. Installing a copy from
a channel the owner operates buys you the right to run it and to back it up.
**Your data stays yours** — the licence claims nothing over what you put into
the app and export is explicitly permitted. `NOTICE` covers what `LICENSE`
cannot: the bundled photographs are public domain under 17 U.S.C. § 105, and
dependencies keep their own terms.

### Flags in this build

| Flag | Maturity | On in |
|---|---|---|
| `focus` | stable | every channel |
| `focus.wallpaper` | stable | every channel |
| `focus.glass` | stable | every channel |
| `glass.app` | stable | every channel |

## [0.2.0-rc.6] — 2026-09-15

One asset on the rc.5 page could not tell you what it was for.

### Fixed

- **No two builds can overwrite each other on the way to the release.** rc.5
  published a single `The All Dash.app.tar.gz`, and both Mac runners produced a
  file by that name — the macOS `.app` tarball carries no architecture. Because
  `download-artifact` was extracting every artifact over one tree, the second
  download replaced the first during extraction, before the collision guard had
  anything to compare. Whichever one survived reached the release page with
  nothing in its name to say which chip it was built for. Each artifact keeps
  its own directory now, so the flatten is the only thing that merges them, and
  it fails on a collision rather than picking a winner.

### Removed

- **The macOS `.app` tarball.** It exists for the built-in updater, which this
  repo does not turn on, and it was the one bundle whose name could not be told
  apart between the two Mac targets. The `.dmg` is the macOS download, one per
  architecture, and both are on the release page.

## [0.2.0-rc.5] — 2026-09-15

Every installer the matrix builds now actually reaches the release page.

### Fixed

- **The desktop installers are attached, not just built.** v0.2.0-rc.4 compiled
  all four desktop targets, uploaded them, and published exactly one asset: the
  web tarball. `upload-artifact` roots an artifact at the least common ancestor
  of the paths it matched, and the desktop job matches seven globs that all sit
  under `.../release/bundle/`. So each artifact arrived as `deb/`, `rpm/`,
  `dmg/`, `msi/` and `nsis/` directories rather than as bare files;
  `files: artifacts/*` matched those directories, and the upload action skips a
  directory without saying anything. The web tarball was the only artifact that
  was already flat, which is the only reason anything was published at all. The
  bundles are flattened before the notes are written, so the downloads table and
  the assets are now built from the same list. Two bundles landing on the same
  name is an error rather than a silent loss of one of them.

## [0.2.0-rc.4] — 2026-09-15

The macOS installers, and a release that cannot be held hostage by a slow
image. Both found by releasing rather than by reading.

### Fixed

- **macOS installers now build.** Both Mac runners compiled Rust successfully
  and then failed bundling with `failed to import keychain certificate`. An
  absent GitHub secret is an **empty string**, not an absent variable, so
  `APPLE_CERTIFICATE=""` made tauri try to import an empty certificate and take
  the whole bundle down. `docs/PACKAGING.md` claimed the build produced
  installers without the secrets; it did not, and now it does. The unsigned
  build is not the signed one with fewer secrets — it is a build that must not
  be handed them at all, so there are two, and the job picks one.

- **A slow container build no longer blocks a finished release.** `publish`
  waits on the image job completing, and the emulated arm64 half built in 83
  seconds once and then sat for twenty-five minutes on an identical commit when
  several releases ran at once and contended for the same build cache. With
  GitHub's six-hour default timeout that is a release held hostage with its
  installers already built. Thirty minutes now, and `publish` still does not
  gate on the image's conclusion.

## [0.2.0-rc.3] — 2026-09-15

The second thing the rc turned up. Every other job had already succeeded.

### Fixed

- **The release published nothing, at the last step, with everything built.**
  `verify` passed, the tag was created, the web bundle and the multi-arch
  container both succeeded — and then `publish` failed downloading artifacts.
  Not the ones it wanted: `download-artifact` with no filter takes *every*
  artifact in the run, and `docker/build-push-action` quietly uploads a
  `.dockerbuild` build record that nothing reads. It failed to extract after
  five retries and took the whole release down with it.

  Two changes, because one of them is the cause and the other is the class.
  The build record is no longer created, and `publish` now downloads an
  allow-list of what the release actually carries rather than whatever the run
  happens to contain — so the next action that decides to upload something on
  its own cannot break a release that has otherwise entirely succeeded.

## [0.2.0-rc.2] — 2026-09-15

The first thing `rc.1` turned up, which is the entire purpose of cutting one.

### Fixed

- **The desktop installers did not build.** All four runners failed one second
  into the first real release with `npm error Missing script: "tauri"`.
  `tauri-action` shells out to `npm run tauri build -- --target <triple>` and
  there was no such script. `docs/PACKAGING.md` documents `npx tauri build`,
  which works and resolves the binary a completely different way, so every
  local check went down a path the release never uses — the `.deb` built by
  hand proved the Tauri config was right and proved nothing about the workflow.
  The gap was not in either half; it was in the seam between them.

  A test now asserts the script exists, that the CLI providing its binary is
  installed, and that the workflow still uses the action that needs it — so
  swapping `tauri-action` out makes the test say it is checking the wrong thing
  rather than passing forever.

- **A release could only be started two ways, and a restricted token could use
  neither.** The same credential that gets `HTTP 403` creating a tag ref is
  also refused `workflow_dispatch` with "Resource not accessible by
  integration" — two different permissions, and a token can be short of both.
  Pushing an ordinary branch worked the whole time. Pushing
  `release/v<version>` now starts a release; the workflow still makes the tag
  itself, still only after the suite passes in all three timezones, and still
  never moves an existing one.

## [0.2.0-rc.1] — 2026-09-14

The beta's exit criteria are met: every gap it wrote down is closed, so this
enters release candidate. **No new features from here** — only fixes for what
the `rc` itself turns up. A feature added now restarts `beta`, per
[docs/RELEASING.md](docs/RELEASING.md).

### Changed

- **Focus and glass are promoted to `stable` maturity, so they are on for
  everybody.** This, not the release being cut, is the change that reaches
  people — the code has shipped in every build since `alpha.1` and was simply
  gated. Cutting an `rc` with the flags still at `beta` would have produced a
  release candidate that did not contain the feature it is a candidate for.
  The promotion is its own commit, reviewable on its own, as
  [docs/RELEASING.md](docs/RELEASING.md) asks.

### Flags in this build

| Flag | Maturity | On in |
|---|---|---|
| `focus` | stable | every channel |
| `focus.wallpaper` | stable | every channel |
| `focus.glass` | stable | every channel |
| `glass.app` | stable | every channel |

Any of them can still be turned off by hand in Settings → Build. An override
wins in both directions, including turning a finished feature off because it is
in the way.

### Added

- **A release can be cut from the Actions tab**, not only by pushing a tag.
  Creating a tag is not always available to whoever is releasing — a restricted
  token gets `HTTP 403` on a tag ref while pushing branches fine — and
  `GITHUB_TOKEN` inside Actions can create one, so the workflow does it rather
  than the release waiting on a laptop. The tag is created **after** the suite
  passes, an existing tag is never moved, and `dry_run` builds everything while
  publishing nothing.

- **Analytics charts the Focus timer.** The timer has been writing a session
  log since the alpha and nothing read it back; that is the gap the beta wrote
  down, and it is closed. Three widgets, in a new **Focus** category:

  - **Focus time** — minutes per day, with the total as hours and minutes
    rather than a four-digit number, your current streak, the share of
    pomodoros you finished, and your best day.
  - **Where the time went** — minutes ranked by the task you ran the timer on.
    Unlinked time is a row of its own rather than dropped, because rows that
    sum to less than the total beside them cost you trust in both numbers.
  - **When you focus** — minutes by hour of the day, credited to the hour a
    session *started*, since the question is when you sit down to work.

  Everything buckets on local days and local hours. Bucketing by UTC puts a 9pm
  session in California on tomorrow's bar and shifts the hour chart eight hours
  for everyone west of Greenwich. The average is over days you actually worked,
  not over days in the window — a 30-day average that counts a fortnight of
  leave as zeroes is arithmetic nobody asked for. With no sessions the
  completion rate is *absent* rather than 0%: "you finished none of them" and
  "you have not run one" are different facts and only one is a judgement.

- **Widgets can declare a flag.** `defineWidget({ flag: 'focus' })` gates a
  widget the way the rail already gates a view: absent from the picker, and not
  rendered on a saved board, while the flag is off. Hidden rather than removed,
  so turning the flag back on returns the board exactly as it was — a switch
  that costs you your layout is one nobody flips twice.

- **A licence**, in `LICENSE`, with `NOTICE` covering what it does not.
- **`NOTICE`** states that the bundled photographs are US federal government
  works in the public domain — they are not this project's to relicense, under
  any licence it picks.

### Changed

- **The licence is now proprietary — all rights reserved, © 2026 Andrew
  Clark.** It shipped as MIT for three commits on this branch; that grant is
  withdrawn going forward. Reading the source grants nothing. Running a copy
  installed from a channel published here does, and so does keeping a backup of
  it — which is what a store submission needs and no more.

  Two carve-outs are written into the licence rather than left to goodwill.
  Your workspace is yours and export is expressly permitted, because a
  proprietary app that also holds your data is a worse thing than a proprietary
  app. And the bundled photographs stay public domain: `LICENSE` could not have
  pulled them in even if it tried.

- **Flathub is dropped as a target and `packaging/flatpak/` is deleted.**
  Flathub accepts open-source submissions only, so a manifest left in the tree
  would have been an invitation to open a PR that gets closed on sight. The
  `.desktop` and AppStream files moved to `packaging/linux/` — the snap
  installs them from there, and deleting the directory outright would have
  broken the snap build at the last step of a job that had already spent ten
  minutes compiling Rust. A test now checks that every file `snapcraft.yaml`
  installs actually exists.

  Snap, the Mac App Store, the Microsoft Store, direct downloads and the
  container image are unaffected — all five take proprietary software. Copyleft
  would have been the other way round: Flathub fine, Mac App Store gone.

- **Four manifests declare the licence, each in its own ecosystem's
  vocabulary**, and a test checks all four against `LICENSE`: `UNLICENSED` for
  npm, `license-file` for Cargo (SPDX has no id for "proprietary"),
  `Proprietary` for snapcraft, `LicenseRef-proprietary` for AppStream. A
  manifest left saying MIT is a grant of rights nobody meant to make, which is
  the one mistake here that cannot be taken back from whoever relied on it.
  `publish = false` and `"private": true` stop a one-keystroke `cargo publish`
  or `npm publish` distributing what the licence forbids distributing.

- CI now builds the browser app's container image on every pull request and
  curls it for `index.html`, the wallpaper credits and a photograph. It was
  only built by the release workflow, so a tag push would have been the first
  thing that ever built it — and both images share a build context, which is
  exactly how the MCP one broke earlier on this branch.

### Fixed

- **Every horizontal bar chart in the app drew an empty track.** `.hbar__fill`
  is a `<span>` with no `display` rule. Its parent track is a grid item, so the
  browser blockifies that and its height applies; the fill is not, so it stayed
  `display: inline` and ignored width and height alike. The leaderboard, the
  source mix and the workload bars have all been rendering as grey tracks with
  nothing in them — which reads as a styled component waiting for data rather
  than as a bug, which is why it survived this long. Found by looking at a
  screenshot of a chart whose numbers I already knew.

- **One malformed entity blanked the whole app.** The store re-normalises
  settings, brain, focus, work and router on load and takes `entities` exactly
  as they are, so a record written by an older build — or restored from an
  older export — can arrive without `tags`. `FilterBar` did `e.tags.filter(...)`
  on it and threw before anything rendered. A missing filter chip is the right
  failure there, not a white screen.

- **`BarChart` assumed its keys were dates.** Both axis labels went through a
  date formatter and the tooltip through another, so a chart of anything else
  rendered three unusable labels and an "Invalid Date". It takes an optional
  `labelOf` now, defaulting to the old behaviour.

- **`tests/packaging.test.js` was a binary file.** Two literal NUL bytes sat in
  it as the sentinel in a glob-to-regex conversion, so `grep`, `git diff` and
  every editor treated the whole file as binary and refused to search it. Same
  value, written as `\0`.

## [0.2.0-beta.2] — 2026-09-14

### Fixed

- **The container served the seven photographs and 404'd their credits.**
  `*.md` in the app image's ignore file is right for repository documentation
  and wrong for `public/wallpapers/CREDITS.md`, which the app serves as a file
  and links to. Tests now assert the credits survive the image build, and that
  every band they name has both its AVIF and its WebP present — a credits file
  listing photographs the image does not ship would be the same defect pointing
  the other way.

## [0.2.0-beta.1] — 2026-09-14

Focus is feature complete, so its flags are promoted to beta maturity and beta
builds carry it by default. The gaps the alpha wrote down are closed.

### Added

- **Seven bundled photographs**, one per time-of-day band, so an empty Studio
  is still a photograph rather than a plain background. Every one is a work of
  the US National Park Service or Fish and Wildlife Service — public domain by
  statute, which survives being redistributed inside an app and through the
  stores. Credits and source pages: [`public/wallpapers/CREDITS.md`](public/wallpapers/CREDITS.md).
  The AVIF set is 810KB on disk in total; a browser fetches one photograph,
  averaging 118KB, and the service worker keeps it.
- **Your own photographs win.** One of yours taken in this hour beats the
  bundled one for the same hour; the bundled set is the floor, not the default.
- **A 24px inlined blur** of each photograph, about 300 bytes, so the view
  opens on the shape and colour of what is arriving rather than a flat plane.
- **Glass everywhere** (`glass.app`). The wallpaper and the translucency carry
  past Focus into the rail, the topbar, cards and overlays. Tables, charts,
  code, form controls and every dense surface keep solid backing — translucency
  is for chrome you look past, never for data you read.
- **Settings → Appearance → Transparency.** `prefers-reduced-transparency`
  already turns glass solid; this is the switch beside it for anyone whose OS
  has no such setting, or who simply reads better without it. There is no
  "force on": overriding somebody's accessibility preference is not a
  preference worth offering.

### Fixed

- **`backdrop-filter` never reached any browser.** Vite's `cssTarget` defaults
  to the JavaScript target, and esbuild cannot map `es2022` onto browser
  support, so it kept only the `-webkit-` alias and dropped the standard
  property. The glass had a tint and no blur everywhere, and looked plausible
  enough that it took reading the built stylesheet to find. `cssTarget` now
  names browsers, and the hand-written prefixes are gone — esbuild deduplicates
  an alias pair and keeps the last, so writing both by hand was what deleted
  the standard one.
- **The app-wide scrim was a curtain.** At 0.72 over a photograph the whole
  screen came back off-white and the wallpaper may as well not have existed —
  the same mistake already made and fixed inside Focus, repeated the moment the
  surface got bigger. Readability app-wide comes from each surface's own tint,
  not from a wash over the photograph.
- **Task buttons in Focus clipped their labels** at both ends instead of
  ellipsising. A button centres its text, so overflow splits across both sides;
  the label now truncates inside its own box.
- **Two Dockerfiles shared one `.dockerignore`.** Excluding `mcp` for the app
  image emptied the MCP image's build context, which died with
  `"/mcp/src": not found` in a job that looked unrelated.

### Flags in this build

| Flag | Maturity | On in |
|---|---|---|
| `focus` | beta | alpha, beta |
| `focus.wallpaper` | beta | alpha, beta |
| `focus.glass` | beta | alpha, beta |
| `glass.app` | beta | alpha, beta |

### Known gaps

- Analytics still does not chart the timer sessions. The data is recorded and
  `minutesOn` reads it; nothing draws it yet.
- On a packed dashboard the wallpaper is mostly hidden behind cards, so
  `glass.app` reads as a subtle texture there and only comes into its own on
  Focus. That is the honest result of app-wide glass over a dense grid, not a
  bug to fix by making cards more transparent.

## [0.2.0-alpha.1] — 2026-09-14

The first build with a release process behind it, and the first slice of
Focus.

### Added

- **Release channels.** A build is alpha, beta, rc or stable, read off its own
  version and nothing else. Settings → Build shows which one you are on.
- **Feature flags with maturity.** Code ships to every channel; what gates
  exposure is how finished the feature claims to be. An alpha-maturity feature
  is on for alpha builds and off for everyone else, so cutting a beta cannot
  widen an unfinished feature's audience by accident. Overrides in Settings
  win in both directions.
- **`docs/RELEASING.md`** — entry and exit criteria per phase, and the rule
  that a feature added during `rc` restarts `beta`.
- **`npm run release`** — refuses a version that is not a legal step from the
  current one.

### Flags in this build

| Flag | Maturity | On in |
|---|---|---|
| `focus` | alpha | alpha |
| `focus.wallpaper` | alpha | alpha |
| `focus.glass` | alpha | alpha |
| `glass.app` | beta | alpha, beta |

### Known gaps

Written down rather than left to be found:

- The bundled photograph set is not in this build. Wallpapers come from your
  own Studio media; an empty Studio means no wallpaper. Curating a licensed
  set is beta work.
- Glass is inside the Focus view only. `glass.app` carries it further and is
  beta-maturity, so it is off outside alpha.
- Timer sessions are recorded but Analytics does not chart them yet.

[Unreleased]: https://github.com/drewc611/The-All-Dash/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.1
[0.2.0]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0
[0.2.0-rc.6]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.6
[0.2.0-rc.5]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.5
[0.2.0-rc.4]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.4
[0.2.0-rc.3]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.3
[0.2.0-rc.2]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.2
[0.2.0-rc.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-rc.1
[0.2.0-beta.2]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-beta.2
[0.2.0-beta.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-alpha.1
