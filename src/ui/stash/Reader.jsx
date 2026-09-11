import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readText, setState, toggleStar, toggleWatch, addHighlight, removeHighlight, recheck } from '../../stash/store.js'
import { Overlay } from '../components.jsx'
import { stashKind } from '../../stash/schema.js'
import { safeUrl } from '../../stash/readable.js'
import { changesOnly, describeChange } from '../../stash/diff.js'
import { platformConfig } from '../../platform/client.js'
import {
  IconStar, IconEye, IconCheck, IconArchive, IconLink, IconTrash, IconClose, IconRefresh,
} from '../icons.jsx'

/** Markdown to elements. Not a full renderer: headings, paragraphs, lists,
    quotes, code and rules are what an article is made of, and anything else
    falls through as text rather than as raw syntax. */
function render(markdown, outlineIds, { dropTitle = '', base = '' } = {}) {
  const out = []
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n')
  let paragraph = []
  let list = null
  let code = null
  let key = 0
  let heading = 0

  const flushParagraph = () => {
    if (!paragraph.length) return
    out.push(<p key={`p${key++}`}>{inline(paragraph.join(' '), base)}</p>)
    paragraph = []
  }
  const flushList = () => {
    if (!list) return
    const Tag = list.ordered ? 'ol' : 'ul'
    out.push(<Tag key={`l${key++}`}>{list.items.map((item, i) => <li key={i}>{inline(item, base)}</li>)}</Tag>)
    list = null
  }
  const flush = () => { flushParagraph(); flushList() }

  for (const line of lines) {
    if (code !== null) {
      if (/^\s*```/.test(line)) { out.push(<pre key={`c${key++}`}><code>{code.join('\n')}</code></pre>); code = null }
      else code.push(line)
      continue
    }
    if (/^\s*```/.test(line)) { flush(); code = []; continue }

    const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (h) {
      flush()
      // The article's own title is already the page heading. Printing it
      // again is the oldest bug in every reader mode ever shipped.
      if (dropTitle && !out.length && h[2].trim().toLowerCase() === dropTitle) { heading += 1; continue }
      const level = Math.min(6, h[1].length)
      const Tag = `h${Math.min(4, level + 1)}`
      out.push(<Tag key={`h${key++}`} id={outlineIds[heading++]}>{inline(h[2], base)}</Tag>)
      continue
    }
    if (/^\s{0,3}([-*_]\s*){3,}$/.test(line)) { flush(); out.push(<hr key={`r${key++}`} />); continue }

    const quote = line.match(/^\s{0,3}>\s?(.*)$/)
    if (quote) { flush(); out.push(<blockquote key={`q${key++}`}>{inline(quote[1], base)}</blockquote>); continue }

    const bullet = line.match(/^\s{0,3}([-*+]|\d+\.)\s+(.*)$/)
    if (bullet) {
      flushParagraph()
      const ordered = /\d/.test(bullet[1])
      if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] } }
      list.items.push(bullet[2])
      continue
    }

    if (!line.trim()) { flush(); continue }
    flushList()
    paragraph.push(line.trim())
  }
  if (code !== null) out.push(<pre key={`c${key++}`}><code>{code.join('\n')}</code></pre>)
  flush()
  return out
}

/** Links, emphasis and code inside a line. */
function inline(text, base = '') {
  const parts = []
  const pattern = /(!?\[([^\]]*)\]\(([^)\s]+)[^)]*\))|(\*\*|__)(.+?)\4|(\*|_)(.+?)\6|`([^`]+)`/g
  let last = 0
  let match
  let key = 0
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    if (match[1]) {
      // An image inside a paragraph is decoration in a reader; the alt text
      // is the part that carries meaning.
      if (match[1].startsWith('!')) parts.push(match[2] || '')
      else {
        // Untrusted: this URL came off the page that was saved. A scheme
        // other than http/https/mailto renders as text, never as a link.
        const href = safeUrl(match[3], base)
        const label = match[2] || match[3]
        parts.push(href
          ? <a key={key++} href={href} target="_blank" rel="noreferrer noopener">{label}</a>
          : <span key={key++} title={`Blocked link: ${match[3]}`}>{label}</span>)
      }
    } else if (match[5]) parts.push(<strong key={key++}>{match[5]}</strong>)
    else if (match[7]) parts.push(<em key={key++}>{match[7]}</em>)
    else if (match[8]) parts.push(<code key={key++}>{match[8]}</code>)
    last = pattern.lastIndex
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

/**
 * The reading surface.
 *
 * Everything here comes out of IndexedDB, so it works with the backend
 * unreachable, the site down, or no network at all. That is the whole reason
 * the text is stored rather than the link.
 */
export function Reader({ entity, onClose, onToast, onForget }) {
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(null)
  const [checking, setChecking] = useState(false)
  const [changes, setChanges] = useState(null)
  const [progress, setProgress] = useState(0)
  const body = useRef(null)
  const { configured } = platformConfig()

  const kind = stashKind(entity)
  const meta = entity.meta || {}
  const outlineIds = useMemo(() => (meta.outline || []).map((h) => h.id), [meta.outline])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    readText(entity)
      .then((text) => {
        if (!live) return
        if (!text) setError('The text of this page is no longer in storage.')
        setMarkdown(text)
      })
      .catch((err) => live && setError(err.message))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [entity.id, meta.snapshotId])

  // Opening it counts as reading it.
  useEffect(() => {
    if (meta.state === 'inbox') setState(entity, 'read')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id])

  const onScroll = useCallback((e) => {
    const el = e.currentTarget
    const span = el.scrollHeight - el.clientHeight
    setProgress(span > 0 ? Math.min(1, el.scrollTop / span) : 1)
  }, [])

  // A selection is the raw material for a highlight, so it is watched rather
  // than read on click: by click time the browser has often cleared it.
  useEffect(() => {
    const onSelect = () => {
      const text = window.getSelection()?.toString().trim()
      if (!text || text.length < 4) return setSelection(null)
      if (!body.current?.contains(window.getSelection().anchorNode)) return setSelection(null)
      setSelection(text.slice(0, 2000))
    }
    document.addEventListener('selectionchange', onSelect)
    return () => document.removeEventListener('selectionchange', onSelect)
  }, [])

  async function onRecheck() {
    setChecking(true)
    try {
      const result = await recheck(entity)
      if (!result.changed) onToast?.('Nothing has changed since you saved it')
      else { setChanges(result.diff); onToast?.(describeChange(result.diff)) }
    } catch (err) {
      onToast?.(err.message)
    } finally {
      setChecking(false)
    }
  }

  const content = useMemo(
    () => render(markdown, outlineIds, {
      dropTitle: String(entity.title || '').trim().toLowerCase(),
      base: meta.url || '',
    }),
    [markdown, outlineIds, entity.title, meta.url],
  )

  return (
    <Overlay className="reader" onClose={onClose} label={entity.title}>
      <div className="reader__progress" style={{ '--read': `${Math.round(progress * 100)}%` }} />

      <header className="reader__bar">
        <button type="button" className="btn btn--icon btn--ghost" aria-label="Close" onClick={onClose}><IconClose /></button>

        <div className="reader__who truncate">
          {meta.site || 'Written here'}
          {meta.minutes ? <span className="muted"> · {meta.minutes} min read</span> : null}
          {meta.versions?.length > 1 ? <span className="muted"> · {meta.versions.length} versions</span> : null}
        </div>

        <div className="reader__tools">
          <button type="button" className="btn btn--icon btn--ghost" aria-label="Star" aria-pressed={!!meta.starred} onClick={() => toggleStar(entity)}><IconStar /></button>
          {kind === 'page' && (
            <button type="button" className="btn btn--icon btn--ghost" aria-label="Watch for changes" aria-pressed={!!meta.watching} onClick={() => toggleWatch(entity)}><IconEye /></button>
          )}
          {kind === 'page' && configured && (
            <button type="button" className="btn btn--sm" onClick={onRecheck} disabled={checking}>
              <IconRefresh width={12} height={12} /> {checking ? 'Checking…' : 'Check for changes'}
            </button>
          )}
          <button type="button" className="btn btn--sm" onClick={() => { setState(entity, meta.state === 'archived' ? 'read' : 'archived'); onToast?.(meta.state === 'archived' ? 'Back in the list' : 'Archived') }}>
            <IconArchive width={12} height={12} /> {meta.state === 'archived' ? 'Unarchive' : 'Archive'}
          </button>
          {meta.url && (
            <a className="btn btn--icon btn--ghost" href={safeUrl(meta.url) || '#'} target="_blank" rel="noreferrer noopener" aria-label="Open the original"><IconLink /></a>
          )}
          <button type="button" className="btn btn--icon btn--ghost" aria-label="Delete" onClick={() => onForget?.(entity)}><IconTrash /></button>
        </div>
      </header>

      <div className="reader__scroll" onScroll={onScroll} ref={body}>
        <article className="reader__article">
          <h1 className="reader__title">{entity.title}</h1>
          {(meta.byline || meta.url) && (
            <p className="reader__byline">
              {meta.byline}
              {meta.byline && meta.url ? ' · ' : ''}
              {safeUrl(meta.url) && <a href={safeUrl(meta.url)} target="_blank" rel="noreferrer noopener">{meta.site}</a>}
            </p>
          )}

          {loading && <p className="secondary">Reading from your archive…</p>}
          {error && <p className="cam__error" role="alert">{error}</p>}

          {changes && (
            <section className="reader__changes">
              <h2>{describeChange(changes)} since you saved it</h2>
              {changesOnly(changes).map((row, i) => (
                row.type === 'gap'
                  ? <p key={i} className="reader__gap">⋯</p>
                  : <p key={i} className={`reader__row reader__row--${row.type}`}>{row.text}</p>
              ))}
              <button type="button" className="btn btn--sm" onClick={() => setChanges(null)}>Hide</button>
            </section>
          )}

          {!loading && !error && content}

          {!!meta.highlights?.length && (
            <section className="reader__highlights">
              <h2>Your highlights</h2>
              {meta.highlights.map((h) => (
                <figure key={h.id} className="quote">
                  <blockquote>{h.quote}</blockquote>
                  {h.note && <figcaption>{h.note}</figcaption>}
                  <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Remove highlight" onClick={() => removeHighlight(entity, h.id)}><IconTrash width={12} height={12} /></button>
                </figure>
              ))}
            </section>
          )}
        </article>
      </div>

      {selection && (
        <div className="reader__selection" role="status">
          <span className="truncate">“{selection.slice(0, 90)}{selection.length > 90 ? '…' : ''}”</span>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              addHighlight(entity, { quote: selection })
              window.getSelection()?.removeAllRanges()
              setSelection(null)
              onToast?.('Highlighted')
            }}
          ><IconCheck width={12} height={12} /> Highlight</button>
        </div>
      )}
    </Overlay>
  )
}
