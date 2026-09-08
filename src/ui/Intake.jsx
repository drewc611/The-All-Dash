import { useCallback, useEffect, useRef, useState } from 'react'
import { ingestFiles, ingestText } from '../ingest/index.js'
import { Overlay } from './components.jsx'
import { IconUpload, IconClose } from './icons.jsx'

/**
 * Getting things in.
 *
 * Drop a file anywhere on the window, paste text with the paste box, or use
 * the file picker. All three take the same route through the parser registry,
 * so a format supported in one is supported in all of them.
 */

export function useIntake() {
  const [dragging, setDragging] = useState(false)
  const [toasts, setToasts] = useState([])
  const depth = useRef(0)

  const toast = useCallback((message, tone = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((list) => [...list, { id, message, tone }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5200)
  }, [])

  const accept = useCallback(async (files) => {
    if (!files?.length) return
    const results = await ingestFiles([...files])
    for (const result of results) {
      if (result.ok) toast(`${result.doc.title}: ${result.entities.length} items read`, 'good')
      else toast(`${result.name}: ${result.error}`, 'critical')
    }
  }, [toast])

  useEffect(() => {
    const onDragEnter = (e) => {
      if (![...(e.dataTransfer?.types || [])].includes('Files')) return
      depth.current += 1
      setDragging(true)
    }
    const onDragOver = (e) => { e.preventDefault() }
    const onDragLeave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const onDrop = (e) => {
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      accept(e.dataTransfer?.files)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [accept])

  return { dragging, toasts, accept, toast }
}

export function DropHint() {
  return (
    <div className="dropzone-hint">
      <div className="dropzone-hint__box">
        <IconUpload width={24} height={24} style={{ margin: '0 auto 8px' }} />
        Drop to read it
        <div className="muted" style={{ fontWeight: 400, marginTop: 4 }}>
          Notes, transcripts, calendars, spreadsheets
        </div>
      </div>
    </div>
  )
}

export function Toasts({ toasts }) {
  if (!toasts.length) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <span className={`dot dot--${t.tone === 'critical' ? 'critical' : t.tone === 'good' ? 'good' : 'accent'}`} style={{ marginTop: 6 }} />
          <span style={{ minWidth: 0 }}>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

export function PasteSheet({ onClose, onDone }) {
  const [text, setText] = useState('')
  const [name, setName] = useState('Pasted notes.md')
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try {
      const result = await ingestText(text, name.trim() || 'Pasted notes.md')
      onDone?.(`${result.doc.title}: ${result.entities.length} items read`)
      onClose()
    } catch (error) {
      onDone?.(error.message, 'critical')
      setBusy(false)
    }
  }

  return (
    <Overlay onClose={onClose} labelledBy="paste-title">
      <header className="sheet__head">
        <h2 id="paste-title" className="card__title">Paste anything</h2>
        <div className="spacer" />
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>
      <form className="sheet__body" onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="paste-name">Call it</label>
          <input id="paste-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            The extension picks the reader: .md for notes, .csv for a table, .ics for a calendar, .vtt for a transcript.
          </span>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field__label" htmlFor="paste-body">Content</label>
          <textarea
            id="paste-body"
            className="textarea"
            style={{ minHeight: 260 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
          />
        </div>
        <button className="btn btn--primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? 'Reading' : 'Read it'}
        </button>
      </form>
    </Overlay>
  )
}

const SAMPLE = `# Weekly sync
Attendees: Sam Ojo, Priya Raman
Date: 2026-09-08

## Action items
- [ ] Draft the launch brief @Sam by Friday #launch
- [x] Send the vendor contract @Priya

## Decisions
Decision: ship the beta behind a flag

## Metrics
Signups: 1,240
Conversion: 4.2%`

export function FilePicker({ onFiles, children, className = 'btn' }) {
  const input = useRef(null)
  return (
    <>
      <button type="button" className={className} onClick={() => input.current?.click()}>{children}</button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".md,.markdown,.txt,.csv,.tsv,.json,.ndjson,.ics,.ical,.vtt,.srt,.html,.htm,.xlsx,.xlsm"
        onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
      />
    </>
  )
}
