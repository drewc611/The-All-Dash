import { useMemo } from 'react'
import { applyMove, blockedBecause, declineMove, describeValue, revertMove } from '../../rounds/moves.js'
import { addMoves, recordDecision } from '../../rounds/store.js'
import { proposeMoves } from '../../rounds/propose.js'
import { relative } from '../../core/time.js'
import { Card, Empty } from '../components.jsx'

/**
 * The queue of proposed changes.
 *
 * There is no "apply all" and no setting that turns one on. That is the
 * feature, not an omission: the products that will run your company overnight
 * all have the switch, and a review queue with an approve-everything button is
 * a queue nobody reads - at which point the one proposal that mattered goes
 * through with the rest.
 *
 * Each row says three things before you decide, because a decision made on
 * less than these is not really a decision:
 *
 *   what changes, in the record's own words rather than an id
 *   why, as arithmetic over the record, with the record one click away
 *   whether it still applies at all
 *
 * The third is the one the category gets wrong. A proposal is an opinion about
 * a state of the world, and the world keeps moving after it was formed; a row
 * whose record has changed underneath it says so here, up front, rather than
 * discovering it when somebody presses the button.
 */
export function MovesQueue({ state, moves, onOpen, onToast }) {
  const pending = useMemo(() => moves.filter((m) => m.state === 'proposed'), [moves])
  const settled = useMemo(
    () => moves.filter((m) => m.state !== 'proposed').slice(0, 12),
    [moves]
  )

  const look = () => {
    const found = addMoves(proposeMoves({ existing: moves }))
    onToast?.(found.length
      ? `${found.length} change${found.length === 1 ? '' : 's'} proposed. Nothing applied.`
      : 'Nothing to propose.')
  }

  const decide = (move, how) => {
    const next = how === 'apply' ? applyMove(move) : declineMove(move)
    recordDecision(next)
    if (how !== 'apply') return onToast?.('Declined. It will not be proposed again.')
    // The toast reports the read-back, not the write. "Applied" and "the
    // record now says so" are different claims and only the second is worth
    // making.
    onToast?.(next.state === 'applied'
      ? 'Applied, and the record reads it back.'
      : `Not applied: ${next.outcome?.reason || 'the record did not take it'}.`,
    next.state === 'applied' ? 'good' : 'warn')
  }

  const undo = (move) => {
    const next = revertMove(move)
    recordDecision(next)
    onToast?.(next.state === 'reverted'
      ? 'Put back.'
      : 'Left alone - something else has changed that field since.',
    next.state === 'reverted' ? 'good' : 'warn')
  }

  return (
    <Card
      title="Proposed changes"
      subtitle={pending.length ? `${pending.length} waiting on you` : 'Nothing waiting'}
      tools={<button className="btn btn--sm" onClick={look}>Look for changes</button>}
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Rounds propose; they never apply. Every row below is arithmetic over a
        record you can open, and nothing here changes until you say so.
      </p>

      {!pending.length && !settled.length && (
        <Empty
          title="No proposals"
          hint="Look for changes reads your tasks' own dates and statuses. It spends nothing and calls no model."
        />
      )}

      {pending.map((move) => (
        <MoveRow
          key={move.id}
          move={move}
          state={state}
          onOpen={onOpen}
          onApply={() => decide(move, 'apply')}
          onDecline={() => decide(move, 'decline')}
        />
      ))}

      {settled.length > 0 && (
        <details className="stack" style={{ gap: 'var(--gap-2)', marginTop: 'var(--gap-3)' }}>
          {/* Declines are kept as deliberately as the applies. A queue that
              forgets what you said no to asks again tomorrow. */}
          <summary className="hint">Decided ({settled.length})</summary>
          {settled.map((move) => (
            <SettledRow key={move.id} move={move} state={state} onUndo={() => undo(move)} />
          ))}
        </details>
      )}
    </Card>
  )
}

function MoveRow({ move, state, onOpen, onApply, onDecline }) {
  const entity = state.entities?.[move.entityId]
  const blocked = blockedBecause(move, state)
  const title = entity?.title || 'a record that is gone'

  return (
    <div className="stack" style={{ gap: 4, padding: 'var(--gap-2) 0', borderTop: '1px solid var(--line)' }}>
      <span className="row row--between" style={{ gap: 'var(--gap-2)', alignItems: 'baseline' }}>
        <strong className="truncate">{title}</strong>
        <span className="hint mono">{relative(move.at)}</span>
      </span>

      <span className="row" style={{ gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span className="chip">{describeValue(move.kind, move.from)}</span>
        <span aria-hidden="true">→</span>
        <span className="chip chip--accent">{describeValue(move.kind, move.to)}</span>
        <span className="hint">{move.why}</span>
      </span>

      {blocked ? (
        // Said before the button is pressed rather than after. This is the
        // case an agent that acts immediately cannot even represent.
        <p className="hint" style={{ margin: 0 }} role="status">
          Cannot apply: {blocked}.
        </p>
      ) : null}

      <span className="row" style={{ gap: 4 }}>
        <button
          className="btn btn--sm btn--primary"
          disabled={Boolean(blocked)}
          onClick={onApply}
        >
          Apply
        </button>
        <button className="btn btn--sm" onClick={onDecline}>Decline</button>
        {entity && (
          <button
            className="btn btn--sm btn--ghost"
            onClick={() => onOpen?.(entity)}
            aria-label={`Open the record behind this: ${title}`}
          >
            Why
          </button>
        )}
      </span>
    </div>
  )
}

const WORDS = {
  applied: 'Applied',
  declined: 'Declined',
  stale: 'Expired',
  failed: 'Did not take',
  reverted: 'Put back',
}

function SettledRow({ move, state, onUndo }) {
  const title = state.entities?.[move.entityId]?.title || 'a record that is gone'
  return (
    <span className="row row--between" style={{ gap: 'var(--gap-2)', alignItems: 'baseline' }}>
      <span className="truncate">
        <span className="chip">{WORDS[move.state] || move.state}</span>{' '}
        {title} · {describeValue(move.kind, move.from)} → {describeValue(move.kind, move.to)}
      </span>
      {move.state === 'applied' && (
        <button className="btn btn--sm btn--ghost" onClick={onUndo}>Undo</button>
      )}
    </span>
  )
}
