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

[Unreleased]: https://github.com/drewc611/The-All-Dash/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/drewc611/The-All-Dash/releases/tag/v0.2.0-alpha.1
