/*
 * The sound a finished phase makes.
 *
 * Synthesised rather than shipped. A pleasant chime is a few hundred
 * kilobytes of audio for something that is two sine waves and an envelope,
 * and this app already refuses to download 32MB for video encoding without
 * being asked - spending a third of the entire bundle on a ding would be
 * hard to defend.
 *
 * Two notes a fifth apart, the second a beat behind the first, each on an
 * exponential decay. A square envelope on a sine is a click at both ends;
 * the ramps are what make it a chime rather than a beep.
 *
 * The context is created on demand and closed afterwards. Browsers refuse to
 * start an AudioContext until the person has interacted with the page, so one
 * made at import time would be born suspended and stay that way - and the
 * first thing anybody does here is press start, which is an interaction.
 */

const A4 = 440
/** A4 and the E above it. A fifth is consonant in a way a third is not. */
const NOTES = [A4 * (3 / 4), A4 * (9 / 8)]

/**
 * @param {{volume?: number, now?: number}} options
 * @returns {Promise<boolean>} false when the browser would not play it, which
 *          is not an error worth surfacing - a timer that finishes silently is
 *          still a timer that finished.
 */
export async function chime({ volume = 0.22 } = {}) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) return false

  let ctx = null
  try {
    ctx = new Ctx()
    if (ctx.state === 'suspended') await ctx.resume()

    const out = ctx.createGain()
    out.gain.value = volume
    out.connect(ctx.destination)

    const start = ctx.currentTime + 0.02
    let end = start
    NOTES.forEach((frequency, i) => {
      const at = start + i * 0.16
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = frequency

      // Fast attack, long exponential tail. exponentialRampToValueAtTime
      // cannot reach zero, hence the small floor before the hard stop.
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(1, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1)

      osc.connect(gain)
      gain.connect(out)
      osc.start(at)
      osc.stop(at + 1.2)
      end = Math.max(end, at + 1.2)
    })

    // Closing mid-tail would cut the sound off; closing never would leak an
    // audio context per pomodoro.
    const ms = Math.max(0, (end - ctx.currentTime) * 1000) + 120
    const closing = ctx
    setTimeout(() => { closing.close().catch(() => {}) }, ms)
    return true
  } catch {
    try { ctx?.close() } catch { /* nothing useful to do */ }
    return false
  }
}
