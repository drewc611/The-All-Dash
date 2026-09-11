import { useCallback, useEffect, useState } from 'react'
import { updateMediaSettings, useStore, getState } from '../../core/store.js'
import { usage, clearBlobs, collectGarbage, requestPersistence, available } from '../../media/blobs.js'
import { formatBytes, liveBlobIds } from '../../media/schema.js'
import { FFMPEG_DOWNLOAD_BYTES } from '../../media/transcode.js'
import { Card } from '../components.jsx'

/**
 * The two switches that change what this app is, plus the bill for the bytes.
 *
 * Both default to off. One of them sends a request to Google, the other
 * downloads 32MB from a CDN, and neither should happen because somebody
 * opened a view.
 */
export function MediaSettings({ onToast }) {
  const media = useStore((s) => s.settings.media) || {}
  const [meter, setMeter] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    if (!available()) return setMeter(null)
    usage().then(setMeter).catch(() => setMeter(null))
  }, [])

  useEffect(refresh, [refresh])

  async function clear() {
    if (!window.confirm('Delete every recording, photo and saved video? The notes that mention them stay.')) return
    setBusy(true)
    try {
      await clearBlobs()
      onToast?.('Media storage is empty')
      refresh()
    } finally { setBusy(false) }
  }

  async function tidy() {
    setBusy(true)
    try {
      const { removed, bytes } = await collectGarbage(liveBlobIds(Object.values(getState().entities)))
      onToast?.(removed ? `Removed ${removed} orphaned file${removed === 1 ? '' : 's'}, ${formatBytes(bytes)}` : 'Nothing to tidy')
      refresh()
    } finally { setBusy(false) }
  }

  async function persist() {
    const granted = await requestPersistence()
    onToast?.(granted
      ? 'This browser will keep your media even under storage pressure'
      : 'The browser declined. Media can still be evicted if the disk fills up.')
  }

  return (
    <Card title="Media" subtitle="The camera, the player and video compression.">
      <div className="stack">
        <label className="toggle toggle--wide">
          <input
            type="checkbox"
            checked={!!media.youtube}
            onChange={(e) => updateMediaSettings({ youtube: e.target.checked })}
          />
          <span className="stack" style={{ gap: '2px' }}>
            <strong>YouTube</strong>
            <span className="muted">
              Embeds a player from youtube-nocookie.com. This is the only part of the app that
              talks to a server you did not choose: Google sees which video you play and when.
              Nothing else about your workspace is sent anywhere.
            </span>
          </span>
        </label>

        <label className="toggle toggle--wide">
          <input
            type="checkbox"
            checked={!!media.ffmpeg}
            onChange={(e) => updateMediaSettings({ ffmpeg: e.target.checked })}
          />
          <span className="stack" style={{ gap: '2px' }}>
            <strong>ffmpeg for compression</strong>
            <span className="muted">
              Adds a second encoder that finishes far faster than the clip is long and writes MP4.
              It downloads about {formatBytes(FFMPEG_DOWNLOAD_BYTES)} from a CDN the first time it runs,
              so the app is no longer dependency-free or usable offline on that path. The built-in
              encoder needs neither and stays the default.
            </span>
          </span>
        </label>

        <div className="divider" />

        {!available() ? (
          <p className="secondary" style={{ margin: 0 }}>
            This browser has no IndexedDB, so recordings cannot be saved. Everything else works.
          </p>
        ) : (
          <>
            <div className="row row--between row--wrap">
              <span>
                <strong>{meter ? formatBytes(meter.mine) : '…'}</strong>
                <span className="muted"> in {meter?.count ?? 0} stored file{meter?.count === 1 ? '' : 's'}</span>
              </span>
              <span className="muted">
                {meter?.quota ? `${formatBytes(meter.free)} free of ${formatBytes(meter.quota)}` : ''}
              </span>
            </div>

            {meter?.quota > 0 && (
              <div className="meter__track">
                <span className="meter__mine" style={{ width: `${Math.min(100, (meter.mine / meter.quota) * 100)}%` }} />
                <span className="meter__other" style={{ width: `${Math.min(100, (Math.max(0, meter.used - meter.mine) / meter.quota) * 100)}%` }} />
              </div>
            )}

            <div className="row row--wrap">
              <button type="button" className="btn" onClick={tidy} disabled={busy}>Tidy up orphans</button>
              <button type="button" className="btn" onClick={persist} disabled={busy}>Ask to keep it</button>
              <span className="spacer" />
              <button type="button" className="btn btn--danger" onClick={clear} disabled={busy}>Delete all media</button>
            </div>

            <p className="secondary" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
              Media lives in IndexedDB, not in the workspace export — a video is a thousand times
              the size of everything else you have. Exporting keeps the records and their titles;
              the bytes stay on this device.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}
