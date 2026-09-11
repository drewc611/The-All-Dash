import { useCallback, useEffect, useRef, useState } from 'react'
import { addEntity } from '../../core/store.js'
import { putBlob } from '../../media/blobs.js'
import { mediaEntity, formatDuration, formatBytes } from '../../media/schema.js'
import { canCapture, isSecure, listDevices, openCamera, stopStream, takePhoto, recordStream, posterFrom } from '../../media/capture.js'
import { bitrateFor, audioBitrateFor } from '../../media/transcode.js'
import { uid } from '../../core/id.js'
import { Empty } from '../components.jsx'
import { IconCamera, IconVideo, IconStop, IconImage } from '../icons.jsx'

const RESOLUTIONS = [
  { id: '1080', label: '1080p', width: 1920, height: 1080 },
  { id: '720', label: '720p', width: 1280, height: 720 },
  { id: '480', label: '480p', width: 854, height: 480 },
]

/**
 * The camera.
 *
 * A preview from getUserMedia, stills through a canvas, clips through
 * MediaRecorder. Each capture is written to IndexedDB and gets a media
 * entity, so a photo of a whiteboard lands in the Library next to the notes
 * from the same meeting.
 */
export function Camera({ onToast }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recorderRef = useRef(null)
  const tickRef = useRef(null)

  const [devices, setDevices] = useState({ cameras: [], microphones: [] })
  const [deviceId, setDeviceId] = useState('')
  const [facing, setFacing] = useState('user')
  const [withAudio, setWithAudio] = useState(true)
  const [resolution, setResolution] = useState('720')
  const [live, setLive] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [shot, setShot] = useState(null)

  // A front camera is previewed mirrored because an un-mirrored preview of
  // your own face feels wrong; the saved file is never mirrored.
  const mirrored = !deviceId && facing === 'user'

  const teardown = useCallback(() => {
    clearInterval(tickRef.current)
    if (recorderRef.current?.state === 'recording') { try { recorderRef.current.stop() } catch { /* gone */ } }
    recorderRef.current = null
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setLive(false)
    setRecording(false)
    setPaused(false)
    setElapsed(0)
  }, [])

  // Closing the view, or backgrounding the tab, must release the camera - a
  // lit indicator light on an app nobody is looking at is inexcusable.
  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const size = RESOLUTIONS.find((r) => r.id === resolution) || RESOLUTIONS[1]
      const stream = await openCamera({ deviceId, facingMode: facing, withAudio, width: size.width, height: size.height })
      stopStream(streamRef.current)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setLive(true)
      // Labels only exist once permission has been granted, so the device
      // list is worth re-reading after the first successful open.
      setDevices(await listDevices())
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }, [deviceId, facing, withAudio, resolution])

  useEffect(() => { listDevices().then(setDevices) }, [])

  // Switching camera, microphone or resolution mid-preview should just work.
  useEffect(() => {
    if (live && !recording) start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, facing, withAudio, resolution])

  async function save(blob, kind, extra = {}) {
    const id = uid('med')
    const blobId = uid('blob')
    try {
      await putBlob(blobId, blob, { kind })
      let posterId = null
      if (kind === 'video') {
        const poster = await posterFrom(blob)
        if (poster) { posterId = uid('blob'); await putBlob(posterId, poster, { kind: 'poster' }) }
      }
      const entity = mediaEntity({
        id,
        kind,
        title: `${kind === 'photo' ? 'Photo' : 'Recording'} ${new Date().toLocaleString()}`,
        blobId,
        mimeType: blob.type,
        size: blob.size,
        meta: posterId ? { posterId } : {},
        ...extra,
      })
      addEntity(entity)
      onToast?.(`Saved ${formatBytes(blob.size)} to your library`)
      return entity
    } catch (err) {
      // A quota failure must not leave a half-written row behind.
      onToast?.(err?.name === 'QuotaExceededError'
        ? 'There is no room left in storage. Clear some media in Settings.'
        : `Could not save: ${err.message}`)
      return null
    }
  }

  async function onPhoto() {
    if (!videoRef.current || !live) return
    setBusy(true)
    try {
      const { blob, width, height } = await takePhoto(videoRef.current, { mirror: false })
      setShot(URL.createObjectURL(blob))
      await save(blob, 'photo', { width, height })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function onRecord() {
    if (!streamRef.current) return
    const size = RESOLUTIONS.find((r) => r.id === resolution) || RESOLUTIONS[1]
    try {
      const handle = recordStream(streamRef.current, {
        videoBps: bitrateFor({ width: size.width, height: size.height, fps: 30, quality: 'balanced' }),
        audioBps: withAudio ? audioBitrateFor('balanced') : 0,
      })
      recorderRef.current = handle
      setRecording(true)
      setPaused(false)
      tickRef.current = setInterval(() => setElapsed(handle.elapsed()), 250)
    } catch (err) {
      setError(err.message)
    }
  }

  async function onStop() {
    const handle = recorderRef.current
    if (!handle) return
    clearInterval(tickRef.current)
    setBusy(true)
    setRecording(false)
    setPaused(false)
    try {
      const blob = await handle.stop()
      const seconds = handle.elapsed()
      const size = RESOLUTIONS.find((r) => r.id === resolution) || RESOLUTIONS[1]
      await save(blob, 'video', { duration: seconds, width: size.width, height: size.height })
    } catch (err) {
      setError(err.message)
    } finally {
      recorderRef.current = null
      setElapsed(0)
      setBusy(false)
    }
  }

  function onPauseResume() {
    const handle = recorderRef.current
    if (!handle) return
    if (handle.state === 'recording') { handle.pause(); setPaused(true) }
    else { handle.resume(); setPaused(false) }
  }

  if (!canCapture()) {
    return (
      <Empty
        title={isSecure() ? 'This browser has no camera support' : 'The camera needs a secure page'}
        hint={isSecure()
          ? 'getUserMedia is missing here. Everything else in the Studio still works.'
          : 'Browsers only hand over a camera over https, or on localhost. Open the app on a secure address and this view comes alive.'}
      />
    )
  }

  return (
    <div className="cam">
      <div className={`cam__stage${recording ? ' is-recording' : ''}`}>
        <video
          ref={videoRef}
          className={`cam__video${mirrored ? ' is-mirrored' : ''}`}
          playsInline
          muted
          aria-label="Camera preview"
        />

        {!live && (
          <div className="cam__cover">
            <IconCamera width={30} height={30} />
            <p className="cam__covertext">{error || 'The camera is off.'}</p>
            <button type="button" className="btn btn--primary" onClick={start} disabled={busy}>
              {busy ? 'Opening…' : 'Turn on the camera'}
            </button>
          </div>
        )}

        {recording && (
          <div className="cam__timer" role="status">
            <span className={`cam__dot${paused ? ' is-paused' : ''}`} />
            {formatDuration(elapsed)}{paused ? ' · paused' : ''}
          </div>
        )}

        {/* The shutter flash. React owns this node: removing it by hand here
            makes the next render throw on a child that is already gone. */}
        {shot && (
          <img
            className="cam__shot"
            src={shot}
            alt="The photo you just took"
            onAnimationEnd={() => { URL.revokeObjectURL(shot); setShot(null) }}
          />
        )}
      </div>

      {live && (
        <>
          <div className="cam__actions">
            <button type="button" className="btn" onClick={onPhoto} disabled={busy || recording}>
              <IconImage width={13} height={13} /> Photo
            </button>

            {recording ? (
              <>
                <button type="button" className="btn btn--primary cam__rec" onClick={onStop} disabled={busy}>
                  <IconStop width={13} height={13} /> Stop
                </button>
                <button type="button" className="btn" onClick={onPauseResume}>{paused ? 'Resume' : 'Pause'}</button>
              </>
            ) : (
              <button type="button" className="btn btn--primary" onClick={onRecord} disabled={busy}>
                <IconVideo width={13} height={13} /> Record
              </button>
            )}

            <span className="spacer" />
            <button type="button" className="btn btn--ghost" onClick={teardown} disabled={recording}>Turn off</button>
          </div>

          <div className="cam__settings">
            {devices.cameras.length > 1 && (
              <label className="field">
                <span className="field__label">Camera</span>
                <select className="select" value={deviceId} disabled={recording} onChange={(e) => setDeviceId(e.target.value)}>
                  <option value="">Default ({facing === 'user' ? 'front' : 'back'})</option>
                  {devices.cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </label>
            )}

            {!deviceId && (
              <label className="field">
                <span className="field__label">Facing</span>
                <select className="select" value={facing} disabled={recording} onChange={(e) => setFacing(e.target.value)}>
                  <option value="user">Front</option>
                  <option value="environment">Back</option>
                </select>
              </label>
            )}

            <label className="field">
              <span className="field__label">Resolution</span>
              <select className="select" value={resolution} disabled={recording} onChange={(e) => setResolution(e.target.value)}>
                {RESOLUTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </label>

            <label className="toggle">
              <input type="checkbox" checked={withAudio} disabled={recording} onChange={(e) => setWithAudio(e.target.checked)} />
              <span>Record sound</span>
            </label>
          </div>
        </>
      )}

      {error && live && <p className="cam__error" role="alert">{error}</p>}
    </div>
  )
}
