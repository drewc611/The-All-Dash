import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/*
 * The Tidy workflow deletes branches, which is the one thing here that cannot be
 * undone by running it again. So its decisions are tested by running the real
 * script, not by matching text in it: the `run:` block is lifted out of the
 * workflow and executed against a stand-in `gh` that answers from fixtures.
 * Whatever the script would ask GitHub, the fixtures answer, and what comes out
 * is what it would have done.
 *
 * This is in its own file because the rules are the product. A deleted branch
 * with unmerged commits on it is work lost, and nobody is warned.
 */

const WORKFLOW = readFileSync(new URL('../.github/workflows/tidy.yml', import.meta.url), 'utf8')

/** The first job's script: the lines indented under its `run: |`. */
function script() {
  const lines = WORKFLOW.split('\n')
  const at = lines.findIndex((l) => /^\s+run: \|$/.test(l))
  assert.ok(at > 0, 'no run block in the tidy workflow')
  const indent = lines[at].match(/^\s*/)[0].length + 2
  const body = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') { body.push(''); continue }
    if (line.match(/^\s*/)[0].length < indent) break
    body.push(line.slice(indent))
  }
  return body.join('\n')
}

/** A `gh` that answers from files. It looks at what was asked, as the real one filters. */
const FAKE_GH = `#!/usr/bin/env bash
args="$*"
case "$args" in
  *"repo view"*) echo main ;;
  *"pr list"*"--state merged"*)
    # The script asks for names, or for names with the commit each merged from.
    # Answering both lets the same fixture test the script before and after it
    # learned to ask for the commit.
    if [[ "$args" == *headRefOid* ]]; then cat "$FIX/merged.tsv"; else cut -f1 "$FIX/merged.tsv"; fi ;;
  *"pr list"*"--state open"*) cat "$FIX/open.txt" ;;
  *"git/refs/tags"*'select(.object.type == "commit")'*) cat "$FIX/tags.txt" ;;
  *"git/refs/tags"*) : ;;
  *"/branches"*) cat "$FIX/branches.tsv" ;;
  *"-X DELETE"*) echo "$args" >> "$FIX/deleted.log" ;;
  *) echo "fake gh: unexpected call: $args" >&2; exit 1 ;;
esac
`

const TAG = 'aaaaaaa1111111111111111111111111111111aa'
const MERGED_TIP = 'bbbbbbb2222222222222222222222222222222bb'
const MOVED_ON = 'ccccccc3333333333333333333333333333333cc'

/** Run the script over a set of branches, dry or not, and report what it did. */
function run({ branches, merged = [], open = [], tags = [], dry = true }) {
  // Fixtures live apart from the working directory. The script writes its own
  // merged.txt and open.txt into its cwd, and a fixture with the same name was
  // truncated by the script's redirect before the stand-in gh could read it -
  // which showed up as an open pull request failing to protect its branch.
  const root = mkdtempSync(join(tmpdir(), 'tidy-'))
  const fix = join(root, 'fixtures')
  const work = join(root, 'work')
  mkdirSync(fix)
  mkdirSync(work)
  const write = (name, rows) => writeFileSync(join(fix, name), rows.map((r) => (Array.isArray(r) ? r.join('\t') : r)).join('\n') + (rows.length ? '\n' : ''))
  write('branches.tsv', branches)
  write('merged.tsv', merged)
  write('open.txt', open)
  write('tags.txt', tags)
  writeFileSync(join(root, 'gh'), FAKE_GH)
  chmodSync(join(root, 'gh'), 0o755)
  writeFileSync(join(root, 'script.sh'), script())

  const out = spawnSync('bash', [join(root, 'script.sh')], {
    cwd: work,
    encoding: 'utf8',
    env: { PATH: `${root}:${process.env.PATH}`, FIX: fix, GH_TOKEN: 'x', REPO: 'o/r', DRY_RUN: dry ? 'true' : 'false', GITHUB_STEP_SUMMARY: '/dev/null' },
  })
  assert.equal(out.status, 0, `the script failed:\n${out.stderr}\n${out.stdout}`)
  // Only the per-branch decisions, so a header such as "default branch: main"
  // cannot be mistaken for a verdict on a branch called main.
  const lines = out.stdout.split('\n').filter((l) => /^(keep|would delete|deleted)\s/.test(l))
  const verdict = (name) => lines.find((l) => l.replace(/^(keep|would delete|deleted)\s+/, '').split(/\s+/)[0] === name) || ''
  const log = join(fix, 'deleted.log')
  const deleted = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []
  return { out: out.stdout, verdict, deleted }
}

const B = (name, sha, protectedFlag = 'false') => [name, sha, protectedFlag]

test('a branch whose pull request merged, and has not moved since, goes', () => {
  const r = run({
    branches: [B('main', 'm'.repeat(40)), B('claude/done', MERGED_TIP)],
    merged: [['claude/done', MERGED_TIP]],
  })
  assert.match(r.verdict('claude/done'), /would delete/)
  assert.match(r.verdict('main'), /keep.*default branch/)
})

test('a branch reused under the same name after its pull request merged is kept', () => {
  /*
   * The hole this closed. A merged branch is restarted from main under the same
   * name for follow-up work, and for the minutes before its new pull request
   * exists the only pull request GitHub knows for that name is the merged one.
   * Judging by name deleted the new, unmerged commits. Judging by whether the
   * branch is still where it was when it merged does not.
   */
  const r = run({
    branches: [B('main', 'm'.repeat(40)), B('claude/reused', MOVED_ON)],
    merged: [['claude/reused', MERGED_TIP]],
  })
  assert.match(r.verdict('claude/reused'), /keep/)
  assert.doesNotMatch(r.verdict('claude/reused'), /delete/)
  assert.match(r.verdict('claude/reused'), /commits|moved|since/i, 'the reason names why')
})

test('a pull request that is still open protects its branch', () => {
  const r = run({
    branches: [B('main', 'm'.repeat(40)), B('claude/wip', MERGED_TIP)],
    merged: [['claude/wip', MERGED_TIP]],
    open: ['claude/wip'],
  })
  assert.match(r.verdict('claude/wip'), /keep.*open pull request/)
})

test('a protected branch is never taken, whatever else is true of it', () => {
  const r = run({
    branches: [B('main', 'm'.repeat(40)), B('release/keep', MERGED_TIP, 'true')],
    merged: [['release/keep', MERGED_TIP]],
    tags: [MERGED_TIP],
  })
  assert.match(r.verdict('release/keep'), /keep.*protected/)
})

test('a release branch goes only if a tag holds the same commit', () => {
  const r = run({
    branches: [B('main', 'm'.repeat(40)), B('release/v1.0.0', TAG), B('release/v9.9.9', MOVED_ON)],
    tags: [TAG],
  })
  assert.match(r.verdict('release/v1.0.0'), /would delete/)
  assert.match(r.verdict('release/v9.9.9'), /keep/)
})

test('a branch nothing vouches for is left alone', () => {
  const r = run({ branches: [B('main', 'm'.repeat(40)), B('feature/someone-elses-wip', MOVED_ON)] })
  assert.match(r.verdict('feature/someone-elses-wip'), /keep.*nothing else vouches/)
})

test('a live run deletes exactly what a dry run said it would, and nothing else', () => {
  const fixture = {
    branches: [B('main', 'm'.repeat(40)), B('claude/done', MERGED_TIP), B('claude/reused', MOVED_ON), B('feature/unknown', MOVED_ON)],
    merged: [['claude/done', MERGED_TIP], ['claude/reused', MERGED_TIP]],
  }
  const dry = run({ ...fixture, dry: true })
  assert.deepEqual(dry.deleted, [], 'a dry run must not delete')

  const live = run({ ...fixture, dry: false })
  assert.equal(live.deleted.length, 1)
  assert.match(live.deleted[0], /heads\/claude\/done$/)
  assert.ok(!live.deleted.some((d) => /reused|unknown|main/.test(d)))
})
