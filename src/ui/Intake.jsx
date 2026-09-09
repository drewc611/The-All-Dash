import { useCallback, useEffect, useRef, useState } from 'react'
import { ingestFiles, ingestText } from '../ingest/index.js'
import { importUrl } from '../ingest/web.js'
import { platformConfig } from '../platform/client.js'
import { Overlay } from './components.jsx'
import { IconUpload, IconClose, IconLink } from './icons.jsx'

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
        accept=".md,.markdown,.txt,.csv,.tsv,.json,.ndjson,.ics,.ical,.vtt,.srt,.html,.htm,.xlsx,.xlsm,.docx,.pptx"
        onChange={(e) => { onFiles(e.target.files); e.target.value = '' }}
      />
    </>
  )
}


/**
 * Import from a URL. The platform tier reads the page (or crawls the site)
 * and hands back Markdown; from there it is a pasted note. Needs the
 * platform URL and key from Settings → Platform.
 */
export function UrlSheet({ onClose, onDone, navigate, prefill = '' }) {
  const [url, setUrl] = useState(prefill)
  const [crawl, setCrawl] = useState(false)
  const [limit, setLimit] = useState(10)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const { configured } = platformConfig()

  const submit = async (event) => {
    event.preventDefault()
    const target = url.trim()
    if (!target || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await importUrl(target, { crawl, limit, onProgress: setProgress })
      const failed = result.failures.length ? `, ${result.failures.length} page${result.failures.length === 1 ? '' : 's'} failed` : ''
      onDone?.(`${result.pages} page${result.pages === 1 ? '' : 's'} read, ${result.entities} item${result.entities === 1 ? '' : 's'} found${failed}.`, 'good')
      onClose()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
      setProgress('')
    }
  }

  return (
    <Overlay onClose={onClose} labelledBy="url-title">
      <form onSubmit={submit}>
        <div className="sheet__head">
          <h2 id="url-title"><IconLink width={14} height={14} /> Import from the web</h2>
          <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
        </div>
        <div className="sheet__body stack">
          {!configured && (
            <p className="muted" style={{ margin: 0 }}>
              This needs the platform tier: set its URL and API key in Settings → Platform, and put this site's origin in the API's <code className="mono">ALLDASH_CORS_ORIGINS</code>.
              {navigate && <> <button type="button" className="btn btn--sm" onClick={() => { onClose(); navigate('settings') }}>Open Settings</button></>}
            </p>
          )}
          <div className="field">
            <label className="field__label" htmlFor="url-input">Page address</label>
            <input id="url-input" className="input" type="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus disabled={!configured || busy} required />
          </div>
          <div className="row row--wrap">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} disabled={!configured || busy} />
              <span>Crawl the site from this page</span>
            </label>
            {crawl && (
              <label className="row" style={{ gap: 6 }}>
                <span className="muted">up to</span>
                <input className="input" type="number" min={2} max={25} value={limit} onChange={(e) => setLimit(Math.max(2, Math.min(25, Number(e.target.value) || 10)))} style={{ width: 70 }} disabled={busy} />
                <span className="muted">pages</span>
              </label>
            )}
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
            The platform reads the page as Markdown (public sites only, robots.txt respected) and the app pulls out tasks, dates, people, decisions and numbers. Importing the same page again refreshes what it produced.
          </p>
          {progress && <p className="secondary" style={{ margin: 0 }} aria-live="polite">{progress}</p>}
          {error && <p style={{ margin: 0, color: 'var(--critical)' }} role="alert">{error}</p>}
        </div>
        <div className="sheet__foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={!configured || busy || !url.trim()}>{busy ? 'Reading…' : crawl ? 'Crawl and import' : 'Import'}</button>
        </div>
      </form>
    </Overlay>
  )
}
