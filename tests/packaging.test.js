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
