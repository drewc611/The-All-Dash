/*
 * Video compression.
 *
 * Two engines, one interface.
 *
 * The default is native: decode the source into a <video>, draw each frame
 * the decoder produces onto a canvas at the target size, capture that canvas
 * as a MediaStream, and record the stream with MediaRecorder at a chosen
 * bitrate. No dependency, no download, works offline.
 *
 * Its one real cost is honest and unavoidable: a <video> decodes in real
 * time, so a ten-minute clip takes about ten minutes. Raising playbackRate
 * would finish sooner and produce a sped-up video, because the canvas stream
 * is captured against the wall clock, so the rate stays at 1.
 *
 * The opt-in engine is ffmpeg.wasm, loaded from a CDN the first time it is
 * used. It transcodes far faster than real time and reaches formats a
 * browser will not record, at the cost of a ~32MB download and an app that
 * is no longer dependency-free. Settings decides; this module just obeys.
 */

const BITS_PER_PIXEL = { small: 0.03, balanced: 0.05, high: 0.09 }
const AUDIO_BPS = { small: 96_000, balanced: 128_000, high: 192_000 }

const MIN_VIDEO_BPS = 150_000
const MAX_VIDEO_BPS = 20_000_000

export const QUALITIES = [
  { id: 'small', label: 'Smallest', hint: 'Good enough to share in a chat' },
  { id: 'balanced', label: 'Balanced', hint: 'The one to pick' },
  { id: 'high', label: 'Best looking', hint: 'Keeps detail, saves less' },
]

/** Presets name the short edge, so a portrait phone clip scales the way a
    person expects rather than being squashed to letterbox height. */
export const PRESETS = [
  { id: 'source', label: 'Same size', shortEdge: 0 },
  { id: '1080', label: '1080p', shortEdge: 1080 },
  { id: '720', label: '720p', shortEdge: 720 },
  { id: '480', label: '480p', shortEdge: 480 },
  { id: '360', label: '360p', shortEdge: 360 },
  { id: '240', label: '240p', shortEdge: 240 },
]

/** Encoders reject odd dimensions, and nothing here ever upscales: asking for
    1080p from a 480p source would cost bytes and add no detail. */
export function scaleTo(width, height, shortEdge) {
  const w = Math.max(2, Math.round(Number(width) || 0))
  const h = Math.max(2, Math.round(Number(height) || 0))
  const even = (n) => Math.max(2, Math.round(n / 2) * 2)
  if (!shortEdge) return { width: even(w), height: even(h), scale: 1 }
  const short = Math.min(w, h)
  const scale = Math.min(1, shortEdge / short)
  return { width: even(w * scale), height: even(h * scale), scale }
}

/**
 * Bits per second for a frame size, from bits-per-pixel-per-frame. A pixel
 * count is the only thing that actually predicts a bitrate; naming fixed
 * numbers per preset falls apart the moment a source is portrait or 60fps.
 */
export function bitrateFor({ width, height, fps = 30, quality = 'balanced' }) {
  const bpp = BITS_PER_PIXEL[quality] ?? BITS_PER_PIXEL.balanced
  const raw = Math.round((Number(width) || 0) * (Number(height) || 0) * (Number(fps) || 30) * bpp)
  return Math.min(MAX_VIDEO_BPS, Math.max(MIN_VIDEO_BPS, raw))
}

export const audioBitrateFor = (quality = 'balanced') => AUDIO_BPS[quality] ?? AUDIO_BPS.balanced

/** What the result should weigh. An estimate, and labelled as one in the UI:
    a real encoder spends fewer bits on a static shot than on confetti. */
export function estimateSize({ durationSeconds, videoBps, audioBps = 0 }) {
  const seconds = Math.max(0, Number(durationSeconds) || 0)
  return Math.round(((Number(videoBps) || 0) + (Number(audioBps) || 0)) * seconds / 8)
}

/** Everything the UI needs to describe a job before running it. */
export function planJob({ width, height, fps = 30, duration = 0, size = 0, sourceSize = size, preset = '720', quality = 'balanced', withAudio = true }) {
  const chosen = PRESETS.find((p) => p.id === preset) || PRESETS[0]
  const frame = scaleTo(width, height, chosen.shortEdge)
  const videoBps = bitrateFor({ width: frame.width, height: frame.height, fps, quality })
  const audioBps = withAudio ? audioBitrateFor(quality) : 0
  const estimated = estimateSize({ durationSeconds: duration, videoBps, audioBps })
  return {
    ...frame,
    fps,
    videoBps,
    audioBps,
    estimated,
    sourceSize: Number(sourceSize) || 0,
    // Real time, plus a little: the decoder cannot outrun the clock.
    estimatedSeconds: Math.ceil((Number(duration) || 0) * 1.05),
  }
}

const CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
]

/** The first container this browser will actually record. Safari only
    recently grew MediaRecorder, and only for MP4. */
export function pickMimeType(preferred = []) {
  if (typeof MediaRecorder === 'undefined') return ''
  for (const type of [...preferred, ...CANDIDATES]) {
    try { if (MediaRecorder.isTypeSupported(type)) return type } catch { /* older Safari throws */ }
  }
  return ''
}

export const extensionFor = (mimeType) => (String(mimeType).includes('mp4') ? 'mp4' : 'webm')

/**
 * Resolve a duration a WebM will not admit to.
 *
 * A file written by MediaRecorder has no duration in its header, so the
 * element reports Infinity until something forces it to scan to the end.
 * Seeking past the end does that; the browser then clamps currentTime and
 * fires durationchange with the real value.
 */
function resolveDuration(video, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (Number.isFinite(video.duration) && video.duration > 0) return resolve(video.duration)
    let settled = false
    const give = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      video.ontimeupdate = null
      video.ondurationchange = null
      // Leave the element where a caller expects it: at the start.
      try { video.currentTime = 0 } catch { /* not seekable */ }
      resolve(value)
    }
    const timer = setTimeout(() => give(0), timeoutMs)
    const check = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) give(video.duration)
    }
    video.ondurationchange = check
    video.ontimeupdate = check
    try { video.currentTime = 1e101 } catch { give(0) }
  })
}

/** Load a file into a <video> far enough to know its shape. */
export function probe(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    const done = (fn) => (arg) => { URL.revokeObjectURL(url); fn(arg) }
    video.onloadedmetadata = async () => {
      if (!video.videoWidth || !video.videoHeight) {
        return done(reject)(new Error('That file has no video track this browser can read.'))
      }
      const duration = await resolveDuration(video)
      done(resolve)({
        width: video.videoWidth,
        height: video.videoHeight,
        duration,
        size: file.size,
        type: file.type,
        name: file.name,
      })
    }
    video.onerror = () => done(reject)(new Error('This browser cannot decode that file.'))
    video.src = url
  })
}

/**
 * Native re-encode. Resolves with { blob, mimeType, width, height, duration }.
 *
 * onProgress gets 0..1 based on playback position, which is the only honest
 * progress signal available: MediaRecorder will not say how far along it is.
 */
export async function transcodeNative(file, options = {}, { onProgress, signal } = {}) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser has no MediaRecorder, so it cannot re-encode video.')
  const mimeType = pickMimeType(options.mimeType ? [options.mimeType] : [])
  if (!mimeType) throw new Error('This browser will not record any video format.')

  const info = await probe(file)
  const plan = planJob({ ...info, ...options })
  const url = URL.createObjectURL(file)

  const video = document.createElement('video')
  video.src = url
  video.playsInline = true
  video.muted = true          // the tab stays silent; the encoder still gets audio
  video.crossOrigin = 'anonymous'

  const canvas = document.createElement('canvas')
  canvas.width = plan.width
  canvas.height = plan.height
  const ctx = canvas.getContext('2d', { alpha: false })

  let audioCtx = null
  const cleanup = () => {
    URL.revokeObjectURL(url)
    video.removeAttribute('src')
    video.load()
    if (audioCtx) audioCtx.close().catch(() => {})
  }

  try {
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve
      video.onerror = () => reject(new Error('This browser cannot decode that file.'))
    })

    const stream = canvas.captureStream(plan.fps)

    // Route the element's audio into the recording without playing it aloud.
    // A source with no audio track yields a silent node, which would waste
    // bitrate on nothing, so it is only wired up when there is something there.
    if (plan.audioBps > 0 && hasAudio(video)) {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (Ctx) {
        audioCtx = new Ctx()
        const destination = audioCtx.createMediaStreamDestination()
        audioCtx.createMediaElementSource(video).connect(destination)
        for (const track of destination.stream.getAudioTracks()) stream.addTrack(track)
      }
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: plan.videoBps,
      audioBitsPerSecond: plan.audioBps || undefined,
    })

    const chunks = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }

    const finished = new Promise((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }))
      recorder.onerror = (e) => reject(e.error || new Error('The recorder failed part-way through.'))
    })

    recorder.start(1000)
    await video.play()

    // requestVideoFrameCallback fires once per decoded frame, so nothing is
    // dropped or drawn twice. rAF is the fallback, tied to display refresh.
    const draw = () => ctx.drawImage(video, 0, 0, plan.width, plan.height)
    const useFrameCallback = typeof video.requestVideoFrameCallback === 'function'
    let stopped = false

    const pump = () => {
      if (stopped || video.ended) return
      draw()
      onProgress?.(video.duration ? Math.min(1, video.currentTime / video.duration) : 0)
      if (useFrameCallback) video.requestVideoFrameCallback(pump)
      else requestAnimationFrame(pump)
    }
    pump()

    const abort = () => {
      stopped = true
      video.pause()
      if (recorder.state !== 'inactive') recorder.stop()
    }
    signal?.addEventListener('abort', abort, { once: true })

    await new Promise((resolve) => {
      video.onended = resolve
      signal?.addEventListener('abort', resolve, { once: true })
    })

    stopped = true
    // A last frame, so the final moment is not missing from the output.
    if (!signal?.aborted) draw()
    if (recorder.state !== 'inactive') recorder.stop()

    const blob = await finished
    if (signal?.aborted) throw new DOMException('Compression cancelled.', 'AbortError')
    onProgress?.(1)
    return { blob, mimeType, width: plan.width, height: plan.height, duration: info.duration, plan }
  } finally {
    cleanup()
  }
}

/** A muted element reports nothing useful, so ask the tracks where possible
    and otherwise assume audio rather than silently dropping it. */
function hasAudio(video) {
  if (typeof video.mozHasAudio === 'boolean') return video.mozHasAudio
  if (typeof video.webkitAudioDecodedByteCount === 'number') return video.webkitAudioDecodedByteCount > 0
  if (video.audioTracks) return video.audioTracks.length > 0
  return true
}

/* ------------------------------------------------------------- ffmpeg.wasm */

// Pinned, because "latest" on a CDN is a dependency that changes under you.
const FFMPEG_VERSION = '0.12.10'
const CORE_VERSION = '0.12.6'
const CDN = 'https://cdn.jsdelivr.net/npm'

// The single-threaded core on purpose: the multi-threaded one needs COOP and
// COEP headers, which this app cannot set when served as static files.
const CORE_BASE = `${CDN}/@ffmpeg/core@${CORE_VERSION}/dist/umd`

export const FFMPEG_DOWNLOAD_BYTES = 32_000_000

let ffmpegPromise = null

/** Fetch and start ffmpeg.wasm. Returns the running instance. */
export function loadFfmpeg({ onProgress } = {}) {
  if (ffmpegPromise) return ffmpegPromise
  ffmpegPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import(/* @vite-ignore */ `${CDN}/@ffmpeg/ffmpeg@${FFMPEG_VERSION}/dist/esm/index.js`),
      import(/* @vite-ignore */ `${CDN}/@ffmpeg/util@0.12.2/dist/esm/index.js`),
    ])
    const ffmpeg = new FFmpeg()
    ffmpeg.on('progress', ({ progress }) => onProgress?.(Math.min(1, Math.max(0, progress || 0))))
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    return ffmpeg
  })()
  ffmpegPromise.catch(() => { ffmpegPromise = null })
  return ffmpegPromise
}

export const ffmpegReady = () => ffmpegPromise !== null

/** The argument list for one job, split out so it can be read and tested
    without a 32MB download in the room. */
export function ffmpegArgs({ input, output, width, height, videoBps, audioBps, codec = 'h264' }) {
  const kbps = (n) => `${Math.round(n / 1000)}k`
  const args = ['-i', input]
  if (width && height) args.push('-vf', `scale=${width}:${height}`)
  args.push('-c:v', codec === 'vp9' ? 'libvpx-vp9' : 'libx264')
  if (codec !== 'vp9') args.push('-preset', 'veryfast', '-movflags', '+faststart')
  args.push('-b:v', kbps(videoBps))
  if (audioBps > 0) args.push('-c:a', 'aac', '-b:a', kbps(audioBps))
  else args.push('-an')
  args.push(output)
  return args
}

export async function transcodeFfmpeg(file, options = {}, { onProgress, signal } = {}) {
  const info = await probe(file)
  const plan = planJob({ ...info, ...options })
  const ffmpeg = await loadFfmpeg({ onProgress })

  const codec = options.codec === 'vp9' ? 'vp9' : 'h264'
  const output = codec === 'vp9' ? 'out.webm' : 'out.mp4'
  const input = `in.${(file.name.split('.').pop() || 'mp4').toLowerCase().slice(0, 5)}`

  signal?.addEventListener('abort', () => { try { ffmpeg.terminate() } catch { /* already gone */ } }, { once: true })

  await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
  await ffmpeg.exec(ffmpegArgs({ input, output, width: plan.width, height: plan.height, videoBps: plan.videoBps, audioBps: plan.audioBps, codec }))
  const data = await ffmpeg.readFile(output)
  await ffmpeg.deleteFile(input).catch(() => {})
  await ffmpeg.deleteFile(output).catch(() => {})

  const mimeType = codec === 'vp9' ? 'video/webm' : 'video/mp4'
  onProgress?.(1)
  return { blob: new Blob([data.buffer], { type: mimeType }), mimeType, width: plan.width, height: plan.height, duration: info.duration, plan }
}

/** One entry point. engine is 'native' or 'ffmpeg'. */
export function transcode(file, options = {}, hooks = {}) {
  return options.engine === 'ffmpeg' ? transcodeFfmpeg(file, options, hooks) : transcodeNative(file, options, hooks)
}
