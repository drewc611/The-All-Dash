import { useMemo, useState } from 'react'
import { dayKey, formatDate, addDays, startOfDay, endOfDay, isSameDay } from '../../core/time.js'
import { EntityList, Empty, Segmented } from '../components.jsx'

const LENSES = [
  { value: 'all', label: 'Everything' },
  { value: 'event', label: 'Meetings' },
  { value: 'task', label: 'Deadlines' },
  { value: 'milestone', label: 'Milestones' },
]

/**
 * One vertical run of days. Meetings sit on their start time, tasks and
 * milestones on their due date, so a week reads as one thing rather than three
 * separate calendars.
 */
export function Timeline({ entityList, onOpen }) {
  const [lens, setLens] = useState('all')
  const [back, setBack] = useState(3)
  const [forward, setForward] = useState(21)

  const days = useMemo(() => {
    const today = startOfDay(new Date())
    const from = addDays(today, -back)
    // The window runs to the end of its last day, not to that day's midnight,
    // or an afternoon meeting on the final day would fall off the timeline.
    const to = endOfDay(addDays(today, forward))

    const dated = []
    for (const entity of entityList) {
      const when = entity.type === 'event' ? entity.at : entity.due || entity.at
      if (!when) continue
      if (lens !== 'all' && entity.type !== lens) continue
      if (!['event', 'task', 'milestone', 'risk'].includes(entity.type)) continue
      const at = new Date(when)
      if (at < from || at > to) continue
      dated.push({ entity, when: at })
    }

    const grouped = new Map()
    for (const row of dated) {
      const key = dayKey(row.when)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(row)
    }
    return [...grouped.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, rows]) => ({
        key,
        rows: rows.sort((a, b) => a.when - b.when).map((r) => r.entity),
      }))
  }, [entityList, lens, back, forward])

  return (
    <div className="stack">
      <div className="row row--wrap">
        <Segmented value={lens} options={LENSES} onChange={setLens} label="Timeline filter" />
        <div className="spacer" />
        <button className="btn btn--sm" onClick={() => setBack((n) => n + 14)}>Earlier</button>
        <button className="btn btn--sm" onClick={() => setForward((n) => n + 30)}>Later</button>
      </div>

      {!days.length ? (
        <Empty
          title="Nothing dated in this window"
          hint="Import a calendar, or give some tasks a due date, and they appear here."
        />
      ) : (
        <div className="card">
          <div className="timeline" style={{ padding: '0 var(--gap-4)' }}>
            {days.map((day) => {
              const today = isSameDay(day.key, new Date())
              return (
                <div className="timeline__day" key={day.key}>
                  <div className="timeline__date" data-today={today}>
                    <strong>{formatDate(day.key)}</strong>
                    <span>{today ? 'Today' : formatDate(day.key, { weekday: 'long', month: undefined, day: undefined })}</span>
                  </div>
                  <div className="timeline__items">
                    <EntityList entities={day.rows} onOpen={onOpen} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
