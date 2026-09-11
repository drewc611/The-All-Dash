import { useMemo, useState } from 'react'
import { buildTriage, summarise, SEVERITIES } from '../../engine/triage.js'
import { unmuteSignal } from '../../core/store.js'
import { relative } from '../../core/time.js'
import { Segmented, Empty } from '../components.jsx'
import { IconSpark } from '../icons.jsx'
import { runTriageAction, explainQuestion } from '../triageActions.js'

/**
 * Triage: everything that is wrong, most urgent first, each row with the
 * buttons that clear it. The list is derived on every render, so marking a
 * task done removes its row the instant the store changes.
 */
export function Triage({ entities, state, range, onOpen, onAsk, onToast }) {
  const [filter, setFilter] = useState('all')
  const [showMuted, setShowMuted] = useState(false)

  const signals = useMemo(
    () => buildTriage(entities, { range, customMetrics: state.customMetrics, mutes: state.triage, brain: state.brain }),
    [entities, range, state.customMetrics, state.triage, state.brain]
  )
  const counts = summarise(signals)
  const muted = useMemo(() => {
    const all = buildTriage(entities, { range, customMetrics: state.customMetrics, mutes: {}, brain: state.brain })
    return all.filter((s) => state.triage?.[s.id] && new Date(state.triage[s.id].until) > new Date())
  }, [entities, range, state.customMetrics, state.triage, state.brain])
  const shown = filter === 'all' ? signals : signals.filter((s) => s.severity === filter)

  const act = (actionId, signal) => {
    const note = runTriageAction(actionId, signal)
    if (note) onToast?.(note, 'good')
  }

  return (
    <div className="stack">
      <div className="sev-tiles">
        {SEVERITIES.map((sev) => (
          <button
            key={sev}
            type="button"
            className={`sev-tile sev-tile--${sev}`}
            aria-pressed={filter === sev}
            onClick={() => setFilter(filter === sev ? 'all' : sev)}
          >
            <span className="stat__value">{counts[sev]}</span>
            <span className="stat__label">{sev}</span>
          </button>
        ))}
      </div>

      <div className="row row--wrap">
        <Segmented
          label="Severity"
          value={filter}
          options={[{ value: 'all', label: `All ${counts.total}` }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]}
          onChange={setFilter}
        />
        <div className="spacer" />
        {muted.length > 0 && (
          <button className="btn btn--sm" onClick={() => setShowMuted((v) => !v)}>
            {showMuted ? 'Hide' : 'Show'} {muted.length} muted
          </button>
        )}
      </div>

      <section className="card">
        {!shown.length ? (
          <Empty
            title={counts.total ? 'Nothing at this severity' : 'Nothing needs triage'}
            hint={counts.total ? 'Pick another severity above.' : 'No overdue work, nothing blocked, no milestone slipping, no clashing meetings.'}
          />
        ) : (
          <div className="list">
            {shown.map((s) => <Row key={s.id} signal={s} onOpen={onOpen} onAsk={onAsk} onAct={act} />)}
          </div>
        )}
      </section>

      {showMuted && muted.length > 0 && (
        <section className="card">
          <header className="card__head"><h3 className="card__title">Muted</h3></header>
          <div className="list">
            {muted.map((s) => (
              <div key={s.id} className="list__item">
                <span className={`dot dot--${tone(s.severity)}`} style={{ marginTop: 6, opacity: 0.5 }} />
                <span className="list__main">
                  <span className="list__title muted">{s.title}</span>
                  <span className="list__meta">until {relative(state.triage[s.id].until)}</span>
                </span>
                <span className="list__side">
                  <button className="btn btn--sm" onClick={() => unmuteSignal(s.id)}>Unmute</button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

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
