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

- **A release can be cut from the Actions tab**, not only by pushing a tag.
  Creating a tag is not always available to whoever is releasing — a restricted
  token gets `HTTP 403` on a tag ref while pushing branches fine — and
  `GITHUB_TOKEN` inside Actions can create one, so the workflow does it rather
  than the release waiting on a laptop. The tag is created **after** the suite
  passes, an existing tag is never moved, and `dry_run` builds everything while
  publishing nothing.

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

[Unreleased]: https://github.com/drewc611/The-All-Dash/compare/v0.2.0-beta.2...HEAD
[0.2.0-beta.2]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-beta.2
[0.2.0-beta.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-alpha.1
