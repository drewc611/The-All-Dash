/*
 * The router's slice of the workspace.
 *
 * Three things live here: the policy (chain, budget, cache), the ledger (what
 * every call cost and whether it worked) and provider health (which ones are
 * currently rested). Keys never do - they stay in keys.js, which keeps them
 * out of the export and out of localStorage unless asked.
 */

import { getState, mutate } from '../core/store.js'
import { listKeyAliases } from './keys.js'
import { emptyRouter, normaliseRouter, MAX_CALLS } from './router-schema.js'

export { emptyRouter, normaliseRouter }

/** The policy, with the key aliases the planner needs to rotate between. */
export function routerPolicy(state = getState()) {
  const router = state?.router || emptyRouter()
  const keys = {}
  for (const step of router.chain) {
    if (keys[step.provider]) continue
    keys[step.provider] = listKeyAliases(step.provider)
  }
  return { ...router, keys }
}

export const routerHealth = (state = getState()) => state?.router?.health || {}

export function setRouterHealth(health) {
  mutate((s) => ({ ...s, router: { ...(s.router || emptyRouter()), health: health || {} } }))
}

export function recordCalls(calls) {
  if (!calls?.length) return
  mutate((s) => {
    const router = s.router || emptyRouter()
    return { ...s, router: { ...router, calls: [...router.calls, ...calls].slice(-MAX_CALLS) } }
  })
}

export function setChain(chain) {
  mutate((s) => ({ ...s, router: normaliseRouter({ ...(s.router || emptyRouter()), chain }) }))
}

export function setBudget(patch) {
  mutate((s) => {
    const router = s.router || emptyRouter()
    return { ...s, router: normaliseRouter({ ...router, budget: { ...router.budget, ...patch } }) }
  })
}

export function setCacheEnabled(on) {
  mutate((s) => ({ ...s, router: { ...(s.router || emptyRouter()), cache: !!on } }))
}

export function clearLedger() {
  mutate((s) => ({ ...s, router: { ...(s.router || emptyRouter()), calls: [], health: {} } }))
}
