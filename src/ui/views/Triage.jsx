import { useMemo, useState } from 'react'
import { buildTriage, summarise, SEVERITIES } from '../../engine/triage.js'
import { unmuteSignal } from '../../core/store.js'
import { relative } from '../../core/time.js'
import { Segmented, Empty } from '../components.jsx'
import { runTriageAction } from '../triageActions.js'
import { Row, tone } from './TriageRow.jsx'

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
