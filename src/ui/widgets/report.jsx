import { useMemo, useState } from 'react'
import { defineWidget } from '../../core/registry.js'
import { buildReport } from '../../engine/report.js'
import { Empty } from '../components.jsx'
import { dayKey } from '../../core/time.js'
import { downloadText } from '../download.js'
import { IconDoc, IconUpload } from '../icons.jsx'

/**
 * The status update, as a widget. Copy it, download it, or just read it -
 * it is regenerated from live data every render, so it is never stale.
 */
defineWidget({
  id: 'status-update',
  name: 'Status update',
  description: 'A ready-to-send Markdown update: done, in progress, blocked, decisions, numbers that moved, next 7 days.',
  category: 'Project',
  size: 'xl',
  options: [
    { key: 'heading', label: 'Heading', type: 'text', placeholder: 'Status update - date' },
    { key: 'scope', label: 'Window', type: 'select', choices: [
      { value: 'range', label: 'Follow the range picker' },
      { value: 'week', label: 'This week' },
    ] },
  ],
  render: ({ entities, range, state, config }) => {
    const [copied, setCopied] = useState(false)
    const markdown = useMemo(
      () =>
        buildReport(entities, {
          range: config.scope === 'week' ? null : range,
          customMetrics: state.customMetrics,
          title: config.heading || undefined,
        }),
      [entities, range, state.customMetrics, config.heading, config.scope]
    )

    if (Object.keys(entities).length === 0) return <Empty title="Nothing to report yet" />

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(markdown)
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      } catch {
        // Clipboard can be blocked; the text is selectable below regardless.
      }
    }

    const download = () => downloadText(markdown, `status-${dayKey(new Date())}.md`, 'text/markdown')

    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <div className="row row--wrap">
          <button className="btn btn--sm btn--primary" onClick={copy}>
            <IconDoc width={13} height={13} /> {copied ? 'Copied' : 'Copy Markdown'}
          </button>
          <button className="btn btn--sm" onClick={download}><IconUpload width={13} height={13} /> Download .md</button>
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            Every line is a real item. Nothing here is made up.
          </span>
        </div>
        <pre
          className="report"
          style={{
            margin: 0,
            padding: 'var(--gap-4)',
            background: 'var(--surface-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-md)',
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--mono)',
            fontSize: 'var(--t-sm)',
            lineHeight: 1.6,
            maxHeight: 520,
            overflow: 'auto',
            userSelect: 'text',
          }}
        >
          {markdown}
        </pre>
      </div>
    )
  },
})
