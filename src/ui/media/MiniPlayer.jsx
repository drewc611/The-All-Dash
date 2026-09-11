import { useSyncExternalStore } from 'react'
import * as player from '../../media/player.js'
import { formatDuration } from '../../media/schema.js'
import { IconPlay, IconStop, IconPrev, IconNext, IconShuffle, IconRepeat, IconRepeatOne, IconVolume, IconMute, IconClose } from '../icons.jsx'

/**
 * The bar that keeps the music going.
 *
 * It renders in the app shell rather than inside a view, and the <audio> it
 * drives is not in the React tree at all, so changing view, opening a board
 * or importing a file never interrupts a track.
 */
export function MiniPlayer() {
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getServerSnapshot)
  const track = state.queue[state.index]
  if (!track) return null

  const RepeatIcon = state.repeat === 'one' ? IconRepeatOne : IconRepeat
  const position = state.duration ? (state.time / state.duration) * 100 : 0

  return (
    <div className="miniplayer" role="region" aria-label="Player">
      <div
        className="miniplayer__progress"
        role="presentation"
        style={{ '--played': `${position}%` }}
      />

      <div className="miniplayer__now">
        <span className="miniplayer__title truncate">{track.title}</span>
        <span className="miniplayer__sub truncate">
          {state.error
            ? state.error
            : state.loading
              ? 'Loading…'
              : `${formatDuration(state.time)} / ${formatDuration(state.duration || track.duration)}`}
          {state.queue.length > 1 && !state.error ? ` · ${state.index + 1} of ${state.queue.length}` : ''}
        </span>
      </div>

      <input
        className="miniplayer__seek"
        type="range"
        min="0"
        max={Math.max(1, Math.floor(state.duration || track.duration || 1))}
        value={Math.floor(state.time)}
        aria-label="Seek"
        onChange={(e) => player.seek(Number(e.target.value))}
      />

      <div className="miniplayer__controls">
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label="Shuffle"
          aria-pressed={state.shuffle}
          onClick={player.toggleShuffle}
        ><IconShuffle /></button>

        <button type="button" className="btn btn--icon btn--ghost" aria-label="Previous" onClick={player.back}><IconPrev /></button>

        <button
          type="button"
          className="btn btn--icon miniplayer__play"
          aria-label={state.playing ? 'Pause' : 'Play'}
          onClick={player.toggle}
        >{state.playing ? <IconStop /> : <IconPlay />}</button>

        <button type="button" className="btn btn--icon btn--ghost" aria-label="Next" onClick={() => player.skip()}><IconNext /></button>

        <button
          type="button"
          className="btn btn--icon btn--ghost"
          aria-label={`Repeat: ${state.repeat}`}
          aria-pressed={state.repeat !== 'off'}
          onClick={player.cycleRepeat}
        ><RepeatIcon /></button>

        <button
          type="button"
          className="btn btn--icon btn--ghost hide-sm"
          aria-label={state.muted ? 'Unmute' : 'Mute'}
          onClick={player.toggleMute}
        >{state.muted || state.volume === 0 ? <IconMute /> : <IconVolume />}</button>

        <input
          className="miniplayer__volume hide-sm"
          type="range"
          min="0"
          max="100"
          value={Math.round((state.muted ? 0 : state.volume) * 100)}
          aria-label="Volume"
          onChange={(e) => player.setVolume(Number(e.target.value) / 100)}
        />

        <button type="button" className="btn btn--icon btn--ghost" aria-label="Close player" onClick={player.stop}><IconClose /></button>
      </div>
    </div>
  )
}
