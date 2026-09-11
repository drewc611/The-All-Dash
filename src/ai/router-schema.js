/*
 * The router's stored shape.
 *
 * Separate from router-store.js so the workspace store can normalise a
 * restored router without importing anything that imports the store back.
 * A cycle that happens to work because of module hoisting is a cycle waiting
 * to stop working.
 */

import { DEFAULT_POLICY } from './route.js'

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

export function normaliseRouter(input) {
  const base = emptyRouter()
  if (!input || typeof input !== 'object') return base
  return {
    chain: Array.isArray(input.chain)
      ? input.chain.filter((step) => step?.provider && step?.model).slice(0, 8).map((step) => ({
        provider: String(step.provider),
        model: String(step.model),
        baseUrl: step.baseUrl ? String(step.baseUrl) : '',
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

