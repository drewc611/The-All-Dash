import { IconSpark } from '../icons.jsx'
import { explainQuestion } from '../triageActions.js'

/**
 * One triage signal as a row. It lives here rather than in Triage.jsx because
 * the Triage widget renders it too, and the view is loaded lazily: a static
 * import of anything inside Triage.jsx pulls the whole view back into the
 * eager bundle and the code split silently stops happening. Rollup says so
 * ("dynamic import will not move module into another chunk") and the build
 * still succeeds, which is how it went unnoticed.
 *
 * Nothing here needs the view's state, so there is nothing to share but this.
 */
export const tone = (severity) => (severity === 'info' ? 'accent' : severity)

export function Row({ signal, onOpen, onAsk, onAct, compact = false }) {
  const target = signal.entity
  return (
    <div className="list__item triage-row">
      <span className={`dot dot--${tone(signal.severity)}`} style={{ marginTop: 6 }} />
      <div className="list__main">
        <button type="button" className="list__open" onClick={() => target && onOpen?.(target)}>
          <span className="list__title">{signal.title}</span>
          <span className="list__meta">
            <span className={`chip chip--${signal.severity === 'info' ? 'accent' : signal.severity}`}>{signal.kind.replace('-', ' ')}</span>
            <span>{signal.why}</span>
          </span>
        </button>
        {!compact && signal.entities?.length > 1 && (
          <span className="row row--wrap" style={{ gap: 4, marginTop: 4 }}>
            {signal.entities.slice(0, 4).map((e) => (
              <button key={e.id} type="button" className="chip chip--button truncate" style={{ maxWidth: 200 }} onClick={() => onOpen?.(e)} title={e.title}>{e.title}</button>
            ))}
          </span>
        )}
      </div>
      <span className="list__side triage-row__actions">
        {(compact ? signal.actions.slice(0, 1) : signal.actions).map((a) => (
          <button key={a.id} className="btn btn--sm" onClick={() => onAct(a.id, signal)}>{a.label}</button>
        ))}
        {onAsk && (
          <button
            className="btn btn--icon btn--sm"
            title="Ask the assistant about this"
            aria-label={`Ask the assistant about ${signal.title}`}
            onClick={() => onAsk({ question: explainQuestion(signal), focus: [target?.id, ...(signal.entities || []).map((e) => e.id)].filter(Boolean) })}
          >
            <IconSpark width={13} height={13} />
          </button>
        )}
      </span>
    </div>
  )
}
