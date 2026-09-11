/*
 * Camera and microphone.
 *
 * getUserMedia and MediaRecorder, with the error messages turned into
 * sentences a person can act on. "NotAllowedError" tells someone nothing;
 * "the browser blocked the camera, check the icon in the address bar" tells
 * them where to click.
 */

import { pickMimeType, extensionFor } from './transcode.js'

export { pickMimeType, extensionFor }

/** getUserMedia is absent on http:// origins other than localhost, which is
    the single most common reason the camera "does not work". */
export const canCapture = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

export const isSecure = () =>
  typeof window === 'undefined' || window.isSecureContext !== false

/** Turn a getUserMedia rejection into something worth reading. */
export function describeCaptureError(err) {
  const name = err?.name || ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The browser blocked access. Allow the camera and microphone for this site, then try again.'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera or microphone was found on this device.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Something else is already using the camera. Close the other app or tab and try again.'
  }
  if (name === 'OverconstrainedError') {
    return 'That camera cannot do the requested resolution. Pick another one.'
  }
  if (name === 'AbortError') return 'The camera stopped unexpectedly.'
  return err?.message || 'The camera could not be opened.'
}

/** Cameras and microphones. Labels stay blank until permission is granted
    once, which is a browser privacy rule, not a bug to work around. */
export async function listDevices() {
  if (!canCapture() || !navigator.mediaDevices.enumerateDevices) return { cameras: [], microphones: [] }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const pick = (kind) => devices
      .filter((d) => d.kind === kind)
      .map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === 'videoinput' ? 'Camera' : 'Microphone'} ${i + 1}` }))
    return { cameras: pick('videoinput'), microphones: pick('audioinput') }
  } catch {
    return { cameras: [], microphones: [] }
  }
}

export async function openCamera({ deviceId = '', facingMode = 'user', withAudio = true, width = 1280, height = 720 } = {}) {
  if (!canCapture()) {
    throw new Error(isSecure()
      ? 'This browser has no camera support.'
      : 'The camera needs a secure page. Open this app over https, or on localhost.')
  }
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height } }
    : { facingMode, width: { ideal: width }, height: { ideal: height } }
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: withAudio })
  } catch (err) {
    // An exact deviceId that has been unplugged fails hard; anything is
    // better than a dead view, so fall back to whatever camera exists.
    if (deviceId && err?.name === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: withAudio })
    }
    throw new Error(describeCaptureError(err))
  }
}

export async function openMicrophone({ deviceId = '' } = {}) {
  if (!canCapture()) throw new Error('This browser has no microphone support.')
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    })
  } catch (err) {
    throw new Error(describeCaptureError(err))
  }
}

export function stopStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    try { track.stop() } catch { /* already ended */ }
  }
}

/**
 * A still from a running preview.
 *
 * A front camera is previewed mirrored, because an un-mirrored preview feels
 * wrong to look at, but the saved photo is not mirrored unless asked - a
 * mirrored photo puts the text in the room backwards.
 */
export function takePhoto(video, { mirror = false, type = 'image/jpeg', quality = 0.92 } = {}) {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) return Promise.reject(new Error('The camera has not produced a frame yet.'))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (mirror) { ctx.translate(width, 0); ctx.scale(-1, 1) }
  ctx.drawImage(video, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width, height }) : reject(new Error('The frame could not be encoded.'))),
      type,
      quality,
    )
  })
}

/**
 * Record a live stream. Returns a handle, not a promise, because the caller
 * needs to stop and pause it while it runs.
 */
export function recordStream(stream, { mimeType, videoBps, audioBps, timeslice = 1000 } = {}) {
  const type = pickMimeType(mimeType ? [mimeType] : [])
  if (!type) throw new Error('This browser will not record video.')
  const recorder = new MediaRecorder(stream, {
    mimeType: type,
    videoBitsPerSecond: videoBps || undefined,
    audioBitsPerSecond: audioBps || undefined,
  })
  const chunks = []
  recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type }))
    recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'))
  })

  recorder.start(timeslice)
  const startedAt = Date.now()
  let pausedFor = 0
  let pausedAt = 0

  return {
    mimeType: type,
    get state() { return recorder.state },
    /** Wall-clock seconds of actual recording, with pauses taken out. */
    elapsed() {
      const paused = pausedAt ? Date.now() - pausedAt : 0
      return (Date.now() - startedAt - pausedFor - paused) / 1000
    },
    pause() {
      if (recorder.state === 'recording') { recorder.pause(); pausedAt = Date.now() }
    },
    resume() {
      if (recorder.state === 'paused') { pausedFor += Date.now() - pausedAt; pausedAt = 0; recorder.resume() }
    },
    stop() {
      if (recorder.state !== 'inactive') recorder.stop()
      return done
    },
    done,
  }
}

/**
 * A poster frame for a recording that has just been made, so the gallery is
 * not a wall of black rectangles.
 *
 * A WebM written by MediaRecorder reports duration Infinity until something
 * seeks it, and frame zero of almost any clip is black, so this always seeks
 * a fraction in and waits for the seek rather than grabbing on loadeddata.
 */
export function posterFrom(blob, { atSecond = 0.15, timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'

    let settled = false
    const give = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(value)
    }

    const grab = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        if (!canvas.width || !canvas.height) return give(null)
        canvas.getContext('2d').drawImage(video, 0, 0)
        canvas.toBlob((out) => give(out), 'image/jpeg', 0.7)
      } catch { give(null) }
    }

    // Whatever happens, do not hang the save behind a decoder that will not
    // cooperate: after the timeout, take the frame that is there.
    const timer = setTimeout(grab, timeoutMs)

    video.onseeked = grab
    video.onloadeddata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0
      const target = duration ? Math.min(atSecond, duration / 2) : atSecond
      // Setting currentTime to the same value fires no seeked event.
      if (Math.abs(video.currentTime - target) < 0.001) grab()
      else video.currentTime = target
    }
    video.onerror = () => give(null)
    video.src = url
  })
}
