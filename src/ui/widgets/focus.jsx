import { useMemo } from 'react'
import { defineWidget } from '../../core/registry.js'
import { minutesPerDay, minutesPerHour, minutesPerTask, summary, hoursAndMinutes } from '../../focus/analytics.js'
import { BarChart, HBars, StatTile, SERIES } from '../viz/charts.jsx'
import { Empty } from '../components.jsx'
import { formatDate } from '../../core/time.js'
import { percent } from '../../core/format.js'

/*
 * The Focus timer writes a session log and, until now, nothing read it back.
 * These three widgets are that half of the feature.
 *
 * All three carry `flag: 'focus'`, so they follow the timer itself: a board
 * saved on a build with Focus on, opened on a build with it off, hides them
 * rather than drawing charts of a feature that is not there. The arithmetic
 * all lives in focus/analytics.js and is tested without a browser; what is
 * here is layout.
 */

/*
 * The line under each chart is the sentence that explains it, so it is not
 * `.muted` at 11px: that measured 3.6:1 on a card, under the 4.5 AA wants for
 * small text. One step up the ink ramp and one up the type scale clears it.
 */
const CAPTION = { fontSize: 'var(--t-sm)', color: 'var(--ink-2)', lineHeight: 1.5 }

/** Sessions live on state.focus, which the board context passes through. */
const sessionsOf = (state) => state?.focus?.sessions || []

const NOTHING_YET = (
  <Empty
    title="No focus sessions yet"
    hint="Run a timer in Focus and the minutes land here, on the day and the task you ran it on."
  />
)

defineWidget({
  id: 'focus-time',
  name: 'Focus time',
  description: 'Minutes of focused work per day, with your streak and how many pomodoros you finished.',
  category: 'Focus',
  size: 'md',
  flag: 'focus',
  render: ({ state, range }) => {
    const sessions = sessionsOf(state)
    const { points, stats } = useMemo(
      () => ({ points: minutesPerDay(sessions, range), stats: summary(sessions, range) }),
      [sessions, range]
    )

    if (!stats.sessions) return NOTHING_YET

    return (
      <div style={{ display: 'grid', gap: 'var(--gap-4)' }}>
        <div className="stat">
          {/* Not a StatTile: that formats its value as a number, and an
              afternoon of work reads as "2h 35m" rather than "155". */}
          <span className="stat__label">Focused in this window</span>
          <span className="stat__value stat__value--hero">{hoursAndMinutes(stats.minutes)}</span>
          <span className="stat__foot">
            <span>
              {stats.sessions} session{stats.sessions === 1 ? '' : 's'} over {stats.activeDays} day
              {stats.activeDays === 1 ? '' : 's'}
            </span>
          </span>
        </div>

        <BarChart points={points} unit="min" height={150} color={SERIES[0]} />

        <div className="stat-grid" style={{ margin: 0 }}>
          <StatTile
            label="Average day worked"
            value={stats.averageMinutes}
            unit="min"
            goal="neutral"
            footnote={hoursAndMinutes(stats.averageMinutes)}
          />
          <StatTile
            label="Finished"
            value={stats.completionRate === null ? 0 : Math.round(stats.completionRate * 100)}
            unit="%"
            goal="up"
            footnote={
              stats.abandoned
                ? `${stats.abandoned} stopped early`
                : 'every session ran to the end'
            }
          />
          <StatTile
            label="Current streak"
            value={stats.streak}
            unit="d"
            goal="up"
            footnote={stats.streak ? 'consecutive days' : 'no run going'}
          />
          <StatTile
            label="Best day"
            value={stats.bestDay?.value || 0}
            unit="min"
            goal="neutral"
            footnote={stats.bestDay ? formatDate(stats.bestDay.key, { weekday: 'short' }) : undefined}
          />
        </div>
      </div>
    )
  },
})

defineWidget({
  id: 'focus-by-task',
  name: 'Where the time went',
  description: 'Focus minutes ranked by the task you ran the timer on, including the time you did not link.',
  category: 'Focus',
  size: 'md',
  flag: 'focus',
  render: ({ state, range, entityList }) => {
    const sessions = sessionsOf(state)
    const rows = useMemo(() => {
      const titles = new Map((entityList || []).map((e) => [e.id, e.title]))
      return minutesPerTask(sessions, range, { titleOf: (id) => titles.get(id) })
    }, [sessions, range, entityList])

    if (!rows.length) return NOTHING_YET

    const total = rows.reduce((t, r) => t + r.value, 0)
    return (
      <div style={{ display: 'grid', gap: 'var(--gap-3)' }}>
        <HBars
          rows={rows}
          unit="min"
          // Unlinked time is shown in a muted colour rather than as another
          // bright bar: it is a real number and it is not an achievement.
          colorBy={(row, i) => (row.untracked ? 'var(--ink-muted)' : SERIES[i % SERIES.length])}
        />
        <span style={CAPTION}>
          {hoursAndMinutes(total)} in total.{' '}
          {rows.some((r) => r.untracked)
            ? 'Start a timer from a task to link the next one.'
            : 'Every session is linked to a task.'}
        </span>
      </div>
    )
  },
})

defineWidget({
  id: 'focus-hours',
  name: 'When you focus',
  description: 'Focus minutes by hour of the day, so you can see when you actually sit down to work.',
  category: 'Focus',
  size: 'md',
  flag: 'focus',
  render: ({ state, range }) => {
    const sessions = sessionsOf(state)
    const hours = useMemo(() => minutesPerHour(sessions, range), [sessions, range])
    const total = hours.reduce((t, h) => t + h.value, 0)
    if (!total) return NOTHING_YET

    const best = hours.reduce((top, h) => (h.value > top.value ? h : top), hours[0])
    // Before noon and after six are the two claims people actually make about
    // themselves, so those are the two the copy checks.
    const morning = hours.slice(0, 12).reduce((t, h) => t + h.value, 0)
    const evening = hours.slice(18).reduce((t, h) => t + h.value, 0)

    return (
      <div style={{ display: 'grid', gap: 'var(--gap-3)' }}>
        <BarChart points={hours} unit="min" height={150} color={SERIES[2]} labelOf={hourLabel} />
        <span style={CAPTION}>
          Your best hour is {hourLabel(String(best.hour))}, with {hoursAndMinutes(best.value)}.{' '}
          {percent(morning / total)} of your focused time is before noon and {percent(evening / total)} after six.
        </span>
      </div>
    )
  },
})

/** "09:00" — a bar-chart key here is an hour, not a date. */
function hourLabel(key) {
  const hour = Number(key)
  if (!Number.isFinite(hour)) return ''
  return `${String(hour).padStart(2, '0')}:00`
}
