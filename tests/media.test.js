import test from 'node:test'
import assert from 'node:assert/strict'

import { parseYouTube, parseTime, embedUrl, thumbnails, watchUrl } from '../src/media/youtube.js'
import { scaleTo, bitrateFor, estimateSize, planJob, ffmpegArgs, extensionFor, PRESETS, QUALITIES } from '../src/media/transcode.js'
import { formatBytes, formatDuration, savings, mediaEntity, liveBlobIds, mediaKind, isPlayableAudio } from '../src/media/schema.js'
import { buildOrder, nextIndex, prevIndex } from '../src/media/player.js'

/* ------------------------------------------------------------------ YouTube */

test('reads every shape of YouTube link a person might paste', () => {
  const cases = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    'youtube.com/watch?v=dQw4w9WgXcQ',
    'dQw4w9WgXcQ',
  ]
  for (const input of cases) {
    assert.equal(parseYouTube(input)?.id, 'dQw4w9WgXcQ', input)
  }
})

test('keeps the playlist and the start time', () => {
  const withList = parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')
  assert.equal(withList.list, 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')

  assert.equal(parseYouTube('https://youtu.be/dQw4w9WgXcQ?t=90').start, 90)
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s').start, 3723)
  assert.equal(parseYouTube('https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45').start, 45)
})

test('a playlist with no video still parses, as a playlist', () => {
  const only = parseYouTube('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')
  assert.equal(only.id, null)
  assert.equal(only.list, 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')
})

test('refuses links that are not YouTube, including lookalike hosts', () => {
  for (const input of [
    '', '   ', 'not a url',
    'https://vimeo.com/12345',
    'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=tooshort',
    'https://www.youtube.com/feed/subscriptions',
  ]) {
    assert.equal(parseYouTube(input), null, JSON.stringify(input))
  }
})

test('time strings that make no sense read as zero, never NaN', () => {
  for (const input of ['', 'abc', null, undefined, '1x2y']) {
    assert.equal(parseTime(input), 0, String(input))
  }
  assert.equal(parseTime('2:30'), 150)
  assert.equal(parseTime('1:02:03'), 3723)
})

test('embeds use the no-cookie host and carry the options', () => {
  const url = embedUrl({ id: 'dQw4w9WgXcQ', start: 30, autoplay: true, origin: 'https://example.com' })
  assert.match(url, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/)
  assert.match(url, /start=30/)
  assert.match(url, /autoplay=1/)
  assert.match(url, /origin=https%3A%2F%2Fexample\.com/)
  assert.equal(embedUrl({}), '')

  // A playlist with no video id is the videoseries embed.
  assert.match(embedUrl({ list: 'PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI' }), /embed\/videoseries\?/)
})

test('thumbnails only exist for a real id', () => {
  assert.equal(thumbnails('dQw4w9WgXcQ').length, 3)
  assert.deepEqual(thumbnails('nope'), [])
  assert.equal(watchUrl('dQw4w9WgXcQ', 12), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12')
})

/* ---------------------------------------------------------------- transcode */

test('scaling caps the short edge, keeps aspect and never upscales', () => {
  // Landscape 1080p down to 720p.
  assert.deepEqual(scaleTo(1920, 1080, 720), { width: 1280, height: 720, scale: 720 / 1080 })
  // Portrait: the short edge is the width, so it becomes 720 wide.
  const portrait = scaleTo(1080, 1920, 720)
  assert.equal(portrait.width, 720)
  assert.equal(portrait.height, 1280)
  // A 480p source asked for 1080p is left alone.
  const small = scaleTo(854, 480, 1080)
  assert.equal(small.scale, 1)
  assert.equal(small.height, 480)
  // "Same size" passes through.
  assert.equal(scaleTo(1920, 1080, 0).width, 1920)
})

test('every scaled dimension is even, because encoders reject odd ones', () => {
  for (const [w, h, edge] of [[1919, 1079, 720], [641, 361, 360], [1233, 999, 480], [100, 75, 33]]) {
    const out = scaleTo(w, h, edge)
    assert.equal(out.width % 2, 0, `${w}x${h}@${edge} width`)
    assert.equal(out.height % 2, 0, `${w}x${h}@${edge} height`)
    assert.ok(out.width >= 2 && out.height >= 2)
  }
})

test('bitrate follows pixel count and frame rate', () => {
  const p720 = bitrateFor({ width: 1280, height: 720, fps: 30, quality: 'balanced' })
  const p1080 = bitrateFor({ width: 1920, height: 1080, fps: 30, quality: 'balanced' })
  assert.ok(p1080 > p720, '1080p costs more than 720p')

  const sixty = bitrateFor({ width: 1280, height: 720, fps: 60, quality: 'balanced' })
  assert.equal(sixty, p720 * 2, 'twice the frames, twice the bits')

  const small = bitrateFor({ width: 1280, height: 720, fps: 30, quality: 'small' })
  const high = bitrateFor({ width: 1280, height: 720, fps: 30, quality: 'high' })
  assert.ok(small < p720 && p720 < high)
})

test('bitrate is clamped at both ends', () => {
  assert.ok(bitrateFor({ width: 16, height: 16, fps: 1, quality: 'small' }) >= 150_000)
  assert.ok(bitrateFor({ width: 7680, height: 4320, fps: 120, quality: 'high' }) <= 20_000_000)
  // Garbage in still yields a usable number.
  assert.ok(Number.isFinite(bitrateFor({ width: NaN, height: undefined })))
})

test('size estimate is bitrate times duration over eight', () => {
  assert.equal(estimateSize({ durationSeconds: 60, videoBps: 1_000_000, audioBps: 128_000 }), Math.round(1_128_000 * 60 / 8))
  assert.equal(estimateSize({ durationSeconds: 0, videoBps: 1_000_000 }), 0)
  assert.equal(estimateSize({ durationSeconds: -5, videoBps: 1_000_000 }), 0)
})

test('a job plan describes the whole encode before it runs', () => {
  const plan = planJob({ width: 1920, height: 1080, fps: 30, duration: 120, sourceSize: 200_000_000, preset: '720', quality: 'balanced' })
  assert.equal(plan.width, 1280)
  assert.equal(plan.height, 720)
  assert.ok(plan.estimated > 0 && plan.estimated < plan.sourceSize, 'a 1080p source shrinks at 720p')
  assert.ok(plan.estimatedSeconds >= 120, 'a real-time decode cannot beat the clock')

  const muted = planJob({ width: 1280, height: 720, duration: 10, withAudio: false })
  assert.equal(muted.audioBps, 0)

  // An unknown preset falls back rather than throwing.
  assert.ok(planJob({ width: 640, height: 480, preset: 'nonsense' }).width > 0)
})

test('every preset and quality id is usable in a plan', () => {
  for (const preset of PRESETS) {
    for (const quality of QUALITIES) {
      const plan = planJob({ width: 1920, height: 1080, duration: 10, preset: preset.id, quality: quality.id })
      assert.ok(plan.width > 0 && plan.videoBps > 0, `${preset.id}/${quality.id}`)
    }
  }
})

test('ffmpeg arguments say what they mean', () => {
  const args = ffmpegArgs({ input: 'in.mp4', output: 'out.mp4', width: 1280, height: 720, videoBps: 1_400_000, audioBps: 128_000 })
  assert.deepEqual(args.slice(0, 2), ['-i', 'in.mp4'])
  assert.ok(args.includes('scale=1280:720'))
  assert.ok(args.includes('libx264'))
  assert.ok(args.includes('1400k'))
  assert.ok(args.includes('128k'))
  assert.equal(args.at(-1), 'out.mp4')

  const silent = ffmpegArgs({ input: 'in.mov', output: 'out.webm', width: 640, height: 360, videoBps: 500_000, audioBps: 0, codec: 'vp9' })
  assert.ok(silent.includes('-an'), 'no audio bitrate means no audio track')
  assert.ok(silent.includes('libvpx-vp9'))
  assert.ok(!silent.includes('-movflags'), 'faststart is an MP4 idea')
})

test('the extension matches the container', () => {
  assert.equal(extensionFor('video/mp4'), 'mp4')
  assert.equal(extensionFor('video/webm;codecs=vp9,opus'), 'webm')
})

/* ------------------------------------------------------------------ records */

test('bytes read the way a person reads them', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(999), '999 B')
  assert.equal(formatBytes(1000), '1.0 KB')
  assert.equal(formatBytes(1_500_000), '1.5 MB')
  assert.equal(formatBytes(15_000_000), '15 MB')
  assert.equal(formatBytes(2_400_000_000), '2.4 GB')
  assert.equal(formatBytes(-1), '—')
  assert.equal(formatBytes('nonsense'), '—')
})

test('durations read as clock time', () => {
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(9), '0:09')
  assert.equal(formatDuration(65), '1:05')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(-4), '0:00')
  assert.equal(formatDuration(undefined), '0:00')
})

test('savings names the direction, including when a re-encode grew the file', () => {
  const smaller = savings(100, 32)
  assert.equal(smaller.percent, 68)
  assert.equal(smaller.smaller, true)
  assert.equal(smaller.label, '68% smaller')

  const bigger = savings(100, 112)
  assert.equal(bigger.smaller, false)
  assert.equal(bigger.label, '12% bigger')

  assert.equal(savings(0, 10), null)
  assert.equal(savings(NaN, 10), null)
})

test('media is an ordinary entity, so the rest of the app already understands it', () => {
  const e = mediaEntity({
    id: 'med-1',
    kind: 'video',
    title: 'Standup clip',
    blobId: 'blob-1',
    mimeType: 'video/webm',
    size: 4_200_000,
    duration: 42,
    width: 1280,
    height: 720,
    at: '2026-09-11T10:00:00.000Z',
    tags: ['standup'],
  })
  assert.equal(e.type, 'media')
  assert.equal(e.id, 'med-1')
  assert.equal(e.meta.kind, 'video')
  assert.equal(e.meta.blobId, 'blob-1')
  assert.ok(e.tags.includes('video') && e.tags.includes('standup'))
  assert.equal(e.at, '2026-09-11T10:00:00.000Z')
  assert.equal(mediaKind(e), 'video')
  assert.equal(isPlayableAudio(e), true)
})

test('two photos a second apart stay two records', () => {
  const a = mediaEntity({ id: 'a', kind: 'photo', title: 'Whiteboard', blobId: 'b1' })
  const b = mediaEntity({ id: 'b', kind: 'photo', title: 'Whiteboard', blobId: 'b2' })
  assert.notEqual(a.id, b.id)
})

test('a YouTube record points outward and carries no blob', () => {
  const e = mediaEntity({ id: 'yt-1', kind: 'youtube', title: 'A talk', youtubeId: 'dQw4w9WgXcQ' })
  assert.equal(e.meta.blobId, null)
  assert.equal(e.meta.youtubeId, 'dQw4w9WgXcQ')
  assert.equal(e.source.kind, 'youtube')
  assert.match(e.source.url, /dQw4w9WgXcQ/)
  assert.equal(isPlayableAudio(e), false, 'a YouTube link is not a local audio file')
})

test('an unknown kind falls back rather than producing a broken record', () => {
  const e = mediaEntity({ id: 'x', kind: 'hologram', title: 'Nope' })
  assert.equal(e.meta.kind, 'video')
})

test('live blob ids find every byte still spoken for', () => {
  const entities = [
    mediaEntity({ id: 'a', kind: 'video', title: 'A', blobId: 'b1', meta: { posterId: 'p1' } }),
    mediaEntity({ id: 'b', kind: 'youtube', title: 'B', youtubeId: 'dQw4w9WgXcQ' }),
    { id: 'c', type: 'task', title: 'Not media' },
  ]
  const ids = liveBlobIds(entities)
  assert.ok(ids.includes('b1') && ids.includes('p1'))
  assert.equal(ids.length, 2)
  assert.deepEqual(liveBlobIds(null), [])
})

/* ------------------------------------------------------------------- queue */

test('order is the identity until shuffle is on', () => {
  assert.deepEqual(buildOrder(4, { shuffle: false }), [0, 1, 2, 3])
  assert.deepEqual(buildOrder(1, { shuffle: true, current: 0 }), [0])
  assert.deepEqual(buildOrder(0, { shuffle: true }), [])
})

test('shuffle keeps the current track first and loses nothing', () => {
  for (let run = 0; run < 40; run += 1) {
    const order = buildOrder(8, { shuffle: true, current: 3 })
    assert.equal(order[0], 3, 'what is playing keeps playing')
    assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7])
  }
})

test('next stops at the end, wraps on repeat-all, holds on repeat-one', () => {
  const order = [0, 1, 2]
  assert.equal(nextIndex({ order, index: 0, repeat: 'off' }), 1)
  assert.equal(nextIndex({ order, index: 2, repeat: 'off' }), null)
  assert.equal(nextIndex({ order, index: 2, repeat: 'all' }), 0)
  assert.equal(nextIndex({ order, index: 1, repeat: 'one' }, { manual: false }), 1)
})

test('pressing skip on repeat-one moves on, because that is what skip means', () => {
  const order = [0, 1, 2]
  assert.equal(nextIndex({ order, index: 1, repeat: 'one' }, { manual: true }), 2)
})

test('next follows the shuffled order, not the queue order', () => {
  const order = [2, 0, 1]
  assert.equal(nextIndex({ order, index: 2, repeat: 'off' }), 0)
  assert.equal(nextIndex({ order, index: 0, repeat: 'off' }), 1)
  assert.equal(nextIndex({ order, index: 1, repeat: 'all' }), 2)
})

test('back wraps to the end and survives an empty queue', () => {
  assert.equal(prevIndex({ order: [0, 1, 2], index: 0 }), 2)
  assert.equal(prevIndex({ order: [0, 1, 2], index: 2 }), 1)
  assert.equal(prevIndex({ order: [], index: 0 }), null)
  assert.equal(nextIndex({ order: [], index: 0 }), null)
})
