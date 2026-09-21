import { useMemo, useState } from 'react'
import { corpusFrom, indexCorpus } from '../../agents/librarian.js'
import { run as askAgents } from '../../agents/pipeline.js'
import { genes } from '../../genome/store.js'
import { addRound, removeRound, updateRound, recordBrief, latestBrief, briefsFor } from '../../rounds/store.js'
import { isDue, nextDueAt, CADENCES, CADENCE_LABELS } from '../../rounds/due.js'
import { runRound, summarise, priceRun } from '../../rounds/run.js'
import { isVerified } from '../../rounds/schema.js'
import { relative, formatDate } from '../../core/time.js'
import { Card, Empty, Segmented } from '../components.jsx'

/**
 * Rounds: standing work.
 *
 * A round is a question asked of the workspace on a cadence. What makes it
 * worth having rather than a reminder to ask it yourself is what comes back:
 * every finding carries the records it was drawn from, and a finding that
 * could not be traced to any is shown under its own heading rather than
 * deleted on the way out.
 *
 * The honest part, said in the interface and not only here: this app has no
 * server. A round comes due and runs the next time you open the app, not at
 * nine o'clock while your laptop is shut. Saying "every weekday at 9" would be
 * a nicer sentence and a false one.
 */
export function Rounds({ state, entities = [], onOpen, onToast }) {
  const [drafting, setDrafting] = useState(false)
  const [openBrief, setOpenBrief] = useState(null)
  const [busy, setBusy] = useState(null)

  const rounds = state.rounds?.rounds || []
  const now = new Date()
  const due = useMemo(() => rounds.filter((r) => isDue(r, now)), [rounds, now])

  // The same corpus the Agents view asks against: a round is a standing
  // version of that question, not a second way of answering it.
  const population = useMemo(() => genes(state), [state])
  const index = useMemo(
    () => indexCorpus(corpusFrom(entities, population, new Map())),
    [entities, population],
  )

  const run = async (round) => {
    setBusy(round.id)
    try {
      // No model unless the round has a ceiling that permits one. Retrieval
      // and the Critic are local, so a round with no ceiling still works and
      // still costs nothing - which is the state most of them should be left
      // in.
      const brief = await runRound(round, {
        ask: (question) => askAgents(question, { index, genes: population }),
        estimate: 0,
      })
      recordBrief(round.id, brief)
      setOpenBrief(brief)
      onToast?.(brief.skipped || summarise(brief))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--gap-4)' }}>
      <Card
        title="Standing work"
        subtitle={
          due.length
            ? `${due.length} round${due.length === 1 ? '' : 's'} owed`
            : 'Nothing owed right now'
        }
        tools={
          <button className="btn btn--sm btn--primary" onClick={() => setDrafting(true)}>
            New round
          </button>
        }
      >
        <p className="hint" style={{ marginTop: 0 }}>
          A round asks its question against this workspace and reports back with
          the records behind every answer. There is no server here, so a round
          runs the next time you open the app after it comes due, not while the
          laptop is shut.
        </p>
      </Card>

      {drafting && <Draft onCancel={() => setDrafting(false)} onSave={(r) => { addRound(r); setDrafting(false) }} />}

      {!rounds.length && !drafting && (
        <Empty
          title="No rounds yet"
          hint="A good first one is the question you ask yourself every Monday. What slipped? What is blocked and on whom?"
          action={<button className="btn btn--sm btn--primary" onClick={() => setDrafting(true)}>New round</button>}
        />
      )}

      {rounds.map((round) => (
        <RoundRow
          key={round.id}
          round={round}
          brief={latestBrief(round.id, state)}
          history={briefsFor(round.id, state).length}
          busy={busy === round.id}
          onRun={() => run(round)}
          onToggle={() => updateRound(round.id, { enabled: !round.enabled })}
          onRemove={() => removeRound(round.id)}
          onOpenBrief={setOpenBrief}
        />
      ))}

      {openBrief && <Brief brief={openBrief} entities={entities} onOpen={onOpen} onClose={() => setOpenBrief(null)} />}
    </div>
  )
}

function RoundRow({ round, brief, history, busy, onRun, onToggle, onRemove, onOpenBrief }) {
  const due = isDue(round)
  const next = nextDueAt(round)
  const priced = priceRun(round, { estimate: 0 })

  return (
    <Card
      title={round.name}
      subtitle={`${CADENCE_LABELS[round.cadence]} · ${
        !round.enabled
          ? 'paused'
          : due
            ? 'owed now'
            : next
              ? `not before ${formatDate(next, { weekday: 'short', month: 'short', day: 'numeric' })}`
              : ''
      }`}
      tools={
        <span className="row" style={{ gap: 4 }}>
          <button className="btn btn--sm" onClick={onToggle}>{round.enabled ? 'Pause' : 'Resume'}</button>
          <button className="btn btn--sm btn--primary" disabled={busy} onClick={onRun}>
            {busy ? 'Running…' : 'Run now'}
          </button>
        </span>
      }
      footer={
        <span className="row row--between" style={{ width: '100%' }}>
          <span className="hint">{priced.reason}</span>
          <button className="btn btn--sm btn--ghost" onClick={onRemove}>Delete round</button>
        </span>
      }
    >
      <p style={{ margin: '0 0 var(--gap-2)' }}>{round.question}</p>
      {brief ? (
        <button type="button" className="list__open" onClick={() => onOpenBrief(brief)}>
          <span className="list__title">{summarise(brief)}</span>
          <span className="list__meta">
            <span>{relative(brief.at)}</span>
            {history > 1 && <span>{history} briefs</span>}
          </span>
        </button>
      ) : (
        <p className="hint" style={{ margin: 0 }}>Not run yet.</p>
      )}
    </Card>
  )
}

function Draft({ onSave, onCancel }) {
  const [question, setQuestion] = useState('')
  const [name, setName] = useState('')
  const [cadence, setCadence] = useState('weekly')

  return (
    <Card title="New round">
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <label className="field">
          <span className="field__label">What should it ask?</span>
          <input
            className="input"
            value={question}
            autoFocus
            placeholder="What slipped this week, and who is it waiting on?"
            onChange={(e) => setQuestion(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Call it</span>
          <input
            className="input"
            value={name}
            placeholder="Monday review"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Segmented
          label="How often"
          value={cadence}
          onChange={setCadence}
          options={CADENCES.map((c) => ({ value: c, label: CADENCE_LABELS[c] }))}
        />
        <span className="row" style={{ gap: 6 }}>
          <button
            className="btn btn--sm btn--primary"
            disabled={!question.trim()}
            onClick={() => onSave({ question, name, cadence })}
          >
            Save round
          </button>
          <button className="btn btn--sm" onClick={onCancel}>Cancel</button>
        </span>
      </div>
    </Card>
  )
}

/**
 * One brief.
 *
 * Verified and unverified are separate headings rather than a badge in a list,
 * because the difference is the whole point and a badge is easy not to read.
 */
function Brief({ brief, entities = [], onOpen, onClose }) {
  // A chip reading `note_dgl58dhdefe7` names nothing. The point of a citation
  // is that you can go and look at the thing, which means it has to be
  // recognisable before you click it. An id that no longer resolves still
  // shows as itself rather than vanishing: a source that has been deleted is
  // worth knowing about.
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities])
  const verified = brief.findings.filter(isVerified)
  const unverified = brief.findings.filter((f) => !isVerified(f))

  return (
    <Card
      title={brief.question || 'Brief'}
      subtitle={`${formatDate(brief.at, { month: 'short', day: 'numeric' })} · ${summarise(brief)}`}
      tools={<button className="btn btn--sm" onClick={onClose}>Close</button>}
    >
      {brief.skipped && <p className="hint" style={{ marginTop: 0 }}>{brief.skipped}</p>}

      {verified.length > 0 && (
        <ul className="fact-list">
          {verified.map((f, i) => (
            <li key={i}>
              {f.text}
              <span className="row row--wrap" style={{ gap: 4, marginTop: 4 }}>
                {f.sources.map((id) => {
                  const entity = byId.get(id)
                  return (
                    <button
                      key={id}
                      type="button"
                      className="chip chip--button truncate"
                      style={{ maxWidth: 240 }}
                      disabled={!entity}
                      onClick={() => entity && onOpen?.(entity)}
                      title={entity ? `Open ${entity.title}` : 'This record is no longer in the workspace'}
                    >
                      {entity ? entity.title : `${id} (gone)`}
                    </button>
                  )
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      {unverified.length > 0 && (
        <>
          <h3 className="field__label" style={{ marginTop: 'var(--gap-3)' }}>
            Could not be traced
          </h3>
          <p className="hint" style={{ marginTop: 0 }}>
            These were said but not stood up against any record here. They are
            kept because the places an answer wanted to overreach are worth
            seeing.
          </p>
          <ul className="fact-list">
            {unverified.map((f, i) => <li key={i}>{f.text}</li>)}
          </ul>
        </>
      )}

      {!brief.findings.length && !brief.skipped && (
        <p className="hint" style={{ margin: 0 }}>Nothing to report.</p>
      )}
    </Card>
  )
}
