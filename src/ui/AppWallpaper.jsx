/*
 * The wallpaper behind the whole app.
 *
 * Same crossfade rules as the one in Focus - preload before fading, keep the
 * outgoing frame mounted for the length of the transition, release object URLs
 * when they stop being visible - but mounted once at the shell rather than
 * per-view, so switching from Today to Boards does not reload a photograph or
 * restart a fade.
 *
 * It also sets `data-glass-app` on the root element, because the wallpaper and
 * the translucency have to arrive and leave together: glass over a plane
 * colour is just a lighter card, and a photograph behind opaque surfaces is a
 * strip of colour nobody can see.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../core/store.js'
import { useFlag } from '../core/useFlag.js'
import { bandAt, fromMedia, msUntilNextBand, pick } from '../focus/wallpaper.js'
import { bundledPictures } from '../focus/bundled.js'
import { getBlob } from '../media/blobs.js'

async function resolve(picture) {
  if (!picture) return null
  if (picture.url) return { url: picture.url, revoke: false }
  if (!picture.blobId) return null
  const blob = await getBlob(picture.blobId)
  if (!blob) return null
  return { url: URL.createObjectURL(blob), revoke: true }
}

const preload = (url) => new Promise((done, fail) => {
  const img = new Image()
  img.onload = () => {
    if (typeof img.decode === 'function') img.decode().then(() => done(url), () => done(url))
    else done(url)
  }
  img.onerror = () => fail(new Error(`could not load ${url}`))
  img.src = url
})

export function AppWallpaper({ entities }) {
  const on = useFlag('glass.app')

  // `data-glass-app` lives on the root element rather than in React's tree,
  // because the rail, the topbar and every overlay need to see it and they do
  // not share an ancestor below <html>.
  useEffect(() => {
    const root = document.documentElement
    if (on) root.setAttribute('data-glass-app', 'on')
    else root.removeAttribute('data-glass-app')
    return () => root.removeAttribute('data-glass-app')
  }, [on])

  const [band, setBand] = useState(() => bandAt().id)
  useEffect(() => {
    if (!on) return undefined
    const id = setTimeout(() => setBand(bandAt().id), msUntilNextBand())
    return () => clearTimeout(id)
  }, [on, band])

  const picture = useMemo(() => {
    if (!on) return null
    const mine = fromMedia(
      (entities || [])
        .filter((e) => e.type === 'media' && e.meta?.kind === 'photo' && e.meta?.blobId)
        .map((e) => ({ id: e.id, kind: 'photo', capturedAt: e.at, title: e.title, blobId: e.meta.blobId })),
    )
    return pick([...mine, ...bundledPictures()], { band })
  }, [entities, band, on])

  const [shown, setShown] = useState(null)
  const [fading, setFading] = useState(null)
  const [lit, setLit] = useState(false)
  const current = useRef(null)
  const held = useRef(new Map())
  const token = useRef(0)

  useEffect(() => {
    if (!on) return undefined
    const mine = ++token.current
    let cancelled = false
    const stale = () => cancelled || mine !== token.current

    ;(async () => {
      const resolved = await resolve(picture)
      if (stale() || !resolved) {
        if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
        return
      }
      try {
        await preload(resolved.url)
      } catch {
        if (resolved.revoke) URL.revokeObjectURL(resolved.url)
        return
      }
      if (stale()) {
        if (resolved.revoke) URL.revokeObjectURL(resolved.url)
        return
      }
      if (resolved.revoke) held.current.set(resolved.url, true)
      const arriving = { key: `${picture.id}:${mine}`, url: resolved.url }
      setFading(current.current)
      current.current = arriving
      setLit(false)
      setShown(arriving)
    })()

    return () => { cancelled = true }
  }, [picture, on])

  // One frame after arrival, turn it on: an element mounted at its target
  // opacity has no previous value to transition from.
  useEffect(() => {
    if (!shown) return undefined
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setLit(true)) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [shown])

  useEffect(() => {
    if (!fading) return undefined
    const timer = setTimeout(() => {
      setFading(null)
      if (held.current.has(fading.url)) {
        URL.revokeObjectURL(fading.url)
        held.current.delete(fading.url)
      }
    }, 1700)
    return () => clearTimeout(timer)
  }, [fading])

  useEffect(() => {
    const urls = held.current
    return () => {
      for (const url of urls.keys()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  if (!on) return null

  return (
    <div className="app-paper" aria-hidden="true">
      {picture?.placeholder ? <img className="app-paper__blur" src={picture.placeholder} alt="" data-shown="true" /> : null}
      {fading ? <img key={fading.key} src={fading.url} alt="" data-shown="false" /> : null}
      {shown ? <img key={shown.key} src={shown.url} alt="" data-shown={lit ? 'true' : 'false'} /> : null}
    </div>
  )
}

export default AppWallpaper
