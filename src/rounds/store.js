/*
 * Rounds, in the workspace.
 *
 * Every action takes `now` rather than reading the clock, so the tests drive
 * time instead of waiting for it, and the cadence arithmetic in due.js stays
 * pure with the state handling here.
 */

import { getState, mutate } from '../core/store.js'
import { makeRound, makeBrief } from './schema.js'
import { iso } from '../core/time.js'

const MAX_BRIEFS = 60

export const roundsState = (state = getState()) => state.rounds

const write = (next) => mutate((s) => ({ ...s, rounds: { ...s.rounds, ...next } }))

/** Add a round. Returns it, or null if it could not be one. */
export function addRound(input) {
  const round = makeRound(input)
  if (!round) return null
  write({ rounds: [...roundsState().rounds, round] })
  return round
}

export function updateRound(id, patch) {
  write({
    rounds: roundsState().rounds.map((r) => {
      if (r.id !== id) return r
      // Back through makeRound so an edit cannot produce a round the loader
      // would later refuse: the validation lives in one place.
      return makeRound({ ...r, ...patch }) || r
    }),
  })
}

export function removeRound(id) {
  // The briefs stay. They are a record of what was true when they were
  // written, and deleting the round that asked does not make them untrue.
  write({ rounds: roundsState().rounds.filter((r) => r.id !== id) })
}

/**
 * Record a run.
 *
 * `lastRunAt` moves whether or not the round produced findings, and whether or
 * not it was refused for cost - all three are "this period has been dealt
 * with". Not moving it on a refusal would retry the same expensive round on
 * every single opening of the app.
 */
export function recordBrief(roundId, briefInput, { now = new Date() } = {}) {
  const brief = makeBrief({ ...briefInput, roundId })
  const state = roundsState()
  write({
    briefs: [brief, ...state.briefs].slice(0, MAX_BRIEFS),
    rounds: state.rounds.map((r) =>
      r.id === roundId ? { ...r, lastRunAt: iso(now), lastBriefId: brief.id } : r),
  })
  return brief
}

/** Every brief a round has produced, newest first. */
export const briefsFor = (roundId, state = getState()) =>
  roundsState(state).briefs.filter((b) => b.roundId === roundId)

export const latestBrief = (roundId, state = getState()) => briefsFor(roundId, state)[0] || null
