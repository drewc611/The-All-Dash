import { useMemo } from 'react'
import { defineWidget } from '../../core/registry.js'
import { buildTriage, summarise } from '../../engine/triage.js'
import { Empty } from '../components.jsx'
import { Row } from '../views/Triage.jsx'
import { runTriageAction } from '../triageActions.js'

/** The top of the triage list, on the Today board. */
defineWidget({
  id: 'triage',
  name: 'Triage',
  description: 'The most urgent problems right now, each with the one button that clears it.',
  category: 'Day',
  size: 'md',
  options: [
    { key: 'limit', label: 'Rows', type: 'number', min: 3, max: 20, default: 6 },
    { key: 'minimum', label: 'At least', type: 'select', choices: [
      { value: 'info', label: 'Everything' }, { value: 'warning', label: 'Warning' }, { value: 'serious', label: 'Serious' }, { value: 'critical', label: 'Critical' },
    ] },
  ],
  render: ({ entities, state, range, onOpen, navigate, onAsk, config }) => {
    const signals = useMemo(
      () => buildTriage(entities, { range, customMetrics: state.customMetrics, mutes: state.triage }),
      [entities, range, state.customMetrics, state.triage]
    )
    const rank = { critical: 0, serious: 1, warning: 2, info: 3 }
    const floor = rank[config.minimum] ?? 3
    const shown = signals.filter((s) => rank[s.severity] <= floor).slice(0, config.limit || 6)
    const counts = summarise(signals)
    if (!shown.length) return <Empty title="Nothing on fire" hint="No overdue work, nothing blocked, no milestone slipping." />
    return (
      <div className="stack" style={{ gap: 0, margin: 'calc(var(--gap-4) * -1)' }}>
        <div className="list">
          {shown.map((s) => (
            <Row
              key={s.id}
              signal={s}
              compact
              onOpen={onOpen}
              onAsk={onAsk}
              onAct={(id, signal) => {
                const note = runTriageAction(id, signal)
                if (note) window.dispatchEvent(new CustomEvent('alldash:toast', { detail: { message: note, tone: 'good' } }))
              }}
            />
          ))}
        </div>
        <button className="list__item list__item--interactive" style={{ justifyContent: 'center', color: 'var(--accent)', fontWeight: 560 }} onClick={() => navigate?.('triage')}>
          Open triage ({counts.total})
        </button>
      </div>
    )
  },
})
