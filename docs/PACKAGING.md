# Packaging

Five ways to get this app, from one codebase. What each one is, what actually
builds it, and — for the stores — exactly which accounts and secrets you have
to supply, because none of them can be faked and I have not invented any.

| Target | Built by | Needs from you |
|---|---|---|
| Web (self-host) | `npm run build` | Nothing |
| Container | `Dockerfile` → GHCR | Nothing |
| Linux `.deb`, `.rpm`, AppImage | Tauri on `ubuntu-22.04` | Nothing |
| macOS `.dmg` | Tauri on `macos-latest` | Apple Developer certificate, to avoid a Gatekeeper warning |
| Windows `.msi`, `.exe` | Tauri on `windows-latest` | Authenticode certificate, to avoid a SmartScreen warning |
| Snap, Mac App Store, Microsoft Store | See below | An account per store |

## Why Tauri and not Electron

The app is 487KB. An Electron installer carries its own Chromium and lands
around 150MB; the Tauri `.deb` on the release page is **4.2MB**. Tauri uses the webview the operating system already has — WebKit
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

**Proprietary, all rights reserved**, in `LICENSE`. Copyright Andrew Clark.

No rights are granted by reading the source. What the licence does grant is the
thing a store submission needs: whoever installs a copy from a channel you
operate — an app store listing, a signed installer, a container image you
publish — may run it and back it up. They may not redistribute it, resell it,
or host it for other people.

Two carve-outs, both deliberate:

- **Your data is yours.** The licence claims nothing over the documents,
  records, media and workspaces a person puts into the app, and says export is
  permitted. A proprietary app that also holds your data hostage is a different
  and worse thing than a proprietary app.
- **`NOTICE` covers what LICENSE cannot.** The bundled photographs are US
  federal government works in the public domain under 17 U.S.C. § 105 — making
  the app proprietary does not and could not pull them in. Dependencies stay
  under their own terms.

Four manifests declare a licence, each in its ecosystem's own vocabulary, and
`tests/packaging.test.js` checks all four against `LICENSE`:

| File | Says |
|---|---|
| `package.json` | `"license": "UNLICENSED"`, with `"private": true` |
| `src-tauri/Cargo.toml` | `license-file = "../LICENSE"`, with `publish = false` |
| `packaging/snap/snapcraft.yaml` | `license: Proprietary` |
| `packaging/linux/com.thealldash.app.metainfo.xml` | `LicenseRef-proprietary` |

Cargo takes a `license-file` rather than an SPDX id because "Proprietary" is
not one; AppStream requires the `LicenseRef-` prefix for the same reason. Both
`publish = false` and `"private": true` exist to stop a one-keystroke
`cargo publish` or `npm publish` distributing the thing the licence forbids
distributing.

**What this costs: Flathub.** Flathub accepts open-source submissions only, so
that target is gone and `packaging/flatpak/` is deleted rather than left as an
invitation to open a PR that would be closed on sight. The `.desktop` and
AppStream files moved to `packaging/linux/`, because the snap installs them
too. Snap, the Mac App Store, the Microsoft Store, direct downloads and the
container image all take proprietary software without complaint.

If you ever want to go the other way, the trade is real and worth making
deliberately. Permissive (MIT, Apache-2.0) restores Flathub and every other
target. Copyleft (GPL, AGPL) restores Flathub and costs the **Mac App Store** —
Apple imposes per-device usage restrictions that the GPL forbids a distributor
from adding, which is why GPL'd apps have been pulled from that store before.

This file is a description of what is in the repository, not legal advice. If
you are going to sell this or license it to a company, a solicitor reading the
actual text is money well spent.

## Signing

Unsigned installers work. They also make the operating system tell the person
installing them that the app may be malicious, which is not a thing to
discover on release day.

Every secret below is optional, and the build produces installers without them.
Getting that to be true took a fix: an absent GitHub secret is an **empty
string**, not an absent variable, so handing `APPLE_CERTIFICATE=""` to the
build made it try to import an empty certificate and fail the entire macOS
bundle — after the Rust build had already succeeded. The workflow now decides
first whether a certificate exists and runs one of two builds, because the
unsigned build is not the signed one with fewer secrets; it is a build that
must not be handed them at all.

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

### Snap Store — free

`packaging/snap/snapcraft.yaml`, declaring `license: Proprietary` — the Snap
Store takes closed-source snaps, unlike Flathub. It installs the `.desktop`
and icon from `packaging/linux/`. Register the name, then:

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

Every target below is built by the release workflow and attached to the release
page. These are the sizes from `v0.2.0-rc.6`:

| File | Size |
|---|---|
| `The All Dash_0.2.0_aarch64.dmg` | 4.2MB |
| `The All Dash_0.2.0_x64.dmg` | 4.3MB |
| `The All Dash_0.2.0_x64_en-US.msi` | 4.3MB |
| `The All Dash_0.2.0_x64-setup.exe` | 3.9MB |
| `The All Dash_0.2.0_amd64.deb` | 4.2MB |
| `The All Dash-0.2.0-1.x86_64.rpm` | 4.2MB |
| `The All Dash_0.2.0_amd64.AppImage` | 82MB |
| `the-all-dash-web-0.2.0-rc.6.tar.gz` | 2.8MB |

The AppImage is twenty times the `.deb` because it is the one Linux format that
bundles its own runtime rather than depending on the system webview. That is the
whole point of the format, and it is the reason the `.deb` or `.rpm` is the
better download if your distribution can take one.

Four defects were found by releasing rather than by reading, each one after
every other job had already succeeded: `tauri-action` runs `npm run tauri build`
and the package had no `tauri` script; an absent `APPLE_CERTIFICATE` is an empty
string and not an absent variable, so both Mac bundles failed trying to import
it; `files: artifacts/*` matched directories, which the upload action skips
without a word, so rc.4 published one asset out of nine; and two Mac runners
produced the same `.app.tar.gz` filename, which one download silently overwrote.

Checked separately from the matrix:

- The **Linux `.deb`** dependencies. One defect found and fixed — `Depends`
  listed `libwebkit2gtk-4.1-0` and `libgtk-3-0` twice, because Tauri already
  declares them and the config declared them again.
- The **container's file list**: staged into an empty tree and built there, so
  the `COPY` lines are known to be sufficient. `tests/packaging.test.js` pins
  the file list so a new directory fails a test rather than a deploy. The image
  builds for `amd64` and `arm64` in the release workflow and pushes to GHCR.

Still not done here, and not claimed to be: every store submission. Those need
accounts and credentials that are yours. Installers signed with a real
certificate are also unproven — the matrix takes the unsigned path because this
repository has no `APPLE_*` secrets set, so what ships warns on first open.
