import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Voice, from the browser's own speech APIs. No model, no upload: recognition
 * and synthesis are whatever the OS provides, which is why both are optional
 * and the buttons simply do not render where they are unsupported.
 */

const Recognition = () =>
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

export const canListen = () => Boolean(Recognition())
export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

/** Push-to-talk. `onResult(text)` fires once with the final transcript. */
export function useListen({ onResult, onEnd } = {}) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const ref = useRef(null)
  const handlers = useRef({ onResult, onEnd })
  handlers.current = { onResult, onEnd }

  const stop = useCallback(() => {
    try { ref.current?.stop() } catch { /* already stopped */ }
  }, [])

  const start = useCallback(() => {
    const Ctor = Recognition()
    if (!Ctor || ref.current) return
    const rec = new Ctor()
    rec.continuous = false
    rec.interimResults = true
    rec.lang = navigator.language || 'en-US'
    let finalText = ''
    rec.onresult = (event) => {
      let partial = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else partial += result[0].transcript
      }
      setInterim(partial)
    }
    rec.onerror = () => { /* "no-speech" and friends all end in onend */ }
    rec.onend = () => {
      ref.current = null
      setListening(false)
      setInterim('')
      const text = finalText.trim()
      if (text) handlers.current.onResult?.(text)
      handlers.current.onEnd?.(text)
    }
    ref.current = rec
    setListening(true)
    try { rec.start() } catch { ref.current = null; setListening(false) }
  }, [])

  useEffect(() => stop, [stop])

  return { supported: canListen(), listening, interim, start, stop }
}

let current = null

/** Read a reply aloud. Calling again cuts the previous one off. */
export function speak(text, { onEnd } = {}) {
  if (!canSpeak() || !text) { onEnd?.(); return }
  stopSpeaking()
  const utter = new SpeechSynthesisUtterance(text.slice(0, 1200))
  utter.lang = navigator.language || 'en-US'
  utter.rate = 1.05
  utter.onend = () => { if (current === utter) current = null; onEnd?.() }
  utter.onerror = utter.onend
  current = utter
  window.speechSynthesis.speak(utter)
}

export function stopSpeaking() {
  if (!canSpeak()) return
  current = null
  window.speechSynthesis.cancel()
}
