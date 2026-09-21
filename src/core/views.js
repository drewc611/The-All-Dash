/**
 * What each view is called, in one place.
 *
 * The navigation rail builds its labels from this, and so does anything that
 * names a view back to a person. They used to be separate, and they disagreed:
 * the rail said **Boards** while the brain said **work**, because the brain was
 * printing the view's id. A fact that names a view the person cannot find in
 * the app is worse than no fact at all.
 *
 * Ids are the stable thing - they are in saved layouts and usage counters - so
 * they do not change when a label does.
 */
export const VIEW_LABELS = {
  today: 'Today',
  work: 'Boards',
  triage: 'Triage',
  timeline: 'Timeline',
  analytics: 'Analytics',
  stash: 'Stash',
  studio: 'Studio',
  focus: 'Focus',
  library: 'Library',
  brain: 'Brain',
  agents: 'Agents',
  rounds: 'Rounds',
  settings: 'Settings',
}

/**
 * A view's name for a person.
 *
 * An unknown id comes back as itself rather than as blank or "undefined": a
 * usage counter can outlive the view it was counting, and a stale row is worth
 * showing honestly rather than hiding.
 */
export const labelOfView = (id) => VIEW_LABELS[id] || id
