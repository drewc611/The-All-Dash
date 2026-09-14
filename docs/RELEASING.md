# Releasing

Four channels, one rule each. The rule is the point: a phase name that does
not gate anything is decoration, and a release process made of decoration is
how a half-finished feature reaches everybody on a Friday.

## The channels

| Channel | Version looks like | Who runs it | What it promises |
|---|---|---|---|
| `alpha` | `0.2.0-alpha.3` | Whoever is building it | Nothing. Data loss is possible and the schema may move under you. |
| `beta` | `0.2.0-beta.1` | Testers who opted in | Feature complete for the release. Bugs expected, your workspace survives. |
| `rc` | `0.2.0-rc.1` | Anyone who wants the next release early | No new features. Only fixes for what `rc` itself turns up. |
| `stable` | `0.2.0` | Everybody | It works, it is documented, and the upgrade does not cost you anything. |

The channel is read off the version and nowhere else (`src/core/flags.js`,
`channelOf`). There is no second switch to forget, so a build cannot claim a
channel its version does not support.

An unrecognised prerelease (`0.2.0-nightly.4`) is treated as **alpha**, not
stable. Guessing "finished" about a build nobody labelled is the expensive
direction to be wrong in.

## Flags are what actually ship

Code reaches every channel the moment it merges. What gates exposure is the
flag's **maturity**, declared in the registry in `src/core/flags.js`:

```js
focus:       { maturity: 'alpha' },   // on in alpha, off everywhere else
'glass.app': { maturity: 'beta'  },   // on in alpha and beta, off in rc and stable
```

A flag is on by default when its maturity is at least as strict as the
channel. So a feature does **not** widen its audience by a release being cut —
it widens by being *promoted*, which is a one-line change and a changelog
entry, and which can be reverted without shipping anything.

Anyone can override a flag by hand in Settings → Build. An override wins in
both directions, including turning a finished feature off because it is in the
way.

### Promoting a flag

Change `maturity`, add the changelog line, and say in the PR which exit
criteria below you are claiming. Do not promote a flag and cut the release in
the same commit — the promotion should be reviewable on its own, because it is
the change that actually affects people.

## Entry and exit criteria

Each phase is entered only when the previous phase's exit criteria are met.
"We are out of time" is not one of them; cutting scope is always available
and is the honest move.

### Alpha — exit criteria

- [ ] The feature works end to end for the main path, behind its flag.
- [ ] Unit tests cover the logic that is not visual, and they pass in the
      three timezones CI runs (`UTC`, `America/Los_Angeles`, `Pacific/Auckland`).
- [ ] No known way to lose or corrupt a workspace.
- [ ] Anything deliberately unbuilt is written down, here or in the PR — not
      left to be discovered.

### Beta — exit criteria

- [ ] Feature complete: nothing further is planned for this version.
- [ ] Every state is handled — empty, loading, error, and the awkward middle
      where data is partial.
- [ ] Accessible: keyboard reachable, focus visible, contrast measured rather
      than assumed, and `prefers-reduced-motion` and
      `prefers-reduced-transparency` honoured.
- [ ] A Playwright walk-through covers the feature with zero console errors.
- [ ] Works offline, or says plainly why it cannot.
- [ ] README and CHANGELOG describe what is actually in the build.

### Release candidate — exit criteria

- [ ] No new features. A feature added during `rc` restarts `beta`.
- [ ] Every bug found in `beta` is fixed or explicitly deferred with a reason.
- [ ] Full suite green in all CI timezones; backend, MCP and workspace tiers green.
- [ ] `npm audit` and `pip-audit` clean, or every finding is written up.
- [ ] Upgrade tested from the previous stable — a real workspace from the old
      version opens in the new one.

### Stable

- [ ] One `rc` has been out with no new blocking bug.
- [ ] Flags intended to be on for everyone have `maturity: 'stable'`.
- [ ] Release notes are written for people, not from `git log`.

## Cutting a release

```sh
npm run release -- 0.2.0-alpha.1     # writes package.json, commits, tags
git push --follow-tags
```

`scripts/release.mjs` refuses a version that is not a legal step from the
current one, so `0.2.0-beta.1` cannot be cut while the tree still says
`0.1.0`, and `0.3.0` cannot skip a stable that never happened. The legal
steps are:

```
0.1.0 → 0.2.0-alpha.1 → 0.2.0-alpha.2 → 0.2.0-beta.1 → 0.2.0-rc.1 → 0.2.0
```

Within a version you may go forwards along `alpha → beta → rc → stable` and
increment within a phase. You may not go backwards, and you may not enter a
new version from a prerelease of the old one.

Pushing the tag starts `.github/workflows/release.yml`, which builds, runs the
suite, derives the channel from the tag and attaches the artifact. A `stable`
tag additionally requires CI to be green on the commit it points at.

## Version numbers

Ordinary semver, with the pre-1.0 caveat that a minor bump may break things —
this is `0.x` and says so. The three tiers version independently: the browser
app (`package.json`), the MCP server (`mcp/package.json`) and the workspace
(`frontend/package.json`) each carry their own, because they are deployed
separately and a user may run an old one against a new one.

## What this process does not do

No staged percentage rollouts, no remote flag service, no telemetry deciding
when to promote. All three need a server and a population to measure, and this
app deliberately has neither — a flag is evaluated on the device, from a
registry in the bundle. Promotion is a judgement made by a person reading the
criteria above, which is slower and honest about being slower.
