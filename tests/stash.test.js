import test from 'node:test'
import assert from 'node:assert/strict'

import {
  stripMarkdown, wordCount, readingMinutes, excerpt, titleFrom, siteName,
  canonicalUrl, outline, readablePage, WORDS_PER_MINUTE, safeUrl,
} from '../src/stash/readable.js'
import { tokenise, buildIndex, parseQuery, search, snippet, emptyIndex, syncIndex, indexDoc, dropDocs } from '../src/stash/search.js'
import { blocks, normalise, diffBlocks, changesOnly, describeChange, fingerprint } from '../src/stash/diff.js'
import { stashEntity, addVersion, liveSnapshotIds, makeHighlight, dueForCheck, hoursSince, isUnread, stashKind } from '../src/stash/schema.js'

const ARTICLE = `# Rolling back the write path

Published by Priya Raman

The rollback script had been sitting in the repository for eight months, which
is roughly seven months and three weeks longer than anyone intended.

## What went wrong

We shipped a migration without a reverse. The tooling allowed it, the review
did not catch it, and the runbook said "see the migration" in the place where
it should have said what to do.

## What we changed

Every migration now needs a down step before it merges.`

/* ---------------------------------------------------------------- readable */

test('markdown syntax is not counted as prose', () => {
  assert.equal(stripMarkdown('# Heading'), 'Heading')
  assert.equal(stripMarkdown('a **bold** word'), 'a bold word')
  assert.equal(stripMarkdown('[the link](https://example.com)'), 'the link')
  assert.equal(stripMarkdown('![alt](img.png) after'), 'after')
  assert.equal(stripMarkdown('```\ncode here\n```\ntext'), 'text')
  assert.equal(stripMarkdown('`inline` text'), 'text')
  assert.equal(stripMarkdown('> quoted'), 'quoted')
  assert.equal(stripMarkdown('- one\n- two'), 'one two')
})

test('word count ignores the markup', () => {
  assert.equal(wordCount('one two three'), 3)
  assert.equal(wordCount('# one two three'), 3)
  assert.equal(wordCount('[one](https://a.example) two'), 2)
  assert.equal(wordCount(''), 0)
  assert.equal(wordCount(null), 0)
})

test('reading time uses a real number and never says zero minutes', () => {
  assert.equal(WORDS_PER_MINUTE, 238)
  assert.equal(readingMinutes(238), 1)
  assert.equal(readingMinutes(2380), 10)
  assert.equal(readingMinutes(5), 1, 'a short page is a one-minute read, not a zero-minute one')
  assert.equal(readingMinutes(0), 0)
  assert.equal(readingMinutes(-9), 0)
})

test('the excerpt is the first real paragraph, not a heading or an image', () => {
  const text = excerpt(ARTICLE)
  assert.ok(text.startsWith('Published by') || text.startsWith('The rollback script'), text)
  assert.ok(!text.startsWith('#'))
  assert.equal(excerpt('# Only a heading'), '')
  assert.equal(excerpt('![just an image](a.png)'), '')
  assert.ok(excerpt('a'.repeat(500)).endsWith('…'))
})

test('the title comes from the first heading', () => {
  assert.equal(titleFrom(ARTICLE), 'Rolling back the write path')
  assert.equal(titleFrom('## Only an h2'), 'Only an h2')
  assert.equal(titleFrom('no headings here', 'Fallback'), 'Fallback')
  assert.equal(titleFrom('', ''), '')
})

test('the site is the hostname a person would recognise', () => {
  assert.equal(siteName('https://www.theguardian.com/a/b'), 'theguardian.com')
  assert.equal(siteName('https://news.ycombinator.com/item?id=1'), 'news.ycombinator.com')
  assert.equal(siteName('not a url'), '')
})

test('the same article shared two ways canonicalises to one url', () => {
  const fromNewsletter = canonicalUrl('https://www.Example.com/post/?utm_source=news&utm_medium=email&id=7')
  const fromChat = canonicalUrl('https://example.com/post?id=7&fbclid=abc#section')
  assert.equal(fromNewsletter, fromChat)
  assert.equal(fromNewsletter, 'https://example.com/post?id=7')
})

test('canonicalising refuses anything that is not http', () => {
  assert.equal(canonicalUrl('javascript:alert(1)'), '')
  assert.equal(canonicalUrl('data:text/html,hi'), '')
  assert.equal(canonicalUrl('file:///etc/passwd'), '')
  assert.equal(canonicalUrl('nonsense'), '')
  assert.equal(canonicalUrl(''), '')
  // The root slash is the path and stays.
  assert.equal(canonicalUrl('https://example.com/'), 'https://example.com/')
})

test('the outline gives every heading a unique anchor', () => {
  const headings = outline('# A\n\n## Notes\n\ntext\n\n## Notes\n\nmore')
  assert.deepEqual(headings.map((h) => h.text), ['A', 'Notes', 'Notes'])
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 2])
  assert.equal(new Set(headings.map((h) => h.id)).size, 3, 'two sections called Notes need two anchors')
})

test('a fetched page becomes everything the list row needs', () => {
  const page = readablePage({ url: 'https://www.example.com/post?utm_source=x', markdown: ARTICLE })
  assert.equal(page.title, 'Rolling back the write path')
  assert.equal(page.site, 'example.com')
  assert.equal(page.url, 'https://example.com/post')
  assert.ok(page.words > 50)
  assert.equal(page.minutes, readingMinutes(page.words))
  assert.equal(page.outline.length, 3)
})

test('a link from a saved page cannot carry a script scheme', () => {
  // Every URL in a saved article came off somebody else's website. React
  // renders href verbatim, so this is the boundary that has to hold.
  for (const hostile of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)  ',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\u0000script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.com/abc',
  ]) {
    assert.equal(safeUrl(hostile), null, JSON.stringify(hostile))
    // Still refused when there is a base URL to resolve against.
    assert.equal(safeUrl(hostile, 'https://example.com/post'), null, `${JSON.stringify(hostile)} with base`)
  }
})

test('ordinary links survive, and relative ones are resolved', () => {
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeUrl('http://example.com/a'), 'http://example.com/a')
  assert.match(safeUrl('mailto:someone@example.com'), /^mailto:/)
  assert.equal(safeUrl('/other', 'https://example.com/post'), 'https://example.com/other')
  assert.equal(safeUrl('next.html', 'https://example.com/dir/post'), 'https://example.com/dir/next.html')
  // Relative with no base cannot be resolved, so it is not a link.
  assert.equal(safeUrl('/other'), null)
  assert.equal(safeUrl(''), null)
  assert.equal(safeUrl(null), null)
  assert.equal(safeUrl(undefined), null)
})

/* ------------------------------------------------------------------ search */

test('tokenising keeps the things people actually search for', () => {
  assert.deepEqual(tokenise("Priya's rollback script"), ['priya', 'rollback', 'script'])
  assert.ok(tokenise('CVE-2024-1234 affects 99.9% uptime').includes('cve-2024-1234'))
  assert.ok(tokenise('c++ and c#').includes('c++'))
  assert.deepEqual(tokenise(''), [])
  assert.deepEqual(tokenise(null), [])
})

const CORPUS = [
  { id: '1', title: 'Rolling back the write path', text: ARTICLE },
  { id: '2', title: 'Kubernetes autoscaling notes', text: 'The horizontal pod autoscaler fought the replica count on every apply. We removed the fixed replicas.' },
  { id: '3', title: 'Migration checklist', text: 'Every migration needs a down step. The rollback script is the last line of defence, not the first.' },
]

test('search finds a page by a phrase in its body, not its title', () => {
  const index = buildIndex(CORPUS)
  const hits = search(index, 'runbook')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].id, '1', 'the word appears only in the body of the first article')
})

test('a term in the title outranks the same term in a body', () => {
  const index = buildIndex([
    { id: 'title', title: 'Autoscaling in anger', text: 'A short note about running things.' },
    { id: 'body', title: 'Unrelated heading', text: `Mentioned autoscaling once. ${'Filler sentence here. '.repeat(40)}` },
  ])
  const hits = search(index, 'autoscaling')
  assert.equal(hits.length, 2)
  assert.equal(hits[0].id, 'title')
})

test('a shorter document matching every term beats a long one that buries them', () => {
  const index = buildIndex(CORPUS)
  const hits = search(index, 'rollback script')
  assert.ok(hits.length >= 2)
  // Doc 3 is two sentences and says both words; doc 1 is an article that
  // mentions them in passing. Length normalisation is the point of BM25.
  assert.equal(hits[0].id, '3')
})

test('a quoted phrase has to appear verbatim', () => {
  const index = buildIndex(CORPUS)
  const loose = search(index, 'last defence')
  const exact = search(index, '"last line of defence"')
  assert.ok(loose.length >= exact.length)
  assert.deepEqual(exact.map((h) => h.id), ['3'])
  assert.equal(search(index, '"defence of line last"').length, 0, 'word order matters inside quotes')
})

test('search copes with nothing to search and nothing searched for', () => {
  const empty = buildIndex([])
  assert.deepEqual(search(empty, 'anything'), [])
  const index = buildIndex(CORPUS)
  assert.deepEqual(search(index, ''), [])
  assert.deepEqual(search(index, '   '), [])
  assert.deepEqual(search(index, 'the and of'), [], 'stop words alone are not a query')
  assert.deepEqual(search(index, 'zzzznotpresent'), [])
})

test('documents without an id are skipped rather than corrupting the index', () => {
  const index = buildIndex([{ title: 'no id', text: 'text' }, ...CORPUS])
  assert.equal(index.count, 3)
})

test('the query parser separates phrases from loose words', () => {
  const parsed = parseQuery('rollback "down step" script')
  assert.deepEqual(parsed.phrases, ['down step'])
  assert.ok(parsed.terms.includes('rollback') && parsed.terms.includes('script'))
  assert.ok(!parsed.terms.includes('down'), 'a quoted word is not also a loose word')
})

test('the snippet is the window where the matches are densest', () => {
  const { text, marks } = snippet(stripMarkdown(ARTICLE), 'runbook')
  assert.ok(text.toLowerCase().includes('runbook'))
  assert.ok(marks.length >= 1)
  const [start, end] = marks[0]
  assert.equal(text.slice(start, end).toLowerCase(), 'runbook', 'the marks line up with the text')
})

test('a snippet from the middle is elided at both ends, and the marks still line up', () => {
  const long = `${'filler word '.repeat(60)}needle ${'more filler '.repeat(60)}`
  const { text, marks } = snippet(long, 'needle')
  assert.ok(text.startsWith('…'))
  assert.ok(text.endsWith('…'))
  const [start, end] = marks[0]
  assert.equal(text.slice(start, end), 'needle')
})

test('a snippet survives having nothing to mark', () => {
  assert.deepEqual(snippet('', 'x'), { text: '', marks: [] })
  assert.equal(snippet('some text here', 'absent').marks.length, 0)
})

/* -------------------------------------------------------------------- diff */

test('blocks are paragraphs, not lines', () => {
  assert.deepEqual(blocks('one\ntwo\n\nthree'), ['one\ntwo', 'three'])
  assert.deepEqual(blocks('\n\n  \n'), [])
})

test('reflowed prose is not a change', () => {
  const before = 'The rollback script had been sitting\nin the repository for months.'
  const after = 'The rollback script had been sitting in the repository for months.'
  assert.equal(normalise(before), normalise(after))
  assert.equal(diffBlocks(before, after).changed, false)
})

test('smart quotes and dashes are not a change either', () => {
  assert.equal(diffBlocks("it's a test - really", 'it’s a test — really').changed, false)
})

test('a changelog that gained an entry says so', () => {
  const before = '# Changelog\n\n## 1.2.0\n\nFixed the thing.'
  const after = '# Changelog\n\n## 1.3.0\n\nAdded the other thing.\n\n## 1.2.0\n\nFixed the thing.'
  const diff = diffBlocks(before, after)
  assert.equal(diff.changed, true)
  assert.equal(diff.added, 2)
  assert.equal(diff.removed, 0)
  assert.equal(describeChange(diff), '2 added')
  // The blocks that did not move are still reported in order.
  assert.deepEqual(diff.rows.map((r) => r.type), ['same', 'added', 'added', 'same', 'same'])
})

test('a removed paragraph is reported as removed', () => {
  const diff = diffBlocks('a\n\nb\n\nc', 'a\n\nc')
  assert.equal(diff.removed, 1)
  assert.equal(diff.added, 0)
  assert.equal(describeChange(diff), '1 removed')
})

test('a changed paragraph reads as one out and one in', () => {
  const diff = diffBlocks('a\n\nthe SLA is 99.9%\n\nc', 'a\n\nthe SLA is 99.5%\n\nc')
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 1)
  assert.equal(describeChange(diff), '1 added, 1 removed')
})

test('nothing changed is said plainly', () => {
  const diff = diffBlocks(ARTICLE, ARTICLE)
  assert.equal(diff.changed, false)
  assert.equal(diff.added, 0)
  assert.equal(diff.removed, 0)
  assert.equal(describeChange(diff), 'Nothing changed')
  assert.equal(describeChange(null), 'Nothing changed')
})

test('an empty side is handled at both ends', () => {
  assert.equal(diffBlocks('', 'a\n\nb').added, 2)
  assert.equal(diffBlocks('a\n\nb', '').removed, 2)
  assert.equal(diffBlocks('', '').changed, false)
})

test('a huge page falls back to the cheap diff rather than the quadratic one', () => {
  const many = Array.from({ length: 1400 }, (_, i) => `paragraph ${i}`).join('\n\n')
  const changed = `${many}\n\nbrand new paragraph`
  const diff = diffBlocks(many, changed)
  assert.equal(diff.approximate, true)
  assert.equal(diff.added, 1)
  assert.equal(diff.removed, 0)
})

test('the changes-only view keeps context and marks the gaps', () => {
  // Changes at both ends, with an untouched middle to skip over.
  const diff = diffBlocks('A\n\nb\n\nc\n\nd\n\ne\n\nf\n\ng', 'Z\n\nb\n\nc\n\nd\n\ne\n\nf\n\nY')
  const rows = changesOnly(diff, { context: 1 })
  assert.ok(rows.some((r) => r.type === 'added'))
  assert.ok(rows.length < diff.rows.length, 'the unchanged middle is dropped')
  assert.ok(rows.some((r) => r.type === 'gap'), 'and the skip is marked')
})

test('the fingerprint ignores what the diff ignores', () => {
  assert.equal(fingerprint('one\ntwo'), fingerprint('one two'))
  assert.equal(fingerprint("it's"), fingerprint('it’s'))
  assert.notEqual(fingerprint('a'), fingerprint('b'))
  assert.match(fingerprint('anything'), /^[0-9a-f]{8}$/)
})

/* ------------------------------------------------------------------ record */

test('a saved page is an ordinary entity, so the rest of the app can use it', () => {
  const e = stashEntity({
    id: 'st-1',
    title: 'Rolling back the write path',
    url: 'https://www.example.com/post?utm_source=news',
    words: 476,
    snapshotId: 'snap-1',
  })
  assert.equal(e.type, 'page')
  assert.equal(e.meta.kind, 'page')
  assert.equal(e.meta.url, 'https://example.com/post', 'the tracker is stripped on the way in')
  assert.equal(e.meta.site, 'example.com')
  assert.equal(e.meta.minutes, 2)
  assert.equal(e.meta.state, 'inbox')
  assert.equal(isUnread(e), true)
  assert.ok(e.tags.includes('saved'))
})

test('an idea is a stash record with no url', () => {
  const e = stashEntity({ id: 'st-2', kind: 'idea', title: 'Ship the diff view first', excerpt: 'It is the part nobody else has.' })
  assert.equal(stashKind(e), 'idea')
  assert.equal(e.meta.url, '')
  assert.equal(e.source.kind, 'manual')
  assert.ok(e.tags.includes('idea'))
})

test('an unknown state or kind falls back instead of producing a broken record', () => {
  const e = stashEntity({ id: 'x', kind: 'hologram', state: 'nowhere', title: 'T' })
  assert.equal(e.meta.kind, 'page')
  assert.equal(e.meta.state, 'inbox')
})

test('versions stack newest first and stop growing', () => {
  let versions = []
  for (let i = 0; i < 25; i += 1) versions = addVersion(versions, { id: `v${i}`, at: String(i) })
  assert.equal(versions.length, 20)
  assert.equal(versions[0].id, 'v24', 'the newest is what you read')
  assert.equal(versions.at(-1).id, 'v5')
})

test('live snapshot ids cover the history, not just the current version', () => {
  const e = stashEntity({
    id: 'st-3', title: 'T', url: 'https://example.com/a',
    snapshotId: 'snap-3', versions: [{ id: 'snap-3' }, { id: 'snap-2' }, { id: 'snap-1' }],
  })
  const ids = liveSnapshotIds([e, { id: 'other', type: 'task' }])
  assert.deepEqual(ids.sort(), ['snap-1', 'snap-2', 'snap-3'])
  assert.deepEqual(liveSnapshotIds(null), [])
})

test('a highlight keeps the quote, because offsets do not survive a re-fetch', () => {
  const h = makeHighlight({ id: 'h1', quote: '  the runbook said "see the migration"  ', note: 'this is the bit' })
  assert.equal(h.quote, 'the runbook said "see the migration"')
  assert.equal(h.note, 'this is the bit')
  assert.ok(Date.parse(h.at))
})

test('watched pages come due in order of how long they have been ignored', () => {
  const now = Date.parse('2026-09-11T12:00:00Z')
  const page = (id, checkedAt, watching = true) => stashEntity({
    id, title: id, url: `https://example.com/${id}`, watching, checkedAt,
  })
  const due = dueForCheck([
    page('fresh', '2026-09-11T11:00:00Z'),
    page('stale', '2026-09-09T12:00:00Z'),
    page('older', '2026-09-10T00:00:00Z'),
    page('ignored', '2026-09-01T00:00:00Z', false),
  ], { everyHours: 12, now })

  assert.deepEqual(due.map((e) => e.id), ['stale', 'older'])
  assert.ok(!due.some((e) => e.id === 'fresh'), 'checked an hour ago is not due')
  assert.ok(!due.some((e) => e.id === 'ignored'), 'a page you are not watching is never due')
})

test('a page never checked is due immediately', () => {
  const e = stashEntity({ id: 'new', title: 'new', url: 'https://example.com/new', watching: true })
  assert.equal(hoursSince(null), Infinity)
  assert.equal(dueForCheck([e]).length, 1)
})

test('the re-check batch is capped, because it hits someone else server', () => {
  const many = Array.from({ length: 30 }, (_, i) => stashEntity({
    id: `p${i}`, title: `p${i}`, url: `https://example.com/${i}`, watching: true,
  }))
  assert.equal(dueForCheck(many).length, 5)
})

/*
 * The incremental index.
 *
 * Rebuilding from scratch is a third of a second per thousand articles, and
 * the view used to pay it every time it mounted. These say the cheap path
 * gives the same answers as the expensive one.
 */

const doc = (id, title, text, rev = '1') => ({ id, title, text, rev })

const ranking = (index, query) => search(index, query).map((hit) => hit.id)

test('syncing an empty index is the same as building one', () => {
  const docs = [
    doc('a', 'Rollback script', 'the deploy failed and the rollback script saved us'),
    doc('b', 'Pricing', 'revenue per seat and the churn we saw in march'),
    doc('c', 'Postgres', 'a vacuum ran long and the replica fell behind'),
  ]
  const fresh = buildIndex(docs)
  const { index, added, removed, refreshed } = syncIndex(emptyIndex(), docs)

  assert.deepEqual({ added, removed, refreshed }, { added: 3, removed: 0, refreshed: 0 })
  assert.equal(index.count, fresh.count)
  assert.equal(index.averageLength, fresh.averageLength)
  assert.deepEqual(ranking(index, 'rollback'), ranking(fresh, 'rollback'))
  assert.deepEqual(ranking(index, 'the churn'), ranking(fresh, 'the churn'))
})

test('a document nobody touched is not read again', () => {
  const docs = [doc('a', 'Rollback script', 'the rollback script saved us'), doc('b', 'Pricing', 'revenue per seat')]
  const { index } = syncIndex(emptyIndex(), docs)

  // Same revisions, and the text swapped for something that would rank
  // differently if it were read. It must not be read.
  const lies = [doc('a', 'Rollback script', 'kubernetes kubernetes kubernetes'), doc('b', 'Pricing', 'revenue per seat')]
  const second = syncIndex(index, lies)

  assert.deepEqual({ added: second.added, removed: second.removed, refreshed: second.refreshed }, { added: 0, removed: 0, refreshed: 0 })
  assert.deepEqual(ranking(second.index, 'kubernetes'), [])
  assert.deepEqual(ranking(second.index, 'rollback'), ['a'])
})

test('a new revision replaces the old words rather than adding to them', () => {
  const { index } = syncIndex(emptyIndex(), [doc('a', 'Draft', 'the first attempt mentioned redis')])
  const after = syncIndex(index, [doc('a', 'Draft', 'the second attempt mentioned postgres', '2')])

  assert.equal(after.refreshed, 1)
  assert.deepEqual(ranking(after.index, 'postgres'), ['a'])
  // The word that was only in the old version is gone, not merely outranked.
  assert.deepEqual(ranking(after.index, 'redis'), [])
  assert.equal(after.index.count, 1)
})

test('forgetting a page removes it from the vocabulary and the averages', () => {
  const docs = [
    doc('a', 'Rollback', 'the rollback script saved us from a bad deploy that broke checkout for an hour on friday'),
    doc('b', 'Churn', 'revenue per seat'),
  ]
  const { index } = syncIndex(emptyIndex(), docs)
  const before = index.averageLength

  const after = syncIndex(index, [docs[1]])
  assert.equal(after.removed, 1)
  assert.equal(after.index.count, 1)
  assert.deepEqual(ranking(after.index, 'rollback'), [])
  assert.notEqual(after.index.averageLength, before)
  assert.equal(after.index.averageLength, buildIndex([docs[1]]).averageLength)
  assert.equal(after.index.postings.has('rollback'), false)
})

test('add, drop and change at once matches a rebuild exactly', () => {
  const first = [
    doc('a', 'Rollback', 'the rollback script saved us'),
    doc('b', 'Churn', 'revenue per seat and churn'),
    doc('c', 'Postgres', 'the vacuum ran long'),
  ]
  const { index } = syncIndex(emptyIndex(), first)

  const second = [
    doc('b', 'Churn', 'revenue per seat and churn'),
    doc('c', 'Postgres', 'the vacuum ran long and the replica fell behind', '2'),
    doc('d', 'Latency', 'p99 latency doubled after the deploy'),
  ]
  const { index: synced, added, removed, refreshed } = syncIndex(index, second)
  const rebuilt = buildIndex(second)

  assert.deepEqual({ added, removed, refreshed }, { added: 1, removed: 1, refreshed: 1 })
  assert.equal(synced.count, rebuilt.count)
  assert.equal(synced.averageLength, rebuilt.averageLength)
  for (const query of ['rollback', 'replica', 'latency', 'deploy', 'churn', '"vacuum ran long"']) {
    assert.deepEqual(ranking(synced, query), ranking(rebuilt, query), query)
  }
  assert.deepEqual([...synced.postings.keys()].sort(), [...rebuilt.postings.keys()].sort())
})

test('dropping every document leaves an index that answers nothing', () => {
  const docs = [doc('a', 'One', 'the first page'), doc('b', 'Two', 'the second page')]
  const { index } = syncIndex(emptyIndex(), docs)
  dropDocs(index, ['a', 'b'])

  assert.equal(index.count, 0)
  assert.equal(index.averageLength, 0)
  assert.equal(index.postings.size, 0)
  assert.deepEqual(search(index, 'page'), [])
})

test('indexDoc replacing in place does not double-count the length', () => {
  const index = emptyIndex()
  indexDoc(index, doc('a', 'Title', 'one two three four five'))
  const once = index.lengths.get('a')
  indexDoc(index, doc('a', 'Title', 'one two three four five', '2'))

  assert.equal(index.lengths.get('a'), once)
  assert.equal(index.total, once)
  assert.equal(index.count, 1)
})
