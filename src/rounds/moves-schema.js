import { iso } from '../core/time.js'

// Same two helpers schema.js keeps locally, for the same reason: they are four
// lines and a shared module for them would be a dependency to break.
const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const clean = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/**
 * Moves: a round proposing a change, rather than only reporting one.
 *
 * The products selling an autonomous employee take the other half of this and
 * skip the first. They connect your accounts, act without asking, and then
 * cannot always tell you whether the action landed - one of them ships the
 * sentence "has not confirmed the result. Check the result before making
 * another request", which is the honest admission that it fired something into
 * the world and lost track of it.
 *
 * Firing is the easy half. The hard halves are knowing you should, and knowing
 * afterwards that you did. So:
 *
 *   - A move with no evidence does not exist. A finding with no source is kept
 *     and marked, because a passage you cannot trace is still worth reading.
 *     A *change* you cannot justify is not, so makeMove refuses it outright.
 *
 *   - A move remembers what the record said when it was proposed, and refuses
 *     to apply if the record has moved since. A proposal is an opinion about a
 *     state of the world; when that state changes the opinion expires rather
 *     than overwriting whatever replaced it. This is the case the ones that
 *     act immediately cannot even represent.
 *
 *   - Applying re-reads the record afterwards and records what it actually
 *     says. Not "we sent the write" - what is there now. A write that was
 *     dropped, coerced or overwritten by something else is a failed move with
 *     the observed value attached, not a success.
 *
 *   - Applying records the inverse, so undoing is a fact rather than a retype.
 *
 * Nothing here applies on its own. There is no setting that makes it, which is
 * the point: an approval queue with an "approve everything" switch is a queue
 * nobody reads.
 */

/**
 * The fields a move may touch, and what counts as a legal value for each.
 *
 * Deliberately small. updateEntity writes a patch straight through without
 * coercing it, so an unchecked value would be stored verbatim and then read
 * back verbatim - and the verification below would cheerfully confirm that the
 * garbage it wrote is the garbage that is there. The validation has to happen
 * here, at the point the move is built, or the check downstream means nothing.
 */
export const MOVE_KINDS = {
  status: {
    label: 'Status',
    field: 'status',
    values: ['open', 'doing', 'blocked', 'done'],
    show: (v) => ({ open: 'Open', doing: 'Doing', blocked: 'Blocked', done: 'Done' })[v] || String(v),
  },
  priority: {
    label: 'Priority',
    field: 'priority',
    values: [0, 1, 2],
    show: (v) => ['Normal', 'High', 'Urgent'][v] ?? String(v),
  },
}

/*
 * A `due` kind is deliberately absent, and the reason is worth keeping.
 *
 * It was written, and then removed after driving the app: entity.due is not
 * the bare "2026-09-20" the validator assumed. Real records hold a full
 * timestamp - "2026-09-30T17:00:00.000Z" from an imported calendar - so the
 * kind would have refused the app's own format, and a comparison between the
 * two spellings of one date would have called a perfectly good proposal stale.
 *
 * Getting that right means deciding whether proposing a due date means the day
 * or the moment, and what writing a day back does to a time somebody set on
 * purpose. Neither rule here proposes a due change, so shipping the kind would
 * have meant shipping an unused date handler I had already got wrong once. It
 * can come back with a rule that needs it, and with the timestamps tested.
 */


export const MOVE_KIND_IDS = Object.keys(MOVE_KINDS)

const kindOf = (kind) => MOVE_KINDS[kind] || null

/** Is `value` a legal target for this kind? */
export function isLegalValue(kind, value) {
  const spec = kindOf(kind)
  if (!spec) return false
  if (spec.values) return spec.values.includes(value)
  return spec.valid ? spec.valid(value) : false
}

/** What the record says for this kind, right now. */
export function readField(entity, kind) {
  const spec = kindOf(kind)
  if (!spec || !entity) return undefined
  const raw = entity[spec.field]
  // Normalised so a comparison against the proposal is about the value and not
  // about how it happens to be stored: priority arrives as a number from the
  // schema but as a string from a hand edit, and an absent due date is null
  // in one place and '' in another.
  if (kind === 'priority') return Number(raw) || 0
  if (kind === 'due') return raw || null
  return raw ?? null
}

export const describeValue = (kind, value) => kindOf(kind)?.show(value) ?? String(value)

/**
 * Build a move, or refuse to.
 *
 * Returns null rather than an invalid move, so a caller cannot end up holding
 * something that looks applicable and is not. Every refusal below is a case
 * where applying would have been wrong rather than merely untidy.
 */
export function makeMove(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const kind = String(input.kind || '')
  if (!kindOf(kind)) return null

  const entityId = String(input.entityId || '')
  if (!entityId) return null

  // Evidence is the price of proposing a change. An untraceable claim is kept
  // and labelled elsewhere in this app; an untraceable *edit* is not offered.
  const sources = [...new Set((Array.isArray(input.sources) ? input.sources : []).filter(Boolean))]
  if (!sources.length) return null

  const to = kind === 'priority' ? Number(input.to) : (input.to ?? null)
  if (!isLegalValue(kind, to)) return null

  const from = input.from === undefined ? null : input.from
  // A move that changes nothing is noise wearing the costume of work. Queues
  // fill up with these and then stop being read.
  if (sameValue(kind, from, to)) return null

  return {
    id: input.id || uid('move'),
    briefId: input.briefId || null,
    roundId: input.roundId || null,
    kind,
    entityId,
    from,
    to,
    why: clean(input.why, 240),
    sources,
    state: 'proposed',
    at: input.at || iso(new Date()),
    decidedAt: input.decidedAt || null,
    outcome: input.outcome || null,
  }
}

/** Value equality, per kind. Dates and numbers do not compare with ===. */
export function sameValue(kind, a, b) {
  if (kind === 'priority') return (Number(a) || 0) === (Number(b) || 0)
  if (kind === 'due') return (a || null) === (b || null)
  return (a ?? null) === (b ?? null)
}

/** The states a move can be in, and which of them are finished. */
export const MOVE_STATES = ['proposed', 'applied', 'failed', 'stale', 'declined', 'reverted']

/**
 * A move read back from storage.
 *
 * Not makeMove: that builds a *new* proposal and so always returns one in the
 * 'proposed' state, which would resurrect every decision ever made the next
 * time the file loaded. This keeps the state and the outcome, and drops only
 * rows that are not moves at all.
 *
 * `raw && typeof raw === 'object'` rather than a default parameter, because a
 * default only covers undefined and stored JSON holds nulls - one null row is
 * otherwise enough to stop a whole ledger rendering.
 */
export function normaliseMove(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  if (!MOVE_KINDS[input.kind] || !input.entityId || !input.id) return null
  if (!isLegalValue(input.kind, input.kind === 'priority' ? Number(input.to) : (input.to ?? null))) return null
  const sources = [...new Set((Array.isArray(input.sources) ? input.sources : []).filter(Boolean))]
  if (!sources.length) return null
  return {
    id: String(input.id),
    briefId: input.briefId || null,
    roundId: input.roundId || null,
    rule: input.rule || null,
    kind: input.kind,
    entityId: String(input.entityId),
    from: input.from === undefined ? null : input.from,
    to: input.kind === 'priority' ? Number(input.to) : (input.to ?? null),
    why: clean(input.why, 240),
    sources,
    state: MOVE_STATES.includes(input.state) ? input.state : 'proposed',
    at: input.at || iso(new Date()),
    decidedAt: input.decidedAt || null,
    outcome: input.outcome && typeof input.outcome === 'object' ? input.outcome : null,
  }
}

export const normaliseMoves = (rows) =>
  (Array.isArray(rows) ? rows : []).map(normaliseMove).filter(Boolean)
