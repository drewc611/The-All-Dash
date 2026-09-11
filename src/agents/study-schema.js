/*
 * What a study card is, apart from the store.
 *
 * Separate from study.js for the same reason router-schema.js is separate
 * from router-store.js: the store needs this to build its initial state, and
 * a module the store imports must not import the store back. That cycle has
 * already cost this codebase one silent bug, where a constant left behind in
 * the wrong half meant a ledger recorded nothing at all.
 */

import { emptyCard } from './tutor.js'

export const emptyStudy = () => ({ cards: {} })

/**
 * Merge whatever was persisted with the current shape, so old exports load.
 *
 * A card that is not shaped like one is dropped rather than repaired. A
 * half-built card cannot be answered, and one that cannot be answered comes
 * back for review every day forever.
 */
export function normaliseStudy(raw) {
  const base = emptyStudy()
  if (!raw || typeof raw !== 'object') return base
  const cards = {}
  for (const [id, card] of Object.entries(raw.cards || {})) {
    if (!card || typeof card !== 'object') continue
    if (typeof card.question !== 'string' || !card.question) continue
    if (typeof card.answer !== 'string' || !card.answer) continue
    cards[id] = {
      ...emptyCard(),
      ...card,
      id,
      ease: Number.isFinite(card.ease) ? Math.max(1.3, card.ease) : 2.5,
      interval: Number.isFinite(card.interval) ? Math.max(0, card.interval) : 0,
      repetitions: Number.isFinite(card.repetitions) ? Math.max(0, card.repetitions) : 0,
      lapses: Number.isFinite(card.lapses) ? Math.max(0, card.lapses) : 0,
    }
  }
  return { ...base, cards }
}
