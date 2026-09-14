/*
 * Focus: one timer, one photograph, nothing else.
 *
 * The rendering loop is worth a note. It ticks once a second only to redraw,
 * never to count - the remaining time is a subtraction against the wall clock
 * every time (see focus/timer.js), so a dropped tick costs a frame and not a
 * minute. That is also why the tab coming back into view triggers a redraw
 * rather than a correction: there is nothing to correct.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../core/store.js'
import { OPEN_STATUSES } from '../../data/schema.js'
import { clock, isComplete, isPaused, progress, remaining } from '../../focus/timer.js'
import { abandon, begin, finish, hold, next as skip, unhold } from '../../focus/store.js'
import { minutesOn } from '../../focus/schema.js'
import { bandAt, fromMedia, msUntilNextBand, pick } from '../../focus/wallpaper.js'
import { bundledPictures } from '../../focus/bundled.js'
import { chime } from '../../focus/chime.js'
import { useFlag } from '../../core/useFlag.js'
import { Empty } from '../components.jsx'
import Wallpaper from '../focus/Wallpaper.jsx'

const PHASE_LABEL = { work: 'Focus', short: 'Short break', long: 'Long break' }

/** A ring that fills as the phase runs. */
function Dial({ fraction, paused, children }) {
  const r = 118
  const circumference = 2 * Math.PI * r
  return (
    <div className="focus-dial" data-paused={paused ? 'true' : 'false'}>
      <svg viewBox="0 0 260 260" aria-hidden="true">
        <circle className="track" cx="130" cy="130" r={r} fill="none" strokeWidth="6" />
        <circle
          className="sweep"
          cx="130" cy="130" r={r} fill="none" strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {children}
    </div>
  )
}

export function Focus({ entities, onOpen }) {
  const focus = useStore((s) => s.focus)
  const wallpaperOn = useFlag('focus.wallpaper')
  const glassOn = useFlag('focus.glass')

  const { session, settings, sessions } = focus
  const [, redraw] = useState(0)
  const tick = useCallback(() => redraw((n) => n + 1), [])

  /* --------------------------------------------------------- the ticking */

  // One second while something is running, nothing at all while it is not.
  // An idle screen does not need a heartbeat.
  useEffect(() => {
    if (!session || isPaused(session)) return undefined
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session, tick])

  // Coming back to a throttled tab redraws immediately rather than waiting
  // out the rest of the current second.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [tick])

  /* ------------------------------------------------------- the completion */

  // Fires once per finished phase. `finish` re-checks the clock itself, so a
  // double render here cannot bank two records for one pomodoro.
  const rung = useRef(null)
  useEffect(() => {
    if (!session || !isComplete(session)) return
    const id = `${session.phase}:${session.startedAt}`
    if (rung.current === id) return
    rung.current = id
    if (settings.chime) chime()
    finish({})
  })

  /* ------------------------------------------------------- the photograph */

  const [band, setBand] = useState(() => bandAt().id)
  useEffect(() => {
    if (!wallpaperOn) return undefined
    // Wake exactly when the band turns over rather than polling for it.
    const id = setTimeout(() => setBand(bandAt().id), msUntilNextBand())
    return () => clearTimeout(id)
  }, [wallpaperOn, band])

  const pictures = useMemo(() => {
    if (!wallpaperOn) return []
    // Your own photographs, filed by the hour they were taken, ahead of the
    // bundled set: somebody who has put their own pictures in Studio meant
    // them to be seen. The bundled seven are the floor, so an empty Studio is
    // still a photograph rather than a plain background.
    const mine = fromMedia(
      entities
        .filter((e) => e.type === 'media' && e.meta?.kind === 'photo' && e.meta?.blobId)
        .map((e) => ({ id: e.id, kind: 'photo', capturedAt: e.at, title: e.title, blobId: e.meta.blobId })),
    )
    return [...mine, ...bundledPictures()]
  }, [entities, wallpaperOn])

  const picture = useMemo(() => pick(pictures, { band }), [pictures, band])

  /* ------------------------------------------------------------- the task */

  const task = useMemo(
    () => (session?.entityId ? entities.find((e) => e.id === session.entityId) || null : null),
    [entities, session?.entityId],
  )

  const open = useMemo(
    () => entities.filter((e) => e.type === 'task' && OPEN_STATUSES.includes(e.status)).slice(0, 8),
    [entities],
  )

  const todayMinutes = useMemo(() => {
    const key = new Date().toDateString()
    return sessions.reduce((total, s) => (new Date(s.endedAt).toDateString() === key ? total + s.minutes : total), 0)
  }, [sessions])

  /* ------------------------------------------------------------ rendering */

  const left = remaining(session)
  const paused = isPaused(session)
  const surface = glassOn ? 'focus-card glass' : 'focus-card card'

  return (
    <div className="focus">
      {wallpaperOn ? <Wallpaper picture={picture} /> : null}

      <div className={surface}>
        {session ? (
          <>
            <div className="focus-phase">{PHASE_LABEL[session.phase]}{paused ? ' · paused' : ''}</div>

            <Dial fraction={progress(session)} paused={paused}>
              {/* The one element a screen reader should read as it changes.
                  aria-live on the container would re-announce the whole card. */}
              <div className="focus-time" role="timer" aria-live="off">{clock(left)}</div>
            </Dial>

            <div className="focus-rounds" aria-label={`Round ${session.round} of ${settings.roundsBeforeLong}`}>
              {Array.from({ length: settings.roundsBeforeLong }, (_, i) => (
                <span key={i} className="focus-pip" data-done={i < session.round ? 'true' : 'false'} />
              ))}
            </div>

            {task ? (
              <div className="focus-task">
                on{' '}
                <button type="button" className="linkish" onClick={() => onOpen?.(task)}>
                  <strong>{task.title}</strong>
                </button>
              </div>
            ) : session.phase === 'work' ? (
              <div className="focus-task">no task — the minutes are recorded, just not against anything</div>
            ) : null}

            <div className="focus-actions">
              {paused
                ? <button type="button" className="btn btn--primary" onClick={() => unhold({})}>Resume</button>
                : <button type="button" className="btn btn--primary" onClick={() => hold({})}>Pause</button>}
              <button type="button" className="btn" onClick={() => skip({})}>
                {session.phase === 'work' ? 'Take a break' : 'Back to work'}
              </button>
              <button type="button" className="btn" onClick={() => abandon({})}>Stop</button>
            </div>
          </>
        ) : (
          <>
            <div className="focus-phase">Ready</div>
            <Dial fraction={0} paused={false}>
              <div className="focus-time">{clock(settings.work * 60000)}</div>
            </Dial>

            {open.length ? (
              <>
                <div className="focus-task">what are you working on?</div>
                <div className="focus-actions">
                  {/* The label truncates inside its own box. `.truncate` on the
                      button itself clips at both ends instead of ellipsising,
                      because a button centres its text and the overflow is
                      split across both sides. */}
                  {open.slice(0, 4).map((e) => (
                    <button key={e.id} type="button" className="btn btn--sm focus-pick" title={e.title} onClick={() => begin(e.id)}>
                      <span className="truncate">{e.title}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <Empty title="No open tasks" hint="Start a plain session, or add a task and run the timer on it." />
            )}

            <div className="focus-actions">
              <button type="button" className="btn btn--primary" onClick={() => begin(null)}>
                Start {settings.work} minutes
              </button>
            </div>
          </>
        )}

        <div className="focus-meta">
          <span>{todayMinutes} min today</span>
          {task ? <span>{minutesOn(focus, task.id)} min on this task</span> : null}
        </div>
      </div>
    </div>
  )
}

export default Focus
