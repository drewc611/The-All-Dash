/*
 * Feature flags, and the channel that decides which ones are on.
 *
 * The model here is the one thing worth getting right, because the obvious
 * version of it is backwards.
 *
 * A flag declares its *maturity*: how finished that feature actually is. A
 * build declares its *channel*: how much unfinished work the person running it
 * has agreed to put up with. A flag is on by default when its maturity is at
 * least as high as the channel demands.
 *
 *   maturity 'alpha'  → on in alpha only
 *   maturity 'beta'   → on in alpha and beta
 *   maturity 'stable' → on everywhere
 *
 * So work does not reach a wider audience by being moved into a release; it
 * reaches a wider audience by being *promoted*, which is a one-line change
 * here and a line in the changelog. A feature that is not ready for beta
 * testers stays off for them even though their build contains every byte of
 * it. That is the whole point of shipping dark: the code travels ahead of the
 * decision to expose it, and the decision is reversible without a release.
 *
 * Overrides are how a person opts in anyway. They are stored in settings, so
 * they survive a reload and travel in an export - and unlike the three fields
 * in settings-schema.js, a flag is not a secret or a consent to talk to
 * somebody's server, so a restored file may carry them. The one rule is that
 * an override can only name a flag this build knows about: an unknown id is
 * dropped rather than kept, because a flag that no longer exists silently
 * doing nothing is worse than one that is visibly gone.
 */

/** Channels, widest audience last. A build is exactly one of these. */
export const CHANNELS = ['alpha', 'beta', 'rc', 'stable']

const RANK = new Map(CHANNELS.map((c, i) => [c, i]))

/** Where an unknown or malformed channel lands: the most cautious one. */
const FALLBACK = 'stable'

/**
 * The registry.
 *
 * `maturity` is a promise about the code, not a wish about the schedule. Move
 * a flag up this list only when the exit criteria in docs/RELEASING.md for
 * that phase are actually met, because everything downstream - what beta
 * testers see, what the release notes claim - reads it as fact.
 */
export const REGISTRY = {
  focus: {
    maturity: 'stable',
    title: 'Focus',
    summary: 'A Pomodoro timer that records its sessions against the task you ran it on.',
  },
  'focus.wallpaper': {
    maturity: 'stable',
    title: 'Focus wallpapers',
    summary: 'Photographs behind the Focus view, rotating through the day with a crossfade.',
  },
  'focus.glass': {
    maturity: 'stable',
    title: 'Glass in Focus',
    summary: 'Translucent surfaces over the wallpaper, inside the Focus view only.',
  },
  'glass.app': {
    maturity: 'stable',
    title: 'Glass everywhere',
    summary: 'Carries the wallpaper and glass past Focus into the rest of the app. Dense tables keep solid backing regardless.',
  },
}

export const FLAG_IDS = Object.freeze(Object.keys(REGISTRY))

/** A channel's position. Anything unrecognised sorts as the strictest. */
export const rankOf = (channel) => (RANK.has(channel) ? RANK.get(channel) : RANK.get(FALLBACK))

/**
 * The channel a version string describes.
 *
 * `0.2.0-alpha.3` is alpha, `0.2.0-rc.1` is rc, a bare `0.2.0` is stable. A
 * prerelease this does not recognise is treated as alpha rather than stable:
 * guessing "finished" about a build nobody labelled is the expensive
 * direction to be wrong in.
 */
export function channelOf(version) {
  const tag = String(version || '').split('-')[1]
  if (!tag) return 'stable'
  const word = tag.split('.')[0].toLowerCase()
  return RANK.has(word) && word !== 'stable' ? word : 'alpha'
}

/** Whether a flag is on before anybody overrides anything. */
export function defaultFor(id, channel) {
  const flag = REGISTRY[id]
  if (!flag) return false
  return rankOf(flag.maturity) >= rankOf(channel)
}

/**
 * Keep only overrides this build can act on.
 *
 * Returns the dropped ids too, so a settings screen can say "two flags in
 * this file are not in this build" instead of quietly losing them.
 */
export function normaliseFlags(incoming) {
  const from = incoming && typeof incoming === 'object' ? incoming : {}
  const flags = {}
  const dropped = []
  for (const [id, value] of Object.entries(from)) {
    if (!Object.hasOwn(REGISTRY, id)) {
      dropped.push(id)
      continue
    }
    if (typeof value === 'boolean') flags[id] = value
  }
  return { flags, dropped }
}

/**
 * Is this flag on?
 *
 * An override wins over the default in both directions - forcing an alpha
 * feature on in a stable build, and forcing a finished one off because it is
 * in the way.
 */
export function isOn(id, { channel = FALLBACK, overrides = {} } = {}) {
  if (!Object.hasOwn(REGISTRY, id)) return false
  const override = overrides?.[id]
  return typeof override === 'boolean' ? override : defaultFor(id, channel)
}

/**
 * The whole registry as a settings screen wants it: what each flag is, what
 * this build would do on its own, and whether the person has said otherwise.
 */
export function describe({ channel = FALLBACK, overrides = {} } = {}) {
  return FLAG_IDS.map((id) => {
    const flag = REGISTRY[id]
    const fallback = defaultFor(id, channel)
    const override = typeof overrides?.[id] === 'boolean' ? overrides[id] : null
    return {
      id,
      title: flag.title,
      summary: flag.summary,
      maturity: flag.maturity,
      default: fallback,
      override,
      on: override === null ? fallback : override,
    }
  })
}
