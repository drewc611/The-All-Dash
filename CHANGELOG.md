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

[Unreleased]: https://github.com/drewc611/The-All-Dash/compare/v0.2.0-beta.1...HEAD
[0.2.0-beta.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-beta.1
[0.2.0-alpha.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-alpha.1
