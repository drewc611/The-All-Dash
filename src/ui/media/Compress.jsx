import { useEffect, useMemo, useRef, useState } from 'react'
import { addEntity, useStore } from '../../core/store.js'
import { putBlob } from '../../media/blobs.js'
import { mediaEntity, formatBytes, formatDuration, savings } from '../../media/schema.js'
import {
  PRESETS, QUALITIES, probe, planJob, transcode, extensionFor,
  FFMPEG_DOWNLOAD_BYTES,
} from '../../media/transcode.js'
import { posterFrom } from '../../media/capture.js'
import { uid } from '../../core/id.js'
import { IconCompress, IconDownload, IconUpload } from '../icons.jsx'

/**
 * Video compression.
 *
 * The plan is shown before anything runs - target size, estimated output,
 * estimated time - because a person about to spend ten minutes re-encoding
 * deserves to know that in advance rather than discover it.
 */
export function Compress({ onToast }) {
  const settings = useStore((s) => s.settings)
  const ffmpegEnabled = !!settings.media?.ffmpeg

  const [file, setFile] = useState(null)
  const [info, setInfo] = useState(null)
  const [preset, setPreset] = useState('720')
  const [quality, setQuality] = useState('balanced')
  const [withAudio, setWithAudio] = useState(true)
  const [engine, setEngine] = useState('native')
  const [progress, setProgress] = useState(0)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const abortRef = useRef(null)
  const input = useRef(null)

  const plan = info ? planJob({ ...info, preset, quality, withAudio, duration: info.duration }) : null

  // Minting the URL inline in JSX would make a fresh one on every render and
  // leak every single one of them.
  const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  const engineInUse = ffmpegEnabled ? engine : 'native'

  async function pick(chosen) {
    if (!chosen) return
    setError('')
    setResult(null)
    setProgress(0)
    setFile(chosen)
    try {
      setInfo(await probe(chosen))
    } catch (err) {
      setInfo(null)
      setError(err.message)
    }
  }

  async function run() {
    if (!file || !plan) return
    setRunning(true)
    setError('')
    setResult(null)
    setProgress(0)
    const controller = new AbortController()
    abortRef.current = controller
    const startedAt = Date.now()
    try {
      const out = await transcode(
        file,
        { preset, quality, withAudio, engine: engineInUse, fps: 30 },
        { onProgress: setProgress, signal: controller.signal },
      )
      setResult({ ...out, took: (Date.now() - startedAt) / 1000, sourceSize: file.size })
      onToast?.(`Compressed to ${formatBytes(out.blob.size)}`)
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err.message || String(err))
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  function cancel() {
    abortRef.current?.abort()
    setRunning(false)
  }

  function download() {
    if (!result) return
    const url = URL.createObjectURL(result.blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(file.name || 'video').replace(/\.[^.]+$/, '')}-${plan.height}p.${extensionFor(result.mimeType)}`
    a.click()
    // Revoking immediately cancels the download in Firefox.
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  async function keep() {
    if (!result) return
    const blobId = uid('blob')
    try {
      await putBlob(blobId, result.blob, { kind: 'video' })
      let posterId = null
      const poster = await posterFrom(result.blob)
      if (poster) { posterId = uid('blob'); await putBlob(posterId, poster, { kind: 'poster' }) }
      addEntity(mediaEntity({
        id: uid('med'),
        kind: 'video',
        title: `${(file.name || 'Video').replace(/\.[^.]+$/, '')} · ${plan.height}p`,
        blobId,
        mimeType: result.mimeType,
        size: result.blob.size,
        duration: result.duration,
        width: result.width,
        height: result.height,
        meta: { posterId, compressedFrom: file.size },
      }))
      onToast?.('Added to your library')
    } catch (err) {
      onToast?.(err?.name === 'QuotaExceededError' ? 'No room left in storage.' : `Could not save: ${err.message}`)
    }
  }

  const delta = result ? savings(file.size, result.blob.size) : null

  return (
    <div className="stack">
      <div className="compress__drop">
        <input
          ref={input}
          type="file"
          accept="video/*"
          hidden
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }}
        />
        <IconCompress width={22} height={22} />
        <div className="stack" style={{ gap: 'var(--gap-1)' }}>
          <strong>{file ? file.name : 'Pick a video to shrink'}</strong>
          <span className="muted">
            {info
              ? `${info.width}×${info.height} · ${formatDuration(info.duration)} · ${formatBytes(info.size)}`
              : 'Nothing is uploaded. The file is decoded and re-encoded in this tab.'}
          </span>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={running}>
          <IconUpload width={13} height={13} /> {file ? 'Choose another' : 'Choose a file'}
        </button>
      </div>

      {error && <p className="cam__error" role="alert">{error}</p>}

      {plan && (
        <div className="compress__grid">
          <label className="field">
            <span className="field__label">Size</span>
            <select className="select" value={preset} disabled={running} onChange={(e) => setPreset(e.target.value)}>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Quality</span>
            <select className="select" value={quality} disabled={running} onChange={(e) => setQuality(e.target.value)}>
              {QUALITIES.map((q) => <option key={q.id} value={q.id}>{q.label} — {q.hint}</option>)}
            </select>
          </label>

          {ffmpegEnabled && (
            <label className="field">
              <span className="field__label">Engine</span>
              <select className="select" value={engine} disabled={running} onChange={(e) => setEngine(e.target.value)}>
                <option value="native">Built in — real time, WebM</option>
                <option value="ffmpeg">ffmpeg — faster, MP4</option>
              </select>
            </label>
          )}

          <label className="toggle compress__audio">
            <input type="checkbox" checked={withAudio} disabled={running} onChange={(e) => setWithAudio(e.target.checked)} />
            <span>Keep the sound</span>
          </label>
        </div>
      )}

      {plan && (
        <div className="compress__plan">
          <Figure label="Output" value={`${plan.width}×${plan.height}`} />
          <Figure label="Bitrate" value={`${Math.round(plan.videoBps / 1000)} kbps`} />
          <Figure label="Estimated size" value={formatBytes(plan.estimated)} note={`from ${formatBytes(plan.sourceSize)}`} />
          <Figure
            label="Estimated time"
            value={engineInUse === 'ffmpeg' ? 'Much less than the clip' : formatDuration(plan.estimatedSeconds)}
            note={engineInUse === 'ffmpeg' ? 'ffmpeg does not decode in real time' : 'a decode runs at the speed of the clip'}
          />
        </div>
      )}

      {plan && (
        <div className="row row--wrap">
          {running ? (
            <>
              <button type="button" className="btn" onClick={cancel}>Cancel</button>
              <div className="compress__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="muted tabular">{Math.round(progress * 100)}%</span>
            </>
          ) : (
            <button type="button" className="btn btn--primary" onClick={run}>
              <IconCompress width={13} height={13} /> Compress
            </button>
          )}
          {!running && ffmpegEnabled && engine === 'ffmpeg' && (
            <span className="muted">First run downloads about {formatBytes(FFMPEG_DOWNLOAD_BYTES)} of ffmpeg.</span>
          )}
        </div>
      )}

      {result && (
        <div className="compress__result">
          <video className="compress__preview" src={previewUrl} controls playsInline />
          <div className="stack">
            <strong className="compress__verdict">
              {formatBytes(file.size)} → {formatBytes(result.blob.size)}
              {delta && <span className={delta.smaller ? 'compress__won' : 'compress__lost'}> · {delta.label}</span>}
            </strong>
            <span className="muted">
              {result.width}×{result.height} · took {formatDuration(result.took)}
            </span>
            {delta && !delta.smaller && (
              <span className="muted">
                The source was already efficient. Try a smaller size or a lower quality.
              </span>
            )}
            <div className="row row--wrap">
              <button type="button" className="btn btn--primary" onClick={keep}>Add to library</button>
              <button type="button" className="btn" onClick={download}><IconDownload width={13} height={13} /> Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Figure({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={{ fontSize: 'var(--t-lg)' }}>{value}</span>
      {note && <span className="stat__foot">{note}</span>}
    </div>
  )
}
