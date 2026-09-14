# Packaging

Six ways to get this app, from one codebase. What each one is, what actually
builds it, and — for the stores — exactly which accounts and secrets you have
to supply, because none of them can be faked and I have not invented any.

| Target | Built by | Needs from you |
|---|---|---|
| Web (self-host) | `npm run build` | Nothing |
| Container | `Dockerfile` → GHCR | Nothing |
| Linux `.deb`, `.rpm`, AppImage | Tauri on `ubuntu-22.04` | Nothing |
| macOS `.dmg` | Tauri on `macos-latest` | Apple Developer certificate, to avoid a Gatekeeper warning |
| Windows `.msi`, `.exe` | Tauri on `windows-latest` | Authenticode certificate, to avoid a SmartScreen warning |
| Flathub, Snap, Mac App Store, Microsoft Store | See below | An account per store |

## Why Tauri and not Electron

The app is 487KB. An Electron installer carries its own Chromium and lands
around 150MB; the Tauri `.deb` built from this repo is **2.1MB**, against a
4.0MB binary. Tauri uses the webview the operating system already has — WebKit
on macOS and Linux, WebView2 on Windows — which is the entire argument, and
also the one real cost: three webview engines instead of one, so the CI matrix
is doing genuine work rather than repeating itself.

Nothing is registered in `src-tauri/src/main.rs` on purpose. Every command
added there punches a hole through the webview sandbox into the operating
system, and the browser build has to work without them anyway.

## Building locally

```sh
npm run build                    # the web build, into dist/
npx tauri build                  # every installer this OS can produce
npx tauri build --bundles deb    # just one
docker build -t alldash .        # the container
```

A desktop build needs a Rust toolchain. On Debian or Ubuntu it also needs:

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
```

You can only build for the OS you are on. Cross-compiling to macOS is not
possible in practice — signing and notarisation both require macOS — which is
why the release workflow runs a matrix rather than one job.

## Versions

`npm run release -- <version>` writes **both** `package.json` and
`src-tauri/tauri.conf.json`, and strips the prerelease tag from the second
one: Windows installers take `major.minor.patch` and nothing else, so
`0.2.0-alpha.1` in that field fails the Windows job after every other target
has already built. A test asserts the two files still agree.

## Licence

**MIT**, in `LICENSE`. Chosen for a reason you can check rather than a
preference: you asked for Mac App Store and Microsoft Store submissions, and
the GPL family conflicts with Apple's App Store terms — Apple imposes
per-device usage restrictions that the GPL forbids a distributor from adding,
which is why GPL'd apps have been pulled from that store before. A permissive
licence removes that conflict entirely.

If you would rather have copyleft, the trade is real and worth making
deliberately: swap `LICENSE`, `package.json`, `src-tauri/Cargo.toml`, the
Flatpak metainfo and `snapcraft.yaml`, and drop the Mac App Store target.
Direct `.dmg` downloads are unaffected.

`NOTICE` covers what MIT does not: the bundled photographs are US federal
government works in the public domain, not MIT-licensed, and are listed
individually with their sources.

## Signing

Unsigned installers work. They also make the operating system tell the person
installing them that the app may be malicious, which is not a thing to
discover on release day.

Every secret below is optional. Absent, the build still produces installers
and the release notes carry a warning instead.

### macOS — `APPLE_*`

Needs an **Apple Developer Program** membership (99 USD/year).

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | A "Developer ID Application" certificate exported as `.p12`, then base64-encoded |
| `APPLE_CERTIFICATE_PASSWORD` | The password you set when exporting it |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | The Apple ID that owns the membership |
| `APPLE_PASSWORD` | An **app-specific password**, not the account password |
| `APPLE_TEAM_ID` | The ten-character team id from your developer account |

Notarisation is what stops Gatekeeper refusing the app outright; it happens
during the build once these are set.

### Windows — Authenticode

A certificate from a CA (DigiCert, Sectigo and others; roughly 200–500
USD/year). Since June 2023 a code-signing key must live on hardware or in a
cloud HSM, which means CI signs through the CA's service rather than holding
a `.pfx`. Configure it as the CA documents, then add `windows.signCommand` to
`tauri.conf.json`.

Without it, SmartScreen warns until the download builds reputation.

### Updates — `TAURI_SIGNING_PRIVATE_KEY`

Only needed if you turn on the built-in updater, which this repo has not.
Generate with `npx tauri signer generate`.

## The stores

### Flathub — free, open source only

`packaging/flatpak/com.thealldash.app.yml`.

Flathub builds from source on its own infrastructure, with **no network during
the build**, so dependencies have to be vendored first:

```sh
python3 flatpak-cargo-generator.py src-tauri/Cargo.lock -o cargo-sources.json
flatpak-node-generator npm package-lock.json -o node-sources.json
```

Then open a PR against `flathub/flathub` with the manifest. Before you do,
replace `PLACEHOLDER_TAG` and `PLACEHOLDER_COMMIT` with the release you are
submitting. A branch is refused; it is not reproducible.

The licence is settled: **MIT**, in `LICENSE`, and `project_license` in the
metainfo matches it — Flathub checks that the two agree.

### Snap Store — free

`packaging/snap/snapcraft.yaml`. Register the name, then:

```sh
snapcraft
snapcraft upload --release=stable the-all-dash_*.snap
```

For CI, `snapcraft export-login` produces a token for `SNAPCRAFT_STORE_CREDENTIALS`.

### Mac App Store — 99 USD/year

Sandbox entitlements are in `src-tauri/entitlements.plist`, and the list is
short because the app genuinely does little. App Review asks about each one:

- **`files.user-selected.read-write`** — import a file the person picks, and
  export the workspace back out. Read-write because exporting saves.
- **`device.camera`, `device.audio-input`** — Studio recording. Opt-in, and
  the OS prompts on first use.
- **`network.client`** — outgoing only, and only once a platform URL, a model
  provider or the YouTube embed is configured. There is no incoming
  entitlement because there is no server.

You will also need a separate "Mac App Distribution" certificate and a
provisioning profile; the Developer ID certificate above is for direct
downloads and the store will not take it.

Expect review to ask why an app that stores everything locally wants network
access. The answer is the three optional features above, and it is worth
saying so in the review notes rather than waiting to be asked.

### Microsoft Store — one-off registration fee

The Store logos are already generated (`Square44x44Logo.png`,
`Square150x150Logo.png`, `StoreLogo.png` and the rest) by `npx tauri icon`.

Register the app in Partner Center, reserve the name, then add `"msix"` to the
bundle targets and set the publisher identity Partner Center gives you. Apps
submitted this way are signed by Microsoft, so the Authenticode certificate
above is only needed for the direct download.

## What is verified, and what is not

Built and checked on this machine:

- The **Linux `.deb`**: 2.1MB, 4.0MB binary, dependencies correct. One defect
  found and fixed — `Depends` listed `libwebkit2gtk-4.1-0` and `libgtk-3-0`
  twice, because Tauri already declares them and the config declared them
  again.
- The **container's file list**: staged into an empty tree and built there, so
  the `COPY` lines are known to be sufficient. The image itself was **not**
  built — there is no Docker daemon in this environment. `tests/packaging.test.js`
  pins the file list so a new directory fails a test rather than a deploy.

Not built here, and not claimed to be: the macOS and Windows installers, and
every store submission. Those need the right operating system and credentials
that are yours. The manifests are written and the CI matrix runs them; the
first real tag is what proves them.
