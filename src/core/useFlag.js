/*
 * Reading a flag from a component.
 *
 * Deliberately a hook over the store rather than a module-level constant read
 * once at import: a flag that could not be turned off without a reload would
 * make the override useless for the thing overrides are for, which is turning
 * something off the moment it is in your way.
 *
 * `useFlags` selects the overrides object and derives the list outside the
 * subscription. Returning `describe(...)` straight from the selector would
 * hand useSyncExternalStore a new array on every call, and since it compares
 * with Object.is that is an infinite render, not a slow one.
 */

import { useMemo } from 'react'
import { useStore } from './store.js'
import { CHANNEL } from './build.js'
import { isOn, describe } from './flags.js'

/** @returns {boolean} whether `id` is on in this build for this person. */
export function useFlag(id) {
  return useStore((s) => isOn(id, { channel: CHANNEL, overrides: s.settings.flags }))
}

/** Every flag with its maturity, its default and any override. For Settings. */
export function useFlags() {
  const overrides = useStore((s) => s.settings.flags)
  return useMemo(() => describe({ channel: CHANNEL, overrides }), [overrides])
}
