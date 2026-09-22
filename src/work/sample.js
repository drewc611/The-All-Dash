import { TEMPLATES } from './templates.js'
import { createBoard, createItems, setCell } from './store.js'
import { columnOfKind } from './schema.js'
import { addDays, dayKey } from '../core/time.js'

/**
 * The board the sample project comes with.
 *
 * Templates deliberately carry no rows - an empty board you understand beats a
 * full one you have to clear out, and that stays true for somebody who has
 * decided to use this. But "Load a sample project" is the other job entirely:
 * it exists so a person who has decided nothing can see the thing working, and
 * until now it filled Today, Triage, the Timeline and Analytics and left Boards
 * completely empty. Boards is the largest surface in the app - seven views over
 * the same rows, formulas, rules - and the one-click demo never showed it. You
 * clicked Project plan and got eight column headings and "0 items".
 *
 * So the rows here are shaped to make every view say something rather than to
 * be a realistic backlog:
 *
 *   - four owners, so Workload has more than one bar
 *   - every status used, so the kanban has no empty column
 *   - timelines from three weeks back to five weeks out, so the Timeline has
 *     bars either side of today rather than a row of stubs
 *   - a real dependency chain, because the template's own blurb promises one
 *   - progress values that are not all 0 or 100, because a progress column
 *     where every row reads 0% teaches nothing about what it is for
 *
 * Same cast and same project as the documents the sample imports, so the board
 * and the rest of the workspace are visibly about one thing.
 */

const CAST = {
  priya: 'Priya Raman',
  sam: 'Sam Ojo',
  dev: 'Dev Kaur',
  marco: 'Marco Bianchi',
}

/** Rows, as offsets from today so the sample is never stale. */
const PLAN = [
  {
    group: 0, title: 'Agree the migration cut-over window',
    owner: CAST.priya, status: 'done', priority: 'high', progress: 100,
    from: -21, to: -14, notes: 'Signed off in the steering call. Window is the last Saturday of the month.',
  },
  {
    group: 0, title: 'Audit what still writes to the legacy tables',
    owner: CAST.dev, status: 'done', priority: 'critical', progress: 100,
    from: -18, to: -9, notes: 'Eleven writers. Four are batch jobs nobody owns any more.',
  },
  {
    group: 1, title: 'Rewrite the rollback script for the write path',
    owner: CAST.priya, status: 'working', priority: 'critical', progress: 65,
    from: -7, to: 4, notes: 'The old one assumes a single writer. Everything downstream waits on this.',
  },
  {
    group: 1, title: 'Shard the events table',
    owner: CAST.dev, status: 'working', priority: 'high', progress: 40,
    from: -4, to: 11, dependsOn: 'Rewrite the rollback script for the write path',
    notes: 'Cannot start the online phase until rollback is proven.',
  },
  {
    group: 1, title: 'Load test the pilot cohort at full size',
    owner: CAST.marco, status: 'stuck', priority: 'high', progress: 15,
    from: 2, to: 16, dependsOn: 'Shard the events table',
    notes: 'Blocked on a staging restore that has been running for six hours.',
  },
  {
    group: 2, title: 'Get Legal sign-off on the data residency note',
    owner: CAST.sam, status: 'working', priority: 'medium', progress: 50,
    from: -2, to: 9, notes: 'Second read done. Waiting on the EU clause.',
  },
  {
    group: 2, title: 'Add residency flags to the admin UI',
    owner: CAST.sam, status: 'not-started', priority: 'medium', progress: 0,
    from: 9, to: 20, dependsOn: 'Get Legal sign-off on the data residency note',
  },
  {
    group: 2, title: 'Write the tenant migration FAQ',
    owner: CAST.sam, status: 'not-started', priority: 'low', progress: 0,
    from: 14, to: 25,
  },
  {
    group: 3, title: 'Cut over the first ten tenants',
    owner: CAST.marco, status: 'not-started', priority: 'critical', progress: 0,
    from: 21, to: 28, dependsOn: 'Load test the pilot cohort at full size',
    notes: 'Ten only. If any of them notices, the rest of the wave stops.',
  },
  {
    group: 3, title: 'Retire the legacy sync job',
    owner: CAST.priya, status: 'not-started', priority: 'medium', progress: 0,
    from: 28, to: 35, dependsOn: 'Cut over the first ten tenants',
  },
]

/**
 * Build the sample board.
 *
 * Column ids are generated when the template is built, so they are read back
 * off the created board by kind rather than guessed at. A row written against
 * an id that does not exist lands in no column at all and looks, from the
 * table, exactly like a row somebody forgot to fill in.
 *
 * @returns {object|null} the board, or null if the template has gone.
 */
export function seedSampleBoard() {
  const template = TEMPLATES.find((t) => t.id === 'projects')
  if (!template) return null

  const board = createBoard(template.build())
  const idOf = (kind) => columnOfKind(board, kind)?.id
  const statusColumn = columnOfKind(board, 'status')
  const priorityColumn = columnOfKind(board, 'priority')
  const priority = priorityColumn?.id
  const progress = idOf('progress')
  const dependency = idOf('dependency')
  const notes = idOf('longtext')

  // Two passes: every row has to exist before a dependency can point at one.
  const byGroup = new Map()
  for (const row of PLAN) {
    const groupId = board.groups[row.group]?.id || board.groups[0]?.id
    if (!byGroup.has(groupId)) byGroup.set(groupId, [])
    byGroup.get(groupId).push(row)
  }

  const created = new Map()
  for (const [groupId, rows] of byGroup) {
    const items = createItems(board.id, groupId, rows.map((row) => ({
      title: row.title,
      // Field-backed columns live on the entity itself, not in meta.columns.
      //
      // A timeline column has no field of its own: readCell derives it from
      // `at` and `end`, and makeEntity builds an explicit object, so a
      // `timeline: {from, to}` written here is dropped without a word. The
      // table still shows a Timeline heading over empty cells and the Timeline
      // view says "Nothing has dates yet" over ten rows that all have dates.
      people: [row.owner],
      // The entity's `status` is the app's own vocabulary - open, doing,
      // blocked, done - and a board label says which of those it *maps* to.
      // Writing the label id here instead leaves statusToLabel with nothing to
      // match, so the row lands in no kanban column at all while the table
      // still looks fine. The label id goes in meta.columns as well, so a
      // board with two labels mapping to the same app status still shows the
      // one that was chosen.
      status: statusColumn?.labels?.find((l) => l.id === row.status)?.maps || 'open',
      // Priority is the same trap wearing different clothes, and it survived
      // the first pass because the table still showed a priority - just the
      // wrong one, on all ten rows. The entity field is a number and the
      // column stores a label id, so cellValue trusts the label only while
      // the two agree. Ten labels against a default of 0 all disagreed, and
      // every row fell back to the last label worth 0: Medium. The number
      // comes off the label, the way writeCell does it.
      priority: priorityColumn?.labels?.find((l) => l.id === row.priority)?.value ?? 0,
      at: dayKey(addDays(new Date(), row.from)),
      end: dayKey(addDays(new Date(), row.to)),
      meta: {
        columns: {
          ...(statusColumn ? { [statusColumn.id]: row.status } : {}),
          ...(priority ? { [priority]: row.priority } : {}),
          ...(progress ? { [progress]: row.progress } : {}),
          ...(notes && row.notes ? { [notes]: row.notes } : {}),
        },
      },
    })))
    items.forEach((item, i) => created.set(rows[i].title, item.id))
  }

  // Now the chain, written by title because that is how the plan above reads,
  // and written last because a dependency cannot point at a row that does not
  // exist yet. setCell rather than a direct write, so the board's own effects
  // run: this template pushes dependent dates, and a chain that skipped them
  // would show a successor starting before the thing it waits on.
  if (dependency) {
    for (const row of PLAN) {
      if (!row.dependsOn) continue
      const item = created.get(row.title)
      const on = created.get(row.dependsOn)
      if (item && on) setCell(item, dependency, [on])
    }
  }

  return board
}
