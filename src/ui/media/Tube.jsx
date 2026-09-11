import { useMemo, useState } from 'react'
import { addEntity, updateMediaSettings, useStore } from '../../core/store.js'
import { parseYouTube, embedUrl, thumbnails, watchUrl } from '../../media/youtube.js'
import { mediaEntity } from '../../media/schema.js'
import { uid } from '../../core/id.js'
import { Empty } from '../components.jsx'
import { IconYouTube, IconLink } from '../icons.jsx'

/**
 * YouTube.
 *
 * This is the one place in the app that talks to a server the person did not
 * choose, so it stays off until they switch it on, and the copy says plainly
 * what changes when they do. Embeds use youtube-nocookie.com, which does not
 * set tracking cookies for someone who merely opens this view.
 *
 * There is no search: that needs a Data API key, a Google Cloud project and a
 * daily quota. Paste a link instead - it is one keystroke more and nothing to
 * configure.
 */
export function Tube({ entities, onToast }) {
  const enabled = !!useStore((s) => s.settings.media?.youtube)
  const [input, setInput] = useState('')
  const [playing, setPlaying] = useState(null)

  const saved = useMemo(
    () => entities.filter((e) => e.type === 'media' && e.meta?.kind === 'youtube')
      .sort((a, b) => String(b.at).localeCompare(String(a.at))),
    [entities],
  )

  const parsed = parseYouTube(input)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''

  if (!enabled) {
    return (
      <Empty
        title="YouTube is switched off"
        hint="Everything else in this app stays in your browser. Turning this on embeds a player from youtube-nocookie.com, which means Google sees which video you play and when. Nothing else about your workspace is shared."
        action={
          <button type="button" className="btn btn--primary" onClick={() => updateMediaSettings({ youtube: true })}>
            Turn on YouTube
          </button>
        }
      />
    )
  }

  function add() {
    const found = parseYouTube(input)
    if (!found) return
    const entity = mediaEntity({
      id: uid('med'),
      kind: 'youtube',
      title: `YouTube ${found.id || found.list}`,
      youtubeId: found.id,
      meta: { list: found.list, start: found.start },
    })
    addEntity(entity)
    setPlaying({ ...found, entityId: entity.id })
    setInput('')
    onToast?.('Saved to your library. Rename it in the Inspector.')
  }

  return (
    <div className="stack">
      <div className="row row--wrap tube__bar">
        <input
          className="input tube__input"
          value={input}
          placeholder="Paste a YouTube link, or an 11-character video id"
          aria-label="YouTube link"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && parsed) add() }}
        />
        <button type="button" className="btn btn--primary" onClick={add} disabled={!parsed}>Open</button>
        {input && !parsed && <span className="muted">That is not a YouTube link.</span>}
      </div>

      {playing ? (
        <div className="tube__stage">
          <iframe
            className="tube__frame"
            src={embedUrl({ ...playing, autoplay: true, origin })}
            title="YouTube player"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            loading="lazy"
          />
          <div className="row row--wrap">
            <button type="button" className="btn btn--ghost" onClick={() => setPlaying(null)}>Close the player</button>
            {playing.id && (
              <a className="btn btn--ghost" href={watchUrl(playing.id, playing.start)} target="_blank" rel="noreferrer noopener">
                <IconLink width={13} height={13} /> Open on YouTube
              </a>
            )}
          </div>
        </div>
      ) : (
        <Empty
          title="Nothing playing"
          hint="Paste a link above. Saved videos sit in your Library alongside your notes, and a link keeps whatever start time you pasted."
        />
      )}

      {saved.length > 0 && (
        <div className="stack">
          <h3 className="tube__heading">Saved</h3>
          <div className="tube__grid">
            {saved.map((e) => (
              <button
                key={e.id}
                type="button"
                className="tube__card"
                onClick={() => setPlaying({ id: e.meta.youtubeId, list: e.meta.list, start: e.meta.start || 0, entityId: e.id })}
              >
                {e.meta.youtubeId ? (
                  <img
                    className="tube__thumb"
                    src={thumbnails(e.meta.youtubeId)[1]}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="tube__thumb tube__thumb--none"><IconYouTube /></span>
                )}
                <span className="tube__name truncate">{e.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
