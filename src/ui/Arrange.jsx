import { useEffect, useRef, useState } from 'react'
import { getState, useStore } from '../core/store.js'
import { useFlag } from '../core/useFlag.js'
import { isOn } from '../core/flags.js'
import { CHANNEL } from '../core/build.js'
import { listWidgets } from '../core/registry.js'
import { uid } from '../core/id.js'
import { Overlay, Empty } from './components.jsx'
import { IconClose, IconSpark } from './icons.jsx'
import { candidatesFrom, loadShipped, propose } from '../layout/model.js'
import { describeField, situationOf } from '../layout/situation.js'
import { applyBoard, forgetExamples, rememberBoard, setPersonal, undoBoard } from '../layout/store.js'
import { dropPersonal, finetune, loadPersonal, savePersonal } from '../layout/personal.js'

/**
 * Suggested layout for Today.
 *
 * A small transformer reads the day - what is late, what is booked, the hour,
 * which views the person opens - and proposes a board. Same rule as the rest of
 * the app's proposals: it proposes, the person looks at the diff, and nothing
 * changes until they press Apply. The previous board is kept so one click puts
 * it back.
 */

const toast = (message, tone = 'info') =>
  window.dispatchEvent(new CustomEvent('alldash:toast', { detail: { message, tone } }))

/** Widgets that can appear on this build, flagged ones only when their flag is on. */
function eligibleWidgets(state) {
  return listWidgets().filter((w) => !w.flag || isOn(w.flag, { channel: CHANNEL, overrides: state.settings.flags }))
}

/** The person's own trained copy if there is one, otherwise the shipped weights. */
async function resolveModel(useShipped) {
  if (!useShipped) {
    const personal = await loadPersonal()
    if (personal) return { model: personal, source: 'personal' }
  }
  const { model } = await loadShipped()
  return { model, source: 'shipped' }
}

/** What to show a person about what the model was shown, most telling first. */
const FACTS = ['hour', 'overdue', 'dueToday', 'events', 'risks', 'urgent', 'focus', 'topView']

const OPS = {
  add: { label: 'Add', glyph: '+', tone: 'chip--good' },
  remove: { label: 'Remove', glyph: '−', tone: 'chip--warning' },
  resize: { label: 'Resize', glyph: '↕', tone: 'chip--accent' },
}
const SIZE_NAMES = { sm: 'small', md: 'medium', lg: 'large', xl: 'full width' }

/**
 * The buttons in the Today toolbar. Also watches for the moment a person
 * finishes arranging the board by hand, because those boards are the only
 * labels in the system that are theirs.
 */
export function ArrangeControls({ view, editing }) {
  const enabled = useFlag('layout')
  const undo = useStore((s) => s.layout.undo)
  const [open, setOpen] = useState(false)
  useRememberArrangement(view, editing, enabled)

  if (view !== 'today' || !enabled) return null
  return (
    <>
      <button className="btn btn--sm" onClick={() => setOpen(true)} title="Suggest a layout for right now">
        <IconSpark width={13} height={13} /> <span className="hide-sm">Suggest</span>
      </button>
      {undo?.view === view && (
        <button
          className="btn btn--sm"
          onClick={() => toast(undoBoard() ? 'Your previous board is back.' : 'Nothing to put back.', 'good')}
          title="Put back the board this suggestion replaced"
        >
          Undo suggestion
        </button>
      )}
      {open && <ArrangeSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function useRememberArrangement(view, editing, enabled) {
  const snapshot = useRef(null)
  useEffect(() => {
    if (!enabled || view !== 'today') return
    if (editing) {
      snapshot.current = JSON.stringify(getState().boards.today || [])
      return
    }
    if (snapshot.current === null) return
    const state = getState()
    const items = state.boards.today || []
    const changed = JSON.stringify(items) !== snapshot.current
    snapshot.current = null
    if (!changed) return
    try {
      rememberBoard({ values: situationOf(state, new Date()), candidates: candidatesFrom(eligibleWidgets(state)), items })
    } catch (err) {
      console.warn('All Dash: could not remember this layout', err)
    }
  }, [editing, enabled, view])
}

function ArrangeSheet({ onClose }) {
  const [useShipped, setUseShipped] = useState(false)
  // Bumped when the model behind the proposal changes, so the proposal is
  // asked for again even if the choice of model did not flip.
  const [generation, setGeneration] = useState(0)
  const [run, setRun] = useState({ status: 'loading' })

  useEffect(() => {
    let alive = true
    // Asking again after the model changed keeps the last proposal on screen
    // rather than blanking the sheet, so the panel that triggered the refresh
    // (and the message it is about to show) is not torn down underneath itself.
    setRun((r) => (r.status === 'ready' ? r : { status: 'loading' }))
    ;(async () => {
      try {
        const { model, source } = await resolveModel(useShipped)
        const state = getState()
        const values = situationOf(state, new Date())
        const candidates = candidatesFrom(eligibleWidgets(state))
        const proposal = propose({ model, values, candidates, current: state.boards.today || [], newId: () => uid('w') })
        if (alive) setRun({ status: 'ready', proposal, values, source, model })
      } catch (err) {
        if (alive) setRun({ status: 'error', message: err?.message || String(err) })
      }
    })()
    return () => { alive = false }
  }, [useShipped, generation])

  const apply = () => {
    applyBoard('today', run.proposal.items)
    toast(`Layout updated: ${run.proposal.changes.length} change${run.proposal.changes.length === 1 ? '' : 's'}. Undo is in the toolbar.`, 'good')
    onClose()
  }

  return (
    <Overlay onClose={onClose} labelledBy="arrange-title">
      <header className="sheet__head">
        <h2 id="arrange-title" className="card__title">Suggested layout</h2>
        <div className="spacer" />
        <button className="btn btn--icon" onClick={onClose} aria-label="Close"><IconClose /></button>
      </header>

      <div className="sheet__body">
        {run.status === 'loading' && <p className="hint" role="status">Reading your day…</p>}
        {run.status === 'error' && (
          <Empty title="Could not build a suggestion" hint={run.message} />
        )}
        {run.status === 'ready' && <Proposal run={run} />}
      </div>

      {run.status === 'ready' && (
        <>
          <Teach
            source={run.source}
            onChanged={() => { setUseShipped(false); setGeneration((g) => g + 1) }}
            onUseShipped={() => { setUseShipped(true); setGeneration((g) => g + 1) }}
            usingShipped={useShipped}
          />
          <footer className="sheet__foot">
            <button className="btn btn--primary" onClick={apply} disabled={run.proposal.unchanged}>Apply</button>
            <button className="btn" onClick={onClose}>Not now</button>
          </footer>
        </>
      )}
    </Overlay>
  )
}

function Proposal({ run }) {
  const { proposal, values, source } = run
  const facts = FACTS.map((id) => describeField(values, id)).filter(Boolean)
  return (
    <>
      <section className="stack" style={{ gap: 'var(--gap-2)' }} aria-label="What the model read">
        <span className="hint">
          It read only this
          {source === 'personal' ? ', with the copy you have trained' : ', with the model that ships with the app'}:
        </span>
        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {facts.map((fact) => <span className="chip" key={fact}>{fact}</span>)}
        </span>
      </section>

      {proposal.unchanged ? (
        <Empty title="Your board already fits" hint="Nothing it would change is clear enough to be worth suggesting." />
      ) : (
        <ul className="arrange__list" aria-label="Proposed changes">
          {proposal.changes.map((change) => <ChangeRow key={change.widgetId} change={change} />)}
        </ul>
      )}

      {proposal.reordered && (
        <p className="hint" style={{ margin: 0 }}>
          The rest are reordered, most likely to be wanted first.
        </p>
      )}
      <p className="hint" style={{ margin: 0 }}>
        {proposal.unchanged ? 'Nothing to apply.' : 'Nothing changes until you press Apply, and Undo suggestion puts the old board back.'}
      </p>
    </>
  )
}

function ChangeRow({ change }) {
  const op = OPS[change.kind]
  const detail =
    change.kind === 'add' ? `as ${SIZE_NAMES[change.to]}`
      : change.kind === 'remove' ? `was ${SIZE_NAMES[change.from]}`
        : `${SIZE_NAMES[change.from]} → ${SIZE_NAMES[change.to]}`
  return (
    <li className="arrange__row">
      <span className="row" style={{ gap: 'var(--gap-2)', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className={`chip ${op.tone}`}><span aria-hidden="true">{op.glyph} </span>{op.label}</span>
        <strong>{change.name}</strong>
        <span className="hint">{detail}</span>
        <span className="hint mono" style={{ marginLeft: 'auto' }}>{Math.round(change.confidence * 100)}% sure</span>
      </span>
      <span className="hint">
        {/* Which inputs moved this answer most when varied; not a claim that
            they argue for it. "1-2 open questions" can be what is keeping a
            widget off the board, because a bigger pile would put it on. */}
        {change.because.length ? `Weighed most: ${change.because.join(' and ')}.` : 'No single input stands out.'}
      </span>
    </li>
  )
}

/** Fine-tuning on the boards the person made, and the way back. */
function Teach({ source, onChanged, onUseShipped, usingShipped }) {
  const examples = useStore((s) => s.layout.examples)
  const personal = useStore((s) => s.layout.personal)
  const [busy, setBusy] = useState(null)
  const [outcome, setOutcome] = useState(null)
  const abort = useRef(null)
  const MIN = 5

  const learn = async () => {
    const controller = new AbortController()
    abort.current = controller
    setOutcome(null)
    setBusy({ done: 0, total: 160 })
    try {
      const { model: base } = await loadShipped()
      const result = await finetune({
        base,
        examples,
        steps: 160,
        signal: controller.signal,
        onProgress: (done, total) => setBusy({ done, total }),
      })
      if (result.accepted) {
        await savePersonal(result.model, { examples: examples.length })
        setPersonal({ trainedAt: new Date().toISOString(), examples: examples.length, steps: 160 })
        onChanged()
      }
      setOutcome(result)
    } catch (err) {
      if (err?.name !== 'AbortError') setOutcome({ error: err?.message || String(err) })
    } finally {
      setBusy(null)
      abort.current = null
    }
  }

  const forget = async () => {
    await dropPersonal()
    forgetExamples()
    setOutcome(null)
    onUseShipped()
  }

  const pct = (x) => `${Math.round(x * 100)}%`
  return (
    <details className="arrange__teach">
      <summary>
        Teach it your taste
        <span className="hint"> · {examples.length} {examples.length === 1 ? 'board' : 'boards'} of yours saved{personal ? ', trained copy in use' : ''}</span>
      </summary>
      <div className="stack" style={{ gap: 'var(--gap-2)', paddingTop: 'var(--gap-2)' }}>
        <p className="hint" style={{ margin: 0 }}>
          Each time you finish arranging Today by hand, the board and the day it was made on are saved here. Training
          adjusts a copy of the model on those boards, on this device. Nothing is uploaded, and the shipped model is
          never overwritten.
        </p>
        <span className="row" style={{ gap: 'var(--gap-2)', flexWrap: 'wrap' }}>
          {busy ? (
            <>
              <progress value={busy.done} max={busy.total} aria-label="Training progress" />
              <button className="btn btn--sm" onClick={() => abort.current?.abort()}>Cancel</button>
            </>
          ) : (
            <button className="btn btn--sm" onClick={learn} disabled={examples.length < MIN}>
              Learn from {examples.length} {examples.length === 1 ? 'board' : 'boards'}
            </button>
          )}
          {(source === 'personal' || examples.length > 0) && !busy && (
            <button className="btn btn--sm" onClick={forget}>Forget what it learned</button>
          )}
          {source === 'personal' && !usingShipped && !busy && (
            <button className="btn btn--sm" onClick={onUseShipped}>Preview with the shipped model</button>
          )}
        </span>
        {examples.length < MIN && (
          <p className="hint" style={{ margin: 0 }}>It needs at least {MIN} boards to learn from. Arrange Today yourself a few times and press Done.</p>
        )}
        {outcome?.error && <p className="hint" role="status" style={{ margin: 0 }}>Training failed: {outcome.error}</p>}
        {outcome && !outcome.error && (
          <p className="hint" role="status" style={{ margin: 0 }}>
            {outcome.accepted
              ? `Trained. On ${outcome.yours.held ? 'boards it had not seen' : 'your boards'} it agrees with you ${pct(outcome.yours.before)} → ${pct(outcome.yours.after)}, and on ordinary situations ${pct(outcome.general.before)} → ${pct(outcome.general.after)}.`
              : outcome.reason}
            {!outcome.yours.held && ' With fewer than 10 boards that is a fit to what it was shown, not a test.'}
          </p>
        )}
      </div>
    </details>
  )
}
