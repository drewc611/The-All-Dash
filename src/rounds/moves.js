import { getState, updateEntity } from '../core/store.js'
import { iso } from '../core/time.js'
import { MOVE_KINDS, describeValue, readField, sameValue } from './moves-schema.js'

/**
 * Acting on a move, and then going to look.
 *
 * The schema half lives next door in moves-schema.js and imports nothing from
 * the store, because the store imports the rounds schema in order to load
 * itself and a cycle back through here would break that load. Everything in
 * this file touches the workspace; nothing in that one does.
 */

export * from './moves-schema.js'

const kindOf = (kind) => MOVE_KINDS[kind] || null

/**
 * Why a move cannot be applied right now, or null if it can.
 *
 * Separate from applying so the queue can show the reason without anybody
 * having to press the button to find out.
 */
export function blockedBecause(move, state = getState()) {
  if (!move) return 'there is no such move'
  if (move.state !== 'proposed') return `this was already ${move.state}`

  const entity = state.entities?.[move.entityId]
  if (!entity) return 'the record it changes is gone'

  const current = readField(entity, move.kind)
  // The target is checked before the origin, and the order is the whole
  // message. A record that already says what the move wanted has also, by
  // definition, changed since the move was proposed - so testing the origin
  // first answers "it moved" when the useful answer is "somebody already did
  // this". Both are true; only one says there is nothing left to do.
  if (sameValue(move.kind, current, move.to)) return 'the record already says that'
  if (!sameValue(move.kind, current, move.from)) {
    return `the record changed after this was proposed - it now reads ${describeValue(move.kind, current)}`
  }
  return null
}

/**
 * Apply a move, then read the record back.
 *
 * The read afterwards is the point and it is not ceremony: updateEntity
 * ignores an id it does not hold, and writes a patch through without coercing
 * it, so "the writer was called" and "the record now says what we wanted" are
 * genuinely different facts. This returns the second one. Skipping it is how a
 * product ends up shipping "has not confirmed the result - check it before
 * making another request", which is an agent telling you it lost track of
 * something it did to your account.
 */
export function applyMove(move, { now = new Date() } = {}) {
  const blocked = blockedBecause(move)
  if (blocked) {
    return { ...move, state: 'stale', decidedAt: iso(now), outcome: { ok: false, reason: blocked, at: iso(now) } }
  }

  const spec = kindOf(move.kind)
  updateEntity(move.entityId, { [spec.field]: move.to })

  const after = getState().entities?.[move.entityId]
  const observed = readField(after, move.kind)
  const ok = Boolean(after) && sameValue(move.kind, observed, move.to)

  return {
    ...move,
    state: ok ? 'applied' : 'failed',
    decidedAt: iso(now),
    outcome: {
      ok,
      observed: observed === undefined ? null : observed,
      at: iso(now),
      ...(ok ? {} : { reason: after ? 'the write did not take' : 'the record vanished while applying' }),
    },
  }
}

/** Decline a move. It stays in the ledger, because "no" is a decision. */
export const declineMove = (move, { now = new Date() } = {}) =>
  move && move.state === 'proposed' ? { ...move, state: 'declined', decidedAt: iso(now) } : move

/**
 * Put it back.
 *
 * Only while the record still says what this move made it say. If something
 * else changed it since, undoing would not be an undo - it would be a fresh
 * edit wearing an undo's name, quietly discarding whatever that something else
 * decided.
 */
export function revertMove(move, { now = new Date() } = {}) {
  if (!move || move.state !== 'applied') return move
  const entity = getState().entities?.[move.entityId]
  if (!entity) return move
  if (!sameValue(move.kind, readField(entity, move.kind), move.to)) return move

  const spec = kindOf(move.kind)
  updateEntity(move.entityId, { [spec.field]: move.from })

  const observed = readField(getState().entities?.[move.entityId], move.kind)
  if (!sameValue(move.kind, observed, move.from)) return move
  return { ...move, state: 'reverted', decidedAt: iso(now) }
}

/** One line describing a move, in terms of the record rather than of ids. */
export function describeMove(move, state = getState()) {
  if (!move) return ''
  const title = state.entities?.[move.entityId]?.title || 'a record that is gone'
  const spec = kindOf(move.kind)
  return `${spec?.label || move.kind} of "${title}": ${describeValue(move.kind, move.from)} → ${describeValue(move.kind, move.to)}`
}

export const isPending = (move) => move?.state === 'proposed'
