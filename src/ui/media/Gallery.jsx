import { useCallback, useEffect, useMemo, useState } from 'react'
import { removeEntity } from '../../core/store.js'
import { getBlob, deleteBlob, usage } from '../../media/blobs.js'
import { formatBytes, formatDuration, mediaKind, KIND_LABEL } from '../../media/schema.js'
import * as player from '../../media/player.js'
import { Empty } from '../components.jsx'
import { IconPlay, IconTrash, IconDownload, IconImage, IconVideo, IconMusic } from '../icons.jsx'

const KIND_ICON = { video: IconVideo, audio: IconMusic, photo: IconImage }
// "Audios" is not a word.
const PLURAL = { all: 'Everything', video: 'Videos', audio: 'Audio', photo: 'Photos' }

/** A blob id turned into an object URL, revoked when it changes or unmounts.
    Without the revoke, scrolling a gallery leaks every thumbnail it drew. */
function useBlobUrl(blobId) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!blobId) { setUrl(null); return undefined }
    let live = true
    let made = null
    getBlob(blobId).then((blob) => {
      if (!live || !blob) return
      made = URL.createObjectURL(blob)
      setUrl(made)
    }).catch(() => {})
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [blobId])
  return url
}

/**
 * Everything recorded or kept, and what it costs.
 *
 * Playing a video or a track hands it to the shell player, which is why the
 * sound carries on when you walk away to a board.
 */
export function Gallery({ entities, onToast, onOpen }) {
  const [filter, setFilter] = useState('all')
  const [meter, setMeter] = useState(null)
  const [viewing, setViewing] = useState(null)

  const items = useMemo(() => entities
    .filter((e) => e.type === 'media' && e.meta?.blobId)
    .sort((a, b) => String(b.at).localeCompare(String(a.at))), [entities])

  const shown = filter === 'all' ? items : items.filter((e) => mediaKind(e) === filter)

  const refresh = useCallback(() => { usage().then(setMeter).catch(() => setMeter(null)) }, [])
  useEffect(refresh, [refresh, items.length])

  const playable = shown.filter((e) => mediaKind(e) !== 'photo')

  async function remove(entity) {
    if (entity.meta?.blobId) await deleteBlob(entity.meta.blobId).catch(() => {})
    if (entity.meta?.posterId) await deleteBlob(entity.meta.posterId).catch(() => {})
    removeEntity(entity.id)
    onToast?.('Deleted, and the bytes are gone too')
    refresh()
  }

  async function download(entity) {
    const blob = await getBlob(entity.meta.blobId)
    if (!blob) return onToast?.('Those bytes are no longer in storage.')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${entity.title.replace(/[^\w\s.-]/g, '')}.${(blob.type.split('/')[1] || 'bin').split(';')[0]}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  return (
    <div className="stack">
      <div className="row row--wrap">
        {['all', 'video', 'audio', 'photo'].map((id) => (
          <button
            key={id}
            type="button"
            className="chip chip--button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {PLURAL[id]}
            <span className="muted"> {id === 'all' ? items.length : items.filter((e) => mediaKind(e) === id).length}</span>
          </button>
        ))}

        <span className="spacer" />

        {playable.length > 1 && (
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => player.playNow(playable.map(player.trackFrom), 0)}
          ><IconPlay width={12} height={12} /> Play all</button>
        )}
      </div>

      {meter && (
        <div className="meter">
          <div className="meter__head">
            <span><strong>{formatBytes(meter.mine)}</strong> across {items.length} item{items.length === 1 ? '' : 's'}</span>
            <span className="muted">
              {meter.quota ? `${formatBytes(meter.free)} free of ${formatBytes(meter.quota)}` : 'This browser will not say how much room is left'}
            </span>
          </div>
          {meter.quota > 0 && (
            <div className="meter__track">
              <span className="meter__mine" style={{ width: `${Math.min(100, (meter.mine / meter.quota) * 100)}%` }} />
              <span className="meter__other" style={{ width: `${Math.min(100, (Math.max(0, meter.used - meter.mine) / meter.quota) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {!shown.length ? (
        <Empty
          title={items.length ? `No ${filter}s yet` : 'Nothing recorded yet'}
          hint="Recordings, photos and compressed videos land here, and in the Library beside your notes."
        />
      ) : (
        <div className="gallery">
          {shown.map((entity) => (
            <Tile
              key={entity.id}
              entity={entity}
              onPlay={() => {
                if (mediaKind(entity) === 'photo') setViewing(entity)
                else {
                  const list = playable
                  player.playNow(list.map(player.trackFrom), list.findIndex((e) => e.id === entity.id))
                }
              }}
              onOpen={() => onOpen?.(entity)}
              onDownload={() => download(entity)}
              onDelete={() => remove(entity)}
            />
          ))}
        </div>
      )}

      {viewing && <Lightbox entity={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function Tile({ entity, onPlay, onOpen, onDownload, onDelete }) {
  const kind = mediaKind(entity)
  const Icon = KIND_ICON[kind] || IconVideo
  const thumb = useBlobUrl(kind === 'photo' ? entity.meta.blobId : entity.meta.posterId)

  return (
    <figure className="tile">
      <button type="button" className="tile__shot" onClick={onPlay} aria-label={`Open ${entity.title}`}>
        {thumb
          ? <img src={thumb} alt="" loading="lazy" />
          : <span className="tile__blank"><Icon width={20} height={20} /></span>}
        {kind !== 'photo' && <span className="tile__play"><IconPlay width={14} height={14} /></span>}
        {entity.meta.duration > 0 && <span className="tile__time">{formatDuration(entity.meta.duration)}</span>}
      </button>

      <figcaption className="tile__meta">
        <button type="button" className="tile__name truncate linkish" onClick={onOpen} title={entity.title}>{entity.title}</button>
        <span className="muted">
          {KIND_LABEL[kind]} · {formatBytes(entity.meta.size)}
          {entity.meta.compressedFrom ? ` · was ${formatBytes(entity.meta.compressedFrom)}` : ''}
        </span>
      </figcaption>

      <div className="tile__tools">
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Download" onClick={onDownload}><IconDownload width={12} height={12} /></button>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Delete" onClick={onDelete}><IconTrash width={12} height={12} /></button>
      </div>
    </figure>
  )
}

function Lightbox({ entity, onClose }) {
  const url = useBlobUrl(entity.meta.blobId)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={entity.title} onClick={onClose}>
      {url && <img className="lightbox__img" src={url} alt={entity.title} />}
      <button type="button" className="btn lightbox__close" onClick={onClose}>Close</button>
    </div>
  )
}
