/*
 * The study queue, kept in the workspace.
 *
 * Cards are cut from passages on every run, and cutting them is cheap - but
 * their schedule is not re-derivable from anything. How many times you have
 * seen a card, how often you failed it and when it is next due exist only
 * because you sat and answered it, so that is what gets stored. The question
 * and answer are stored beside them so a card outlives the passage it came
 * from: forgetting an article should not silently wipe the fortnight of
 * review you did on it.
 *
 * Cards are a slice of the store rather than entities. A thousand cloze
 * deletions in the Library would bury every note the person actually wrote,
 * and unlike a saved article or a claim, a card is not something anyone wants
 * to see on a timeline.
 */

import { getState, mutate } from '../core/store.js'
import { schedule, queue as dueQueue, progress } from './tutor.js'
import { emptyStudy, normaliseStudy } from './study-schema.js'

export { emptyStudy, normaliseStudy }

export const allCards = (state = getState()) => Object.values(state.study?.cards || {})

/**
 * Add cards the Tutor cut, without disturbing any that are already being
 * studied. A card's id is derived from its passage and sentence, so running
 * the same question twice does not reset the schedule you have built up.
 */
export function keep(cards) {
  let added = 0
  mutate((s) => {
    const existing = s.study?.cards || {}
    const next = { ...existing }
    for (const card of cards) {
      if (!card?.id || next[card.id]) continue
      next[card.id] = card
      added += 1
    }
    return added ? { ...s, study: { ...(s.study || emptyStudy()), cards: next } } : s
  })
  return added
}

/** Answer one. `grade` is 0-5, as SM-2 defines it. */
export function grade(id, score, { now = new Date() } = {}) {
  let updated = null
  mutate((s) => {
    const card = s.study?.cards?.[id]
    if (!card) return s
    updated = schedule(card, score, { now })
    return { ...s, study: { ...s.study, cards: { ...s.study.cards, [id]: updated } } }
  })
  return updated
}

export function drop(id) {
  mutate((s) => {
    if (!s.study?.cards?.[id]) return s
    const cards = { ...s.study.cards }
    delete cards[id]
    return { ...s, study: { ...s.study, cards } }
  })
}

export const due = (options = {}) => dueQueue(allCards(), options)
export const stats = (options = {}) => progress(allCards(), options)
