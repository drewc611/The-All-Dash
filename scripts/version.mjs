/*
 * Which version may follow which.
 *
 * Split out from release.mjs so it can be tested without touching git or the
 * filesystem. The rule this enforces is the one a release process exists for:
 * you cannot get to `beta` without having been through `alpha`, and you
 * cannot quietly skip a stable release that never happened.
 *
 * Legal progression inside one version:
 *
 *   alpha.1 → alpha.2 → beta.1 → beta.2 → rc.1 → rc.2 → (stable)
 *
 * You may move forward along that line, or increment within the phase you are
 * in. You may not move backwards, and a new version may only be entered from
 * a stable release - so `0.2.0` is what `0.3.0-alpha.1` follows, never
 * `0.2.0-rc.1`.
 */

const PHASES = ['alpha', 'beta', 'rc']
const PHASE_RANK = new Map(PHASES.map((p, i) => [p, i]))
// Stable sits past every prerelease phase, which is what makes the single
// comparison below work for "beta.2 → rc.1" and "rc.1 → stable" alike.
const STABLE = PHASES.length

const PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/

/** @returns {{major:number,minor:number,patch:number,phase:number,iteration:number}|null} */
export function parseVersion(text) {
  const m = PATTERN.exec(String(text || '').trim())
  if (!m) return null
  const [, major, minor, patch, phase, iteration] = m
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    phase: phase ? PHASE_RANK.get(phase) : STABLE,
    iteration: phase ? Number(iteration) : 0,
  }
}

const release = (v) => [v.major, v.minor, v.patch]
const sameRelease = (a, b) => release(a).every((n, i) => n === release(b)[i])

/** Is `b` a strictly later x.y.z than `a`, ignoring any prerelease tag? */
const laterRelease = (a, b) => {
  const [x, y, z] = release(a)
  const [p, q, r] = release(b)
  return p > x || (p === x && (q > y || (q === y && r > z)))
}

/**
 * May `next` follow `current`?
 *
 * @returns {{ok: true} | {ok: false, why: string}} - the reason is written for
 *          whoever typed the command, since "invalid version" tells them
 *          nothing about which of several rules they tripped.
 */
export function canFollow(current, next) {
  const from = parseVersion(current)
  const to = parseVersion(next)
  if (!to) return { ok: false, why: `"${next}" is not a version. Expected 1.2.3, or 1.2.3-alpha.1 with a phase of alpha, beta or rc.` }
  if (!from) return { ok: false, why: `the current version "${current}" cannot be parsed, so nothing can be said to follow it` }

  if (sameRelease(from, to)) {
    if (to.phase > from.phase) return { ok: true }
    if (to.phase < from.phase) {
      return { ok: false, why: `that moves backwards, from ${nameOf(from)} to ${nameOf(to)}. A phase does not reopen; cut the next version instead.` }
    }
    if (to.phase === STABLE) return { ok: false, why: `${current} is already released. A fix on top of it is ${from.major}.${from.minor}.${from.patch + 1}.` }
    if (to.iteration > from.iteration) return { ok: true }
    return { ok: false, why: `${next} is not ahead of ${current}.` }
  }

  if (!laterRelease(from, to)) {
    return { ok: false, why: `${next} is not later than ${current}.` }
  }
  // A new version starts from a finished one. Starting 0.3.0 while 0.2.0 is
  // still at rc would abandon a release nobody ever shipped.
  if (from.phase !== STABLE) {
    return { ok: false, why: `${current} is still a prerelease. Finish it (cut ${from.major}.${from.minor}.${from.patch}) before starting ${next}.` }
  }
  if (to.phase !== 0 && to.phase !== STABLE) {
    return { ok: false, why: `a new version starts at alpha.1 or goes straight to stable; ${next} skips alpha.` }
  }
  if (to.phase === 0 && to.iteration !== 1) {
    return { ok: false, why: `a new version's first alpha is alpha.1, not alpha.${to.iteration}.` }
  }
  return { ok: true }
}

/** "0.2.0 beta.1" in words, for an error message. */
function nameOf(v) {
  const base = `${v.major}.${v.minor}.${v.patch}`
  return v.phase === STABLE ? `${base} (stable)` : `${base}-${PHASES[v.phase]}.${v.iteration}`
}

/** The channel a version runs on. Mirrors channelOf in src/core/flags.js. */
export const channelFor = (text) => {
  const v = parseVersion(text)
  if (!v) return 'alpha'
  return v.phase === STABLE ? 'stable' : PHASES[v.phase]
}

/** What could legally come next, for an error message that helps. */
export function suggestions(current) {
  const v = parseVersion(current)
  if (!v) return []
  const base = `${v.major}.${v.minor}.${v.patch}`
  if (v.phase === STABLE) return [`${v.major}.${v.minor + 1}.0-alpha.1`, `${v.major}.${v.minor}.${v.patch + 1}-alpha.1`]
  const out = [`${base}-${PHASES[v.phase]}.${v.iteration + 1}`]
  for (let p = v.phase + 1; p < PHASES.length; p += 1) out.push(`${base}-${PHASES[p]}.1`)
  out.push(base)
  return out
}
