import test from 'node:test'
import assert from 'node:assert/strict'

import { pageToFile } from '../src/ingest/web.js'
import { makeEntity, makeDoc } from '../src/data/schema.js'
import { platformConfig } from '../src/platform/client.js'

test('a scraped page becomes a Markdown file named by title, host and path', () => {
  const file = pageToFile({ url: 'https://www.example.com/docs/pricing/', final_url: 'https://www.example.com/docs/pricing/', title: 'Pricing: Team & Enterprise', description: 'What it costs', markdown: '## Team\n\n$12 per seat.' })
  assert.equal(file.name, 'Pricing: Team & Enterprise [example.com/docs/pricing].md')
  assert.match(file.text, /^# Pricing: Team & Enterprise\n\nSource: https:\/\/www\.example\.com\/docs\/pricing\/\n> What it costs\n\n## Team/)
  assert.equal(file.url, 'https://www.example.com/docs/pricing/')
  const bare = pageToFile({ final_url: 'https://example.com/', markdown: '' })
  assert.equal(bare.name, 'example.com [example.com].md')
})

test('documents and entities keep the URL they came from', () => {
  const doc = makeDoc({ id: 'd', name: 'x.md', kind: 'markdown', size: 1, text: 'x', produced: 0, version: 'v', url: 'https://example.com/x' })
  assert.equal(doc.meta.url, 'https://example.com/x')
  assert.equal(doc.source.url, 'https://example.com/x')
  const e = makeEntity({ type: 'task', title: 't', source: { docId: 'd', name: 'x.md', kind: 'markdown', url: 'https://example.com/x' } })
  assert.equal(e.source.url, 'https://example.com/x')
  assert.equal(makeEntity({ type: 'task', title: 't' }).source.url, null)
})

test('the platform is configured only with both a URL and a key', () => {
  assert.equal(platformConfig({ settings: { platform: { url: 'http://localhost:8000/' } } }).configured, false)
  assert.equal(platformConfig({ settings: { platform: { url: 'http://localhost:8000/' } } }).url, 'http://localhost:8000')
})
