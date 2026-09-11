/*
 * The router's stored shape.
 *
 * Separate from router-store.js so the workspace store can normalise a
 * restored router without importing anything that imports the store back.
 * A cycle that happens to work because of module hoisting is a cycle waiting
 * to stop working.
 */

import { DEFAULT_POLICY } from './route.js'
import { endpointFor, usesCustomEndpoint } from './catalogue.js'

// A ledger is for reading trends, not for forensics. Six hundred rows is
// several months of ordinary use and about 80KB, which is a fair share of
// the localStorage the whole workspace has to fit in.
export const MAX_CALLS = 600

export const emptyRouter = () => ({
  chain: [],
  budget: { limit: 0, period: 'day', allowUnpriced: false, maxAttempts: 3 },
  cache: true,
  calls: [],
  health: {},
})

/**
 * @param {object} input        the stored or restored router slice
 * @param {object} [options]
 * @param {boolean} [options.trusted]  false for anything read out of a file.
 *
 * A chain step carries the endpoint it will send an API key to, and there is
 * no UI that sets one - so a non-default endpoint can only have arrived in a
 * restored workspace. Untrusted, even a bring-your-own provider loses its
 * override and falls back to the catalogue, because a file should not be able
 * to redirect a key somewhere the person cannot see.
 */
export function normaliseRouter(input, { trusted = true } = {}) {
  const base = emptyRouter()
  if (!input || typeof input !== 'object') return base
  return {
    chain: Array.isArray(input.chain)
      ? input.chain.filter((step) => step?.provider && step?.model).slice(0, 8).map((step) => ({
        provider: String(step.provider),
        model: String(step.model),
        baseUrl: trusted && usesCustomEndpoint(String(step.provider))
          ? endpointFor(String(step.provider), step.baseUrl)
          : '',
      }))
      : [],
    budget: {
      limit: Number(input.budget?.limit) || 0,
      period: ['day', 'week', 'month'].includes(input.budget?.period) ? input.budget.period : 'day',
      allowUnpriced: !!input.budget?.allowUnpriced,
      maxAttempts: Math.min(8, Math.max(1, Number(input.budget?.maxAttempts) || DEFAULT_POLICY.maxAttempts)),
    },
    cache: input.cache !== false,
    calls: Array.isArray(input.calls) ? input.calls.slice(-MAX_CALLS) : [],
    health: input.health && typeof input.health === 'object' ? input.health : {},
  }
}

