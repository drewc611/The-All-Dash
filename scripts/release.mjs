#!/usr/bin/env node
/*
 * Cut a release.
 *
 *   npm run release -- 0.2.0-alpha.1
 *   npm run release -- 0.2.0-alpha.1 --dry-run
 *
 * Writes package.json, commits, tags, and stops. It deliberately does not
 * push: a tag is the one thing here that is awkward to take back once other
 * people have fetched it, so the last step stays a human one.
 *
 *   git push --follow-tags
 *
 * Refuses when the tree is dirty, when the version is not a legal step from
 * the current one, and when the changelog has no section for what is being
 * cut - that last one because a release whose notes are written afterwards is
 * a release whose notes are written from `git log`.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { canFollow, channelFor, suggestions } from './version.mjs'

const ROOT = new URL('../', import.meta.url)
const PKG = new URL('package.json', ROOT)
const CHANGELOG = new URL('CHANGELOG.md', ROOT)

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

const die = (message, ...rest) => {
  console.error(`\n  ${message}\n`)
  for (const line of rest) console.error(`  ${line}`)
  if (rest.length) console.error('')
  process.exit(1)
}

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const next = argv.find((a) => !a.startsWith('-'))

if (!next) die('Usage: npm run release -- <version> [--dry-run]', 'For example: npm run release -- 0.2.0-alpha.1')

const pkg = JSON.parse(readFileSync(PKG, 'utf8'))
const current = pkg.version

const verdict = canFollow(current, next)
if (!verdict.ok) {
  die(`Cannot release ${next}: ${verdict.why}`, `From ${current}, these are legal:`, ...suggestions(current).map((s) => `  ${s}`))
}

// A dirty tree stops a real cut but not a dry run: checking the version is
// legal *before* you are ready to commit is the whole use for --dry-run.
if (!dryRun && git('status', '--porcelain')) {
  die('The working tree is dirty. Commit or stash first — a release tag should point at a commit that exists.')
}

const tag = `v${next}`
if (git('tag', '--list', tag)) die(`${tag} already exists. A tag is not rewritten; pick the next one.`)

// The changelog must already describe this version. Writing release notes
// after the tag means writing them from the diff, which is how a changelog
// ends up listing refactors nobody using the app can see.
const changelog = readFileSync(CHANGELOG, 'utf8')
if (!changelog.includes(`## [${next}]`)) {
  die(`CHANGELOG.md has no "## [${next}]" section.`, 'Write what changed for a person using the app, then cut the release.')
}

const channel = channelFor(next)

console.log(`\n  ${current} → ${next}   (channel: ${channel})`)
console.log(`  tag: ${tag}`)
if (dryRun) {
  console.log('\n  --dry-run: nothing written.\n')
  process.exit(0)
}

pkg.version = next
writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`)

git('add', 'package.json')
git('commit', '-m', `Release ${next}`)
git('tag', '-a', tag, '-m', `${next} (${channel})`)

console.log(`\n  Committed and tagged. Nothing has left this machine yet:\n`)
console.log('    git push --follow-tags\n')
