/*
 * The packaging manifests, checked against the repository.
 *
 * These exist because of a failure that already happened once here: the MCP
 * image did not COPY the agent sources, so the container started and died
 * instantly with nothing in the log, and CI went red on a change that had
 * nothing to do with it. A manifest is code that runs somewhere nobody looks
 * until it breaks, so the parts that can be checked here are.
 *
 * What these can and cannot do: they verify the file lists and the version
 * agreements. They cannot build a Docker image (no daemon in CI's test job) or
 * a .dmg (wrong operating system). The release workflow does that on the right
 * runner; these catch the mistakes that would waste that run.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/* ------------------------------------------------------ the app container */

const DOCKERFILE = read('Dockerfile')

/** Every path the build stage copies in, in COPY order. */
const copied = DOCKERFILE
  .split('\n')
  .filter((l) => l.startsWith('COPY') && !l.includes('--from='))
  .flatMap((l) => l.replace(/^COPY\s+(--\S+\s+)*/, '').trim().split(/\s+/).slice(0, -1))

test('the image copies everything a build needs', () => {
  // Proven by staging exactly this list into an empty tree and running the
  // build there; this keeps the list honest as the repo grows.
  for (const needed of ['package.json', 'vite.config.js', 'index.html', 'public', 'src']) {
    assert.ok(
      copied.some((c) => c === needed || c.startsWith(`${needed}/`)),
      `Dockerfile never copies ${needed}, so the build stage would fail`,
    )
  }
})

test('every path the image copies actually exists', () => {
  for (const path of copied) {
    if (path.includes('*')) continue // package-lock.json* is an optional glob
    assert.ok(existsSync(join(ROOT, path)), `Dockerfile copies ${path}, which is not in the repo`)
  }
})

test('the image does not run as root', () => {
  // A static file server has no reason to be root, and the stores and most
  // clusters reject an image that is.
  assert.match(DOCKERFILE, /^USER\s+(?!root|0\s*$)/m, 'no non-root USER in the runner stage')
})

test('the image declares a healthcheck', () => {
  assert.match(DOCKERFILE, /HEALTHCHECK/, 'without one a dead container looks healthy')
})

test('the build context excludes what the image must never carry', () => {
  const ignored = read('.dockerignore').split('\n').map((l) => l.trim())
  // node_modules would be copied over the installed ones and break the build;
  // .git would put the whole history inside a published image.
  for (const path of ['node_modules', '.git']) {
    assert.ok(ignored.includes(path), `.dockerignore does not exclude ${path}`)
  }
})

/* --------------------------------------------------------------- desktop */

const TAURI = JSON.parse(read('src-tauri/tauri.conf.json'))
const CARGO = read('src-tauri/Cargo.toml')

test('the desktop shell points at the built app, not a dev server', () => {
  assert.equal(TAURI.build.frontendDist, '../dist')
  assert.match(TAURI.build.beforeBuildCommand, /npm run build/)
})

test('every icon the bundle claims is present', () => {
  for (const icon of TAURI.bundle.icon) {
    assert.ok(existsSync(join(ROOT, 'src-tauri', icon)), `tauri.conf.json names ${icon}, which does not exist`)
  }
})

test('the Windows Store logos the MSIX needs are present', () => {
  for (const logo of ['Square44x44Logo.png', 'Square150x150Logo.png', 'StoreLogo.png']) {
    assert.ok(existsSync(join(ROOT, 'src-tauri/icons', logo)), `missing ${logo}, which the Microsoft Store requires`)
  }
})

test('the Mac App Store entitlements exist and are sandboxed', () => {
  const path = join(ROOT, 'src-tauri', TAURI.bundle.macOS.entitlements)
  assert.ok(existsSync(path), 'tauri.conf.json names an entitlements file that does not exist')
  const plist = readFileSync(path, 'utf8')
  assert.match(plist, /com\.apple\.security\.app-sandbox/, 'App Review rejects an unsandboxed submission')
  assert.doesNotMatch(plist, /network\.server/, 'this app runs no server; that entitlement would have to be justified')
})

test('the bundle identifier is a real reverse-DNS name', () => {
  assert.match(TAURI.identifier, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){2,}$/)
  // Tauri ships with this and warns about it; a released app carrying it would
  // collide with every other unconfigured Tauri app on the machine.
  assert.notEqual(TAURI.identifier, 'com.tauri.dev')
})

test('the release profile is tuned for size', () => {
  // The entire argument for Tauri over Electron here is the download size. A
  // default release profile gives most of that back.
  for (const setting of ['lto = true', 'strip = true', 'opt-level = "s"']) {
    assert.ok(CARGO.includes(setting), `Cargo.toml is missing ${setting}`)
  }
})

test('the webview is not handed the whole operating system', () => {
  const csp = TAURI.app.security.csp
  assert.equal(csp['object-src'], "'none'")
  assert.equal(csp['default-src'], "'self'")
  assert.ok(!csp['script-src'].includes('unsafe-eval'), 'unsafe-eval would undo the formula parser being eval-free')
  assert.equal(TAURI.app.security.assetProtocol.enable, false, 'the app reads no files off disk by path')
})

test('the only frame the desktop app may load is the YouTube embed', () => {
  // The browser build makes this the single documented exception to "nothing
  // leaves the device". The desktop build must not quietly widen it.
  assert.equal(TAURI.app.security.csp['frame-src'], 'https://www.youtube-nocookie.com')
})

/* ------------------------------------ two images, one build context */

/*
 * The app image and the MCP image are both built from the repository root:
 *
 *   docker build .                    -> Dockerfile
 *   docker build -f mcp/Dockerfile .  -> mcp/Dockerfile
 *
 * So they share a build context, and by default they share the root
 * .dockerignore. That is exactly how this broke: an exclusion added for one
 * image removed `mcp/src` from the other's context and the MCP build died
 * with `"/mcp/src": not found`, a failure that looks nothing like its cause.
 *
 * BuildKit reads `<dockerfile>.dockerignore` in preference to the root one, so
 * each image now gets its own. This checks both rather than trusting that.
 */

/** Does this .dockerignore exclude `path`? Enough of the syntax to be useful. */
const excludes = (patterns, path) => {
  let hit = false
  for (const raw of patterns) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const negated = line.startsWith('!')
    const body = negated ? line.slice(1) : line
    const source = body
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0/g, '.*')
    const rx = new RegExp(`^${source}$`)
    // A directory pattern excludes everything beneath it, so test each prefix.
    const parts = path.split('/')
    const matched = parts.some((_, i) => rx.test(parts.slice(0, i + 1).join('/')))
    if (matched) hit = !negated
  }
  return hit
}

/** The COPY sources a Dockerfile pulls out of the build context. */
const contextSources = (dockerfile) => dockerfile
  .split('\n')
  .filter((l) => l.startsWith('COPY') && !l.includes('--from='))
  .flatMap((l) => l.replace(/^COPY\s+(--\S+\s+)*/, '').trim().split(/\s+/).slice(0, -1))
  .map((p) => p.replace(/\*$/, ''))

/** The ignore file that actually applies to a given Dockerfile. */
const ignoreFor = (dockerfilePath) => {
  const specific = `${dockerfilePath}.dockerignore`
  const path = existsSync(join(ROOT, specific)) ? specific : '.dockerignore'
  return read(path).split('\n')
}

for (const dockerfile of ['Dockerfile', 'mcp/Dockerfile']) {
  test(`${dockerfile}: nothing it copies is excluded from its context`, () => {
    const patterns = ignoreFor(dockerfile)
    for (const source of contextSources(read(dockerfile))) {
      assert.equal(
        excludes(patterns, source), false,
        `${dockerfile} copies ${source}, but the .dockerignore that applies to it excludes that path, so the build fails with "${source}: not found"`,
      )
    }
  })
}

test('the matcher itself is right about directories and negations', () => {
  // A matcher that silently matched nothing would pass the tests above
  // regardless, so prove it catches the real case and respects an unexclusion.
  assert.equal(excludes(['mcp'], 'mcp/src'), true)
  assert.equal(excludes(['mcp'], 'mcp'), true)
  assert.equal(excludes(['node_modules'], 'src/core'), false)
  assert.equal(excludes(['docs/screenshots'], 'docs/screenshots/today.png'), true)
  assert.equal(excludes(['*.md'], 'README.md'), true)
  assert.equal(excludes(['mcp', '!mcp'], 'mcp/src'), false)
})

/* --------------------------------------------------------- the versions */

test('the desktop version is one the Windows installer will accept', () => {
  // MSI and MSIX take major.minor.patch and nothing else, so a prerelease tag
  // in this field fails the Windows job after every other target has built.
  assert.match(TAURI.version, /^\d+\.\d+\.\d+$/, `tauri.conf.json version "${TAURI.version}" is not x.y.z`)
})

test('the desktop version tracks the app version', () => {
  const app = JSON.parse(read('package.json')).version
  const base = app.split('-')[0]
  assert.equal(TAURI.version, base, `package.json is ${app} but tauri.conf.json says ${TAURI.version}`)
})

test('the app image ships the wallpaper credits it links to', () => {
  // The photographs are public domain and need no attribution, but the app
  // links to CREDITS.md from its own UI and README. A blanket `*.md` exclusion
  // had removed it from the image, so that link 404'd wherever the container
  // was served while the seven photographs it names loaded fine.
  const patterns = ignoreFor('Dockerfile')
  assert.equal(
    excludes(patterns, 'public/wallpapers/CREDITS.md'), false,
    'the app image excludes the credits file for the photographs it serves',
  )
  assert.ok(existsSync(join(ROOT, 'public/wallpapers/CREDITS.md')))
})

test('every bundled photograph named in the credits is actually in public/', () => {
  const credits = read('public/wallpapers/CREDITS.md')
  for (const band of ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'dusk', 'night']) {
    assert.match(credits, new RegExp(`\`${band}\``), `CREDITS.md does not mention ${band}`)
    for (const ext of ['avif', 'webp']) {
      assert.ok(existsSync(join(ROOT, `public/wallpapers/${band}.${ext}`)), `missing ${band}.${ext}`)
    }
  }
})

/* ------------------------------------------------------------- the licence */

/*
 * One licence, declared in four places.
 *
 * The app is proprietary, so every manifest has to say so in the vocabulary
 * its own ecosystem uses: npm wants `UNLICENSED`, Cargo wants a `license-file`
 * rather than an SPDX id it cannot resolve, snapcraft takes the literal word
 * `Proprietary`, and AppStream wants `LicenseRef-` prefixed. They are easy to
 * change individually, easy to forget, and a manifest left claiming MIT is a
 * grant of rights nobody intended to make. So they are checked together.
 */

test('every manifest declares the same licence as the LICENSE file', () => {
  const text = read('LICENSE')
  assert.match(text, /Proprietary Software Licence/, 'LICENSE is not the licence the manifests claim')
  assert.match(text, /All rights reserved/)
  assert.match(text, /NO LICENCE IS GRANTED BY THIS FILE/)

  assert.equal(JSON.parse(read('package.json')).license, 'UNLICENSED')
  assert.match(read('src-tauri/Cargo.toml'), /^license-file = "\.\.\/LICENSE"$/m)
  assert.match(read('packaging/linux/com.thealldash.app.metainfo.xml'), /<project_license>LicenseRef-proprietary<\/project_license>/)
  assert.match(read('packaging/snap/snapcraft.yaml'), /^license: Proprietary$/m)
})

test('nothing still claims the app is open source', () => {
  // The repository shipped MIT for three commits. A leftover MIT badge or an
  // SPDX id in a manifest is a licence grant by accident, which is the one
  // kind of mistake here that cannot be taken back from whoever relied on it.
  assert.equal(JSON.parse(read('package.json')).license, 'UNLICENSED')
  assert.doesNotMatch(read('src-tauri/Cargo.toml'), /^license = /m)
  assert.doesNotMatch(read('LICENSE'), /MIT License/)
  assert.doesNotMatch(read('README.md'), /licence-MIT/)
})

test('the desktop build has the npm script the release workflow invokes', () => {
  // tauri-action shells out to `npm run tauri build -- --target ...`. The docs
  // said `npx tauri build`, which works and exercises a different path
  // entirely, so nothing here ever noticed the script was missing until all
  // four desktop runners failed a second into the first real release with
  // `npm error Missing script: "tauri"`.
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts.tauri, 'tauri', 'tauri-action runs `npm run tauri` and there is no such script')
  assert.ok(pkg.devDependencies['@tauri-apps/cli'], 'the script needs the CLI that provides the binary')
  assert.match(RELEASE, /tauri-apps\/tauri-action@v0/, 'if the workflow stopped using tauri-action, this test is checking the wrong thing')
})

test('the crate cannot be published to crates.io', () => {
  // A proprietary crate uploaded to a public registry is a distribution the
  // licence does not permit, and `cargo publish` is one keystroke away.
  assert.match(read('src-tauri/Cargo.toml'), /^publish = false$/m)
  assert.equal(JSON.parse(read('package.json')).private, true)
})

test('the desktop bundle ships the licence file it names', () => {
  const named = TAURI.bundle.licenseFile
  assert.ok(named, 'tauri.conf.json names no licence file, so installers carry none')
  assert.ok(existsSync(join(ROOT, 'src-tauri', named)), `tauri.conf.json names ${named}, which does not exist`)
})

test('no placeholder survives into a manifest', () => {
  // Every one of these was a real PLACEHOLDER_ in an earlier commit, and a
  // submission carrying one is rejected by the store rather than by us.
  for (const path of [
    'packaging/linux/com.thealldash.app.metainfo.xml',
    'packaging/snap/snapcraft.yaml',
  ]) {
    assert.doesNotMatch(read(path), /PLACEHOLDER_LICENSE/, `${path} still has a licence placeholder`)
  }
})

test('the snap installs a desktop file that exists', () => {
  // The .desktop lived under packaging/flatpak/ and the snap installed it from
  // there. Dropping the Flathub target would have broken the snap build at the
  // last step of a job that had already spent ten minutes compiling Rust.
  const snap = read('packaging/snap/snapcraft.yaml')
  for (const [, path] of snap.matchAll(/install -Dm\d+ (packaging\/\S+)/g)) {
    assert.ok(existsSync(join(ROOT, path)), `snapcraft.yaml installs ${path}, which does not exist`)
  }
})

test('the Flathub manifest is gone rather than left to be submitted', () => {
  // Flathub accepts open-source submissions only. A manifest left in the tree
  // is an invitation to open a PR that would be closed on sight.
  assert.ok(!existsSync(join(ROOT, 'packaging/flatpak')), 'packaging/flatpak still exists under a proprietary licence')
  // The docs still name Flathub, to say why it is gone. What must not survive
  // is a section telling somebody how to submit to it.
  assert.doesNotMatch(read('docs/PACKAGING.md'), /^#+ Flathub/m)
})

/* ------------------------------------------------------- the release paths */

/*
 * Three ways to cut a release, and all three have to keep working.
 *
 * Pushing a tag is the normal one. The other two exist because creating a tag
 * is not always available to whoever is cutting the release, and because the
 * first replacement for it turned out not to be enough either: the same
 * restricted token was refused a tag ref with HTTP 403 AND refused
 * workflow_dispatch with "Resource not accessible by integration", while
 * pushing an ordinary branch worked fine. GITHUB_TOKEN inside Actions can
 * create the tag, so the workflow does it rather than the release waiting on
 * somebody with the right laptop.
 */
const RELEASE = read('.github/workflows/release.yml')

test('a release can be started three ways', () => {
  assert.match(RELEASE, /^on:/m)
  assert.match(RELEASE, /tags: \['v\*'\]/, 'the tag trigger is gone')
  assert.match(RELEASE, /workflow_dispatch:/, 'the manual trigger is gone')
  assert.match(RELEASE, /branches: \['release\/v\*'\]/, 'the release-branch trigger is gone, and it is the only one a token without actions:write can reach')
})

test('each way in derives the version from its own shape of ref', () => {
  // A branch called release/v0.2.0 with "v" stripped is "release/v0.2.0",
  // which fails the package.json comparison with a message about the wrong
  // file. Each ref shape needs its own case.
  assert.match(RELEASE, /push:tag\)\s+version="\$\{GITHUB_REF_NAME#v\}"/)
  assert.match(RELEASE, /push:branch\)\s+version="\$\{GITHUB_REF_NAME#release\/v\}"/)
})

test('both tagless ways in can create the tag', () => {
  // Gating the tag step on workflow_dispatch alone means a release branch runs
  // the whole suite, builds every installer, and then publishes against a tag
  // that does not exist.
  const step = RELEASE.slice(RELEASE.indexOf('name: Create the tag'))
  assert.match(step, /github\.event_name == 'workflow_dispatch' \|\| github\.ref_type == 'branch'/)
})

test('the manual path can actually create the tag it needs', () => {
  // contents: write is what lets GITHUB_TOKEN push a ref. Without it the
  // manual path fails at the last step, having already run the whole suite.
  assert.match(RELEASE, /permissions:\s*\n\s*contents: write/, 'GITHUB_TOKEN cannot create a tag without contents: write')
  assert.match(RELEASE, /git push origin "refs\/tags\/\$tag"/, 'nothing creates the tag on a manual run')
})

test('a slow container build cannot hold a finished release hostage', () => {
  // publish waits on container completing, whatever it concludes. The arm64
  // half is emulated: it built in 83 seconds once and sat for twenty minutes
  // on an identical commit when two releases contended for the build cache.
  // Unbounded, that is a six-hour hold on a release whose installers are done.
  const job = RELEASE.slice(RELEASE.indexOf('\n  container:'), RELEASE.indexOf('\n  desktop:'))
  assert.match(job, /timeout-minutes: \d+/, 'the emulated container build has no time bound')
  assert.doesNotMatch(
    RELEASE.slice(RELEASE.indexOf('  publish:')),
    /needs\.container\.result/,
    'publish gates on the container, so a failed image would block a release the installers are ready for'
  )
})

test('an unsigned macOS build is never handed empty signing secrets', () => {
  // An absent GitHub secret is an empty string, not an absent variable, so
  // APPLE_CERTIFICATE="" made tauri import an empty certificate and fail the
  // whole macOS bundle - after the Rust build had already succeeded. There
  // have to be two builds, and the unsigned one must carry no APPLE_ vars.
  const unsigned = RELEASE.slice(RELEASE.indexOf('Build and bundle, unsigned'))
  const nextJob = unsigned.indexOf('- uses: actions/upload-artifact')
  const body = nextJob === -1 ? unsigned : unsigned.slice(0, nextJob)
  assert.doesNotMatch(body, /APPLE_/, 'the unsigned build is handed Apple secrets, which are empty strings when unset')
  assert.match(RELEASE, /Build and bundle, signed/, 'there is no signed build left')
  assert.match(RELEASE, /steps\.signing\.outputs\.apple/, 'nothing decides which of the two builds runs')
})

test('the release publishes only what it built, not whatever is lying around', () => {
  // `download-artifact` with no filter takes every artifact in the run. On the
  // first real release that included a `.dockerbuild` build record uploaded by
  // docker/build-push-action, which failed to extract after five retries and
  // took publish down with it - after verify, web, container and the tag had
  // all succeeded. An allow-list survives the next action that decides to
  // upload something on its own.
  assert.match(RELEASE, /pattern: '\{web,desktop-\*\}'/, 'publish downloads every artifact in the run, including ones nothing uploaded on purpose')
  assert.match(RELEASE, /DOCKER_BUILD_RECORD_UPLOAD: false/, 'the build record that broke publish is being created again')
})

test('every bundle the matrix builds is attached, not just the flat ones', () => {
  // upload-artifact roots an artifact at the least common ancestor of the paths
  // it matched, and the desktop job matches seven globs that all sit under
  // .../release/bundle/. So each desktop artifact arrives as deb/, rpm/, dmg/,
  // msi/ and nsis/ subdirectories rather than as bare files, `files: artifacts/*`
  // matched directories, and action-gh-release skipped them without a word.
  // v0.2.0-rc.4 built all four desktop targets, uploaded them, downloaded them
  // and published one asset: the web tarball, the only artifact already flat.
  const job = RELEASE.slice(RELEASE.indexOf('  publish:'))
  const flatten = job.indexOf('name: Flatten the bundles')
  assert.ok(flatten > 0, 'nothing flattens the bundles, so only the web tarball reaches the release')
  assert.ok(flatten > job.indexOf('download-artifact'), 'the flatten runs before there is anything to flatten')
  assert.ok(flatten < job.indexOf('action-gh-release'), 'the flatten runs after the upload, which is too late to matter')
  assert.match(job, /find artifacts -mindepth 2 -type f/, 'the flatten never reaches into the bundle subdirectories')
  assert.match(job, /two bundles are both called/, 'a name collision quietly drops one of the two')
})

test('two runners cannot quietly overwrite each other during the download', () => {
  // v0.2.0-rc.5 published one `The All Dash.app.tar.gz`, and two Mac runners
  // each produced a file by that name: it carries no architecture, and
  // `merge-multiple: true` extracts every artifact over one tree, so the second
  // download overwrote the first before the flatten's collision guard could see
  // that there were two. Whichever survived reached the release page with
  // nothing in its name to say which chip it was built for.
  //
  // Each artifact keeps its own directory now, so the flatten is the only thing
  // that merges them, and the flatten refuses a collision instead of picking.
  // Keyed on the YAML key, not the word: the comment above it in the workflow
  // explains what merge-multiple did, and a test that reads prose about a
  // setting instead of the setting is a test that fails for the wrong reason.
  assert.doesNotMatch(RELEASE, /^\s*merge-multiple:/m, 'artifacts extract over one tree again, where a duplicate path overwrites in silence')
  assert.doesNotMatch(RELEASE, /\*\.app\.tar\.gz/, 'the macOS .app tarball is back and its name still carries no architecture')
  assert.match(RELEASE, /bundle\/\*\*\/\*\.dmg/, 'macOS has no deliverable left at all')
})

test('an existing tag is never moved', () => {
  // A tag people may already have fetched is not rewritten - the same rule
  // scripts/release.mjs enforces locally.
  assert.match(RELEASE, /already exists; leaving it where it is/)
})

test('a dry run publishes nothing', () => {
  // Its whole purpose is proving the release builds without releasing, so
  // every publishing step has to be guarded, not just the obvious one.
  const guard = /github\.event_name == 'push' \|\| !inputs\.dry_run/g
  const guarded = RELEASE.match(guard) || []
  assert.ok(guarded.length >= 2, `only ${guarded.length} publishing step(s) check dry_run; the container push and the release both must`)
  const step = RELEASE.slice(RELEASE.indexOf('name: Create the tag'))
  assert.match(step, /&& !inputs\.dry_run \}\}/, 'a dry run would still create a tag')
})

test('the tag is only created after the tests have passed', () => {
  // A tag left pointing at a commit whose suite failed is worse than no tag:
  // it is a version number somebody will later assume was released.
  const tests = RELEASE.indexOf('TZ=Pacific/Auckland npm test')
  const tag = RELEASE.indexOf('name: Create the tag')
  assert.ok(tests !== -1 && tag !== -1)
  assert.ok(tag > tests, 'the tag is created before the suite runs')
})

test('the version being released is the version the build stamps in', () => {
  // Both paths check package.json, or the app would report a channel the
  // release does not claim.
  assert.match(RELEASE, /package\.json says \$in_tree/)
})

test('the photographs are excluded from the code licence, not silently covered by it', () => {
  // They are US federal government works in the public domain, which is not
  // this project's to relicense. NOTICE is where that is said.
  const notice = read('NOTICE')
  assert.match(notice, /public domain/i)
  assert.match(notice, /17 U\.S\.C\./)
  assert.match(notice, /CREDITS\.md/)
})
