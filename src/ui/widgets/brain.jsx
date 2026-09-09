import { useMemo } from 'react'
import { defineWidget } from '../../core/registry.js'
import { buildBrain } from '../../brain/learn.js'
import { acceptOpinion, dismissOpinion } from '../../core/store.js'
import { Empty } from '../components.jsx'
import { IconCheck, IconClose } from '../icons.jsx'

/** The brain on the Today board: a few facts and the opinions waiting for an answer. */
defineWidget({
  id: 'brain',
  name: 'Your brain',
  description: 'What the app has learned about you, and the opinions waiting for a yes or a no. Rules only, no model.',
  category: 'Day',
  size: 'sm',
  options: [
    { key: 'facts', label: 'Facts shown', type: 'number', min: 1, max: 8, default: 2 },
    { key: 'opinions', label: 'Opinions shown', type: 'number', min: 0, max: 4, default: 1 },
  ],
  render: ({ state, navigate, config }) => {
    const brain = useMemo(() => buildBrain(state), [state.entities, state.docs, state.brain, state.workspace])
    const waiting = brain.opinions.filter((o) => o.status === 'pending')
    const pending = waiting.slice(0, config.opinions ?? 1)
    const facts = brain.facts.slice(0, config.facts || 2)
    if (!facts.length && !pending.length) {
      return <Empty title="Still learning" hint="Finish tasks, open views, import files. Facts appear here; opinions wait for your yes." />
    }
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {facts.length > 0 && <ul className="fact-list fact-list--tight">{facts.map((f) => <li key={f}>{f}</li>)}</ul>}
        {pending.map((o) => (
          <div key={o.id} className="proposal">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--t-sm)' }}>{o.text}</div>
            </div>
            <div className="row" style={{ flex: 'none' }}>
              <button className="btn btn--sm btn--primary" aria-label="Accept opinion" onClick={() => acceptOpinion(o)}><IconCheck width={12} height={12} /></button>
              <button className="btn btn--sm" aria-label="Dismiss opinion" onClick={() => dismissOpinion(o.id)}><IconClose width={12} height={12} /></button>
            </div>
          </div>
        ))}
        <button className="btn btn--sm btn--ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate?.('brain')}>
          Open the brain{waiting.length > pending.length ? ` (${waiting.length} waiting)` : ''}
        </button>
      </div>
    )
  },
})
