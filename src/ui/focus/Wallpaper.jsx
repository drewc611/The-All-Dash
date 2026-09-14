/*
 * The photograph behind Focus.
 *
 * Three things this has to get right, and they are all about the fade.
 *
 * It preloads before it fades. Starting a crossfade against an <img> that has
 * not decoded yet gives you a fade to nothing, then a pop when the bytes
 * land - the exact opposite of gentle. So the next photograph is loaded and
 * decoded off-screen, and only once it is ready does the swap begin.
 *
 * It keeps the outgoing photograph mounted for the length of the fade.
 * Unmounting it on the same frame as the incoming one appears is what makes
 * every naive version flash the background colour in the middle.
 *
 * It revokes its object URLs. A blob URL is a reference the browser holds
 * until told otherwise, and a view that leaks one per photograph per visit is
 * a memory leak whose only symptom is "the tab got slow after a while".
 *
 * The other subtlety is that a freshly mounted element at its target opacity
 * does not transition - there is no previous value to animate from. So an
 * incoming photograph mounts transparent and is flipped on the next frame,
 * which is what makes the very first fade behave like every later one.
 */

import { useEffect, useRef, useState } from 'react'
import { getBlob } from '../../media/blobs.js'

/** Resolve a picture to something an <img> can use, and say how to release it. */
async function resolve(picture) {
  if (!picture) return null
  if (picture.url) return { url: picture.url, revoke: false }
  if (!picture.blobId) return null
  const blob = await getBlob(picture.blobId)
  if (!blob) return null
  return { url: URL.createObjectURL(blob), revoke: true }
}

/** Load and decode, so the fade starts against a frame that is actually there. */
function preload(url) {
  return new Promise((done, fail) => {
    const img = new Image()
    img.onload = () => {
      // decode() keeps the first painted frame off the main thread. Older
      // browsers lack it, and an onload-only fade is still fine.
      if (typeof img.decode === 'function') img.decode().then(() => done(url), () => done(url))
      else done(url)
    }
    img.onerror = () => fail(new Error(`could not load ${url}`))
    img.src = url
  })
}

export default function Wallpaper({ picture, fade = 1200 }) {
  // `shown` is what the eye sees, `fading` is the one on its way out.
  const [shown, setShown] = useState(null)
  const [fading, setFading] = useState(null)
  // `lit` flips one frame after an arrival so the opacity transition has a
  // value to move from.
  const [lit, setLit] = useState(false)

  // A mirror of `shown`, because the loader below needs to know what is
  // currently up without listing it as a dependency and re-running on arrival.
  const current = useRef(null)
  const held = useRef(new Map())
  const token = useRef(0)

  const release = (url) => {
    if (held.current.has(url)) {
      URL.revokeObjectURL(url)
      held.current.delete(url)
    }
  }

  useEffect(() => {
    const mine = ++token.current
    let cancelled = false
    const stale = () => cancelled || mine !== token.current

    ;(async () => {
      const resolved = await resolve(picture)
      if (stale()) {
        if (resolved?.revoke) URL.revokeObjectURL(resolved.url)
        return
      }
      if (!resolved) {
        current.current = null
        setShown(null)
        return
      }
      try {
        await preload(resolved.url)
      } catch {
        // A photograph that will not load is not worth telling anybody about:
        // the scrim over the plane is a perfectly good background.
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
  }, [picture])

  // One frame after an arrival, turn it on. Two nested rAFs rather than one:
  // a single callback can still run inside the same style recalculation that
  // mounted the element, and the transition is skipped again.
  useEffect(() => {
    if (!shown) return undefined
    let inner = 0
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setLit(true)) })
    return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
  }, [shown])

  // Retire the outgoing photograph once the fade has finished, and release its
  // URL at that moment - not before, or it blanks mid-fade.
  useEffect(() => {
    if (!fading) return undefined
    const timer = setTimeout(() => {
      setFading(null)
      release(fading.url)
    }, fade + 100)
    return () => clearTimeout(timer)
  }, [fading, fade])

  // Whatever is still held when this unmounts goes back.
  useEffect(() => {
    const urls = held.current
    return () => {
      for (const url of urls.keys()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  return (
    <div className="focus-paper" aria-hidden="true">
      {fading ? <img key={fading.key} src={fading.url} alt="" data-shown="false" /> : null}
      {shown ? <img key={shown.key} src={shown.url} alt="" data-shown={lit ? 'true' : 'false'} /> : null}
    </div>
  )
}
