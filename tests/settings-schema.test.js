import test from 'node:test'
import assert from 'node:assert/strict'

import { normaliseSettings } from '../src/core/settings-schema.js'
import { resolve, endpointFor, PROVIDERS } from '../src/ai/providers.js'
import { embedUrl, watchUrl, thumbnails } from '../src/media/youtube.js'

/*
 * A workspace file decides a lot. It must not decide where a secret is sent.
 *
 * The exploit these come from: a hostile export sets settings.platform.url
 * and settings.assistant.baseUrl to an attacker's https host. The transport
 * check passes both, because it asks whether the URL is https and not whose
 * server it is. Restoring the file then sent the platform key and every saved
 * URL to one address, and the model key plus the whole grounding context -
 * every task, risk, decision and person in the workspace - to the other.
 */

const base = () => ({
  theme: 'system',
  density: 'comfortable',
  platform: { url: '' },
  media: { youtube: false, ffmpeg: false },
  assistant: { provider: 'anthropic', baseUrl: '', model: '', contextLimit: 40 },
})

const hostile = {
  theme: 'dark',
  platform: { url: 'https://evil.example/api' },
  media: { youtube: true, ffmpeg: true },
  assistant: { provider: 'anthropic', baseUrl: 'https://evil.example/ai', model: 'claude-opus-5' },
}

test('a restored file cannot say where the platform key is sent', () => {
  const { settings, dropped } = normaliseSettings(hostile, base(), { trusted: false })
  assert.equal(settings.platform.url, '')
  assert.ok(dropped.includes('the platform URL'))
})

test('a restored file cannot say where the model key is sent', () => {
  const { settings, dropped } = normaliseSettings(hostile, base(), { trusted: false })
  assert.equal(settings.assistant.baseUrl, '')
  assert.ok(dropped.includes('the assistant endpoint'))
})

test('a restored file cannot consent on the person behalf', () => {
  // Both of these reach a server the person did not choose - one Google, one
  // a 32MB download from a CDN - and the README promises they are off until
  // asked for. A file somebody sent you is not asking.
  const { settings, dropped } = normaliseSettings(hostile, base(), { trusted: false })
  assert.deepEqual(settings.media, { youtube: false, ffmpeg: false })
  assert.ok(dropped.includes('the media permissions'))
})

test('everything that is only a preference still comes across', () => {
  const { settings } = normaliseSettings(hostile, base(), { trusted: false })
  assert.equal(settings.theme, 'dark')
  assert.equal(settings.density, 'comfortable')
  assert.equal(settings.assistant.model, 'claude-opus-5')
  assert.equal(settings.assistant.contextLimit, 40)
})

test('a file that asks for nothing unusual drops nothing and says nothing', () => {
  const ordinary = { theme: 'dark', assistant: { model: 'claude-sonnet-5' } }
  const { settings, dropped } = normaliseSettings(ordinary, base(), { trusted: false })
  assert.deepEqual(dropped, [])
  assert.equal(settings.theme, 'dark')
  assert.equal(settings.assistant.model, 'claude-sonnet-5')
})

test('this origin own stored state is trusted and keeps its endpoints', () => {
  // The same function runs on load from localStorage, which is this origin's
  // earlier self rather than a file, and there it must not wipe the settings
  // the person actually chose.
  const { settings, dropped } = normaliseSettings(hostile, base(), { trusted: true })
  assert.equal(settings.platform.url, 'https://evil.example/api')
  assert.equal(settings.media.youtube, true)
  assert.deepEqual(dropped, [])
})

test('missing or junk settings fall back to the defaults', () => {
  for (const input of [null, undefined, 'nope', 42, []]) {
    const { settings } = normaliseSettings(input, base(), { trusted: false })
    assert.equal(settings.platform.url, '')
    assert.equal(settings.assistant.provider, 'anthropic')
  }
})

/* --------------------------------------------------- the endpoint itself */

test('a named vendor address cannot be overridden at all', () => {
  // Belt and braces: even if a hostile baseUrl reached settings some other
  // way, there is one Anthropic and it is at one address.
  assert.equal(resolve({ provider: 'anthropic', baseUrl: 'https://evil.example' }).baseUrl, PROVIDERS.anthropic.baseUrl)
  assert.equal(endpointFor('anthropic', 'https://evil.example'), PROVIDERS.anthropic.baseUrl)
})

test('a bring-your-own provider keeps the endpoint someone chose', () => {
  // "OpenAI-compatible" and Ollama exist to be pointed somewhere, so the
  // catalogue cannot defend them - only the file rule above can.
  assert.equal(resolve({ provider: 'openai', baseUrl: 'https://my-vllm.internal/v1' }).baseUrl, 'https://my-vllm.internal/v1')
  assert.equal(resolve({ provider: 'ollama', baseUrl: 'http://localhost:11434' }).baseUrl, 'http://localhost:11434')
})

test('a bring-your-own endpoint still has to be a real http URL', () => {
  for (const junk of ['javascript:alert(1)', 'data:text/html,x', 'not a url', '']) {
    assert.equal(resolve({ provider: 'openai', baseUrl: junk }).baseUrl, PROVIDERS.openai.baseUrl, junk)
  }
})

test('an unknown provider does not fall through to an attacker URL', () => {
  assert.equal(resolve({ provider: 'nope', baseUrl: 'https://evil.example' }).baseUrl, PROVIDERS.anthropic.baseUrl)
})

/* -------------------------------------------------------------- youtube */

test('the frame checks the video id the way the thumbnails always did', () => {
  assert.equal(embedUrl({ id: '../../evil?x=1' }), '')
  assert.equal(embedUrl({ id: 'not-an-id' }), '')
  assert.equal(watchUrl('../../evil'), '')
  assert.deepEqual(thumbnails('../../evil'), [])

  assert.ok(embedUrl({ id: 'dQw4w9WgXcQ' }).startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?'))
  assert.ok(watchUrl('dQw4w9WgXcQ').startsWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
})

test('a hostile playlist id is refused but a real one still plays', () => {
  assert.equal(embedUrl({ list: 'x"><script>' }), '')
  const url = embedUrl({ id: 'dQw4w9WgXcQ', list: 'PLabcdefghijk' })
  assert.ok(url.includes('list=PLabcdefghijk'))
})
