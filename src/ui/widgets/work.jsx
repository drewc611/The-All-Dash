import { defineWidget } from '../../core/registry.js'
import { q } from '../../core/query.js'
import { addDays, startOfDay, endOfDay, formatDate, relative, dayKey } from '../../core/time.js'
import { snoozeReminder, dismissReminder, addEntity } from '../../core/store.js'
import { buildReminders } from '../../engine/reminders.js'
import { EntityList, TaskRow, EventRow, Empty } from '../components.jsx'
import { IconBell, IconPlus, IconClock } from '../icons.jsx'
import { useState } from 'react'

/** The widgets that answer "what do I do next". */

defineWidget({
  id: 'agenda',
  name: "Today's agenda",
  description: 'Calendar events for today, in order, with what is starting next called out.',
  category: 'Day',
  size: 'md',
  render: ({ entityList, onOpen }) => {
    const now = new Date()
    const events = q(entityList)
      .type('event')
      .between(startOfDay(now), endOfDay(now), 'at')
      .where((e) => e.status !== 'cancelled')
      .sort('at')
      .all()

    if (!events.length) {
      return <Empty title="No meetings today" hint="Drop a .ics export in and this fills itself." />
    }
    const busy = events.reduce((a, e) => a + (e.end ? (new Date(e.end) - new Date(e.at)) / 3600000 : 0.5), 0)
    return (
      <>
        <div className="list" style={{ margin: 'calc(var(--gap-4) * -1)' }}>
          {events.map((e) => <EventRow key={e.id} entity={e} onOpen={onOpen} />)}
        </div>
        <div className="muted" style={{ marginTop: 'var(--gap-4)', fontSize: 'var(--t-xs)' }}>
          {Math.round(busy * 10) / 10}h booked across {events.length} {events.length === 1 ? 'meeting' : 'meetings'}
        </div>
      </>
    )
  },
})

defineWidget({
  id: 'focus-tasks',
  name: 'Focus list',
  description: 'Open tasks ranked by how much they need you today: overdue, then due, then priority.',
  category: 'Day',
  size: 'md',
  options: [
    { key: 'limit', label: 'Rows', type: 'number', min: 3, max: 30, default: 8 },
    { key: 'person', label: 'Only this person', type: 'people' },
    { key: 'tag', label: 'Only this tag', type: 'tags' },
  ],
  render: ({ entityList, onOpen, config }) => {
    const now = new Date()
    let scope = q(entityList).type('task').open()
    if (config.person) scope = scope.person(config.person)
    if (config.tag) scope = scope.tagged(config.tag)
    const tasks = scope.all()
    const ranked = tasks
      .map((t) => ({ t, score: focusScore(t, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, config.limit || 8)
      .map((r) => r.t)

    if (!ranked.length) return <Empty title="Nothing open" hint="Import notes or add a task with the plus button." />
    return (
      <div className="list" style={{ margin: 'calc(var(--gap-4) * -1)' }}>
        {ranked.map((t) => <TaskRow key={t.id} entity={t} onOpen={onOpen} />)}
      </div>
    )
  },
})

function focusScore(task, now) {
  let score = task.priority * 20
  if (task.due) {
    const days = (new Date(task.due) - now) / 86400000
    score += days < 0 ? 100 + Math.min(50, -days) : Math.max(0, 40 - days * 6)
  }
  if (task.status === 'doing') score += 25
  if (task.status === 'blocked') score += 10
  if (task.people.length) score += 3
  return score
}

defineWidget({
  id: 'reminders',
  name: 'Reminders',
  description: 'Everything with a date attached, in the order it will hit you. Snooze or dismiss inline.',
  category: 'Day',
  size: 'sm',
  options: [{ key: 'limit', label: 'Rows', type: 'number', min: 3, max: 30, default: 8 }],
  render: ({ entityList, state, onOpen, config }) => {
    const reminders = buildReminders(entityList, state).slice(0, config.limit || 8)
    if (!reminders.length) {
      return <Empty title="Nothing scheduled" hint="Tasks with a due date and calendar events show up here." />
    }
    return (
      <ul className="list" style={{ margin: 'calc(var(--gap-4) * -1)' }}>
        {reminders.map((r) => (
          <li key={r.id} className="list__item">
            <span className={`dot dot--${r.urgency === 'overdue' ? 'critical' : r.urgency === 'now' ? 'serious' : r.urgency === 'soon' ? 'warning' : 'accent'}`} style={{ marginTop: 6 }} />
            <button type="button" className="list__main" onClick={() => onOpen?.(r.entity)} style={{ textAlign: 'left' }}>
              <span className="list__title clamp-2">{r.entity.title}</span>
              <span className="list__meta">
                <IconClock width={11} height={11} />
                {r.urgency === 'overdue' ? `Overdue by ${r.label.replace(' ago', '')}` : `${r.kind === 'due' ? 'Due' : 'Starts'} ${r.label}`}
              </span>
            </button>
            <span className="list__side">
              <button className="btn btn--icon btn--sm" title="Snooze 1 hour" aria-label={`Snooze ${r.entity.title} for an hour`} onClick={() => snoozeReminder(r.id, new Date(Date.now() + 3600000).toISOString())}>
                <IconClock width={13} height={13} />
              </button>
              <button className="btn btn--icon btn--sm" title="Dismiss" aria-label={`Dismiss the reminder for ${r.entity.title}`} onClick={() => dismissReminder(r.id)}>
                <IconBell width={13} height={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
    )
  },
})

defineWidget({
  id: 'quick-capture',
  name: 'Quick capture',
  description: 'One box. Type a line, it is parsed for owners, dates and tags and filed as a task.',
  category: 'Day',
  size: 'sm',
  render: () => {
    const [text, setText] = useState('')
    const [last, setLast] = useState(null)

    const submit = (event) => {
      event.preventDefault()
      const line = text.trim()
      if (!line) return
      const entity = addEntity({ type: 'task', title: line, status: 'open', source: { kind: 'manual', name: 'Quick capture' } })
      setLast(entity)
      setText('')
    }

    return (
      <form onSubmit={submit} className="stack" style={{ gap: 'var(--gap-2)' }}>
        <input
          className="input"
          placeholder="Draft the Q3 brief @Sam by Friday #launch"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="Capture a task"
        />
        <div className="row">
          <button className="btn btn--primary btn--sm" type="submit"><IconPlus width={13} height={13} /> Add</button>
          {last && <span className="muted truncate" style={{ fontSize: 'var(--t-xs)' }}>Added &ldquo;{last.title}&rdquo;</span>}
        </div>
        <p className="muted" style={{ fontSize: 'var(--t-xs)', margin: 0 }}>
          @name assigns it, #tag files it, &ldquo;by Friday&rdquo; dates it.
        </p>
      </form>
    )
  },
})

defineWidget({
  id: 'recent-activity',
  name: 'Recent activity',
  description: 'The last things to land, whatever they were and wherever they came from.',
  category: 'Day',
  size: 'md',
  options: [
    { key: 'limit', label: 'Rows', type: 'number', min: 3, max: 40, default: 10 },
    { key: 'type', label: 'Only this type', type: 'select', choices: [
      { value: 'task', label: 'Tasks' }, { value: 'event', label: 'Events' }, { value: 'decision', label: 'Decisions' },
      { value: 'risk', label: 'Risks' }, { value: 'metric', label: 'Metrics' }, { value: 'note', label: 'Notes' }, { value: 'doc', label: 'Documents' },
    ] },
  ],
  render: ({ entityList, onOpen, config }) => {
    let scope = q(entityList).where((e) => e.type !== 'person')
    if (config.type) scope = scope.type(config.type)
    const rows = scope.sort('createdAt', 'desc').take(config.limit || 10)
    return <div style={{ margin: 'calc(var(--gap-4) * -1)' }}><EntityList entities={rows} onOpen={onOpen} /></div>
  },
})

defineWidget({
  id: 'open-questions',
  name: 'Open questions',
  description: 'Questions raised in notes and transcripts that never turned into a decision.',
  category: 'Day',
  size: 'md',
  render: ({ entityList, onOpen }) => {
    const rows = q(entityList).type('note').tagged('question').sort('createdAt', 'desc').take(8)
    if (!rows.length) return <Empty title="No open questions" hint='Lines starting "Question:" or "Q:" are collected here.' />
    return <div style={{ margin: 'calc(var(--gap-4) * -1)' }}><EntityList entities={rows} onOpen={onOpen} /></div>
  },
})

defineWidget({
  id: 'risks',
  name: 'Risks and blockers',
  description: 'Open risks, oldest first, so nothing quietly rots.',
  category: 'Project',
  size: 'md',
  render: ({ entityList, onOpen }) => {
    const rows = q(entityList).type('risk').open().sort('updatedAt').all()
    if (!rows.length) return <Empty title="No open risks" hint='Lines starting "Risk:" or "Blocker:" land here.' />
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {rows.slice(0, 8).map((r) => (
          <button key={r.id} type="button" className="bar-left bar-left--serious" style={{ textAlign: 'left', display: 'block', width: '100%' }} onClick={() => onOpen?.(r)}>
            <div style={{ fontWeight: 520 }}>{r.title}</div>
            <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>
              {r.people[0] ? `${r.people[0]} - ` : ''}last touched {relative(r.updatedAt)}
            </div>
          </button>
        ))}
      </div>
    )
  },
})

defineWidget({
  id: 'decisions',
  name: 'Decision log',
  description: 'Every decision pulled out of your notes, newest first, with where it came from.',
  category: 'Project',
  size: 'md',
  render: ({ entityList, onOpen }) => {
    const rows = q(entityList).type('decision').sort('createdAt', 'desc').take(8)
    if (!rows.length) return <Empty title="No decisions logged" hint='Write "Decision: ..." in a note and it lands here.' />
    return (
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {rows.map((d) => (
          <button key={d.id} type="button" className="bar-left bar-left--good" style={{ textAlign: 'left', display: 'block', width: '100%' }} onClick={() => onOpen?.(d)}>
            <div style={{ fontWeight: 520 }}>{d.title}</div>
            <div className="muted" style={{ fontSize: 'var(--t-xs)' }}>{d.source?.name} - {formatDate(d.createdAt)}</div>
          </button>
        ))}
      </div>
    )
  },
})

defineWidget({
  id: 'milestones',
  name: 'Milestones',
  description: 'Dated milestones on a horizontal track, with today marked.',
  category: 'Project',
  size: 'lg',
  render: ({ entityList, onOpen }) => {
    const rows = q(entityList).type('milestone').where((e) => e.due || e.at).sort('due').all()
    if (!rows.length) return <Empty title="No milestones yet" hint='Add a "## Timeline" section to a note with dated rows.' />

    const dates = rows.map((r) => new Date(r.due || r.at).getTime())
    const min = Math.min(...dates, Date.now())
    const max = Math.max(...dates, Date.now())
    const span = Math.max(1, max - min)
    const pos = (t) => ((t - min) / span) * 100

    return (
      <div className="gantt">
        {rows.slice(0, 12).map((m) => {
          const t = new Date(m.due || m.at).getTime()
          const past = t < Date.now()
          return (
            <div className="gantt__row" key={m.id}>
              <button type="button" className="truncate" style={{ textAlign: 'left', color: 'var(--ink-2)' }} onClick={() => onOpen?.(m)}>
                {m.title}
              </button>
              <div className="gantt__track">
                <span
                  className="gantt__bar"
                  style={{
                    left: `${Math.max(0, Math.min(97, pos(t)))}%`,
                    width: 14,
                    background: past ? 'var(--ink-muted)' : 'var(--series-1)',
                  }}
                  title={formatDate(m.due || m.at, { year: 'numeric' })}
                />
                <span className="gantt__now" style={{ left: `${pos(Date.now())}%` }} title="Today" />
              </div>
            </div>
          )
        })}
      </div>
    )
  },
})

defineWidget({
  id: 'people',
  name: 'Who has what',
  description: 'Open work per person, so an overloaded owner is visible before they say so.',
  category: 'Project',
  size: 'md',
  render: ({ entityList, onOpen }) => {
    const open = q(entityList).type('task').open().all()
    const byPerson = q(open).groupBy((e) => (e.people.length ? e.people : ['Unassigned']))
    const ranked = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    if (!ranked.length) return <Empty title="No open work" />
    const max = ranked[0][1].length
    return (
      <div className="hbar">
        {ranked.map(([name, rows], i) => (
          <div className="hbar__row" key={name}>
            <span className="hbar__label" title={name}>{name}</span>
            <span className="hbar__track">
              <span
                className="hbar__fill"
                style={{ width: `${(rows.length / max) * 100}%`, background: name === 'Unassigned' ? 'var(--ink-muted)' : `var(--series-${(i % 8) + 1})` }}
              />
            </span>
            <button type="button" className="hbar__value" onClick={() => onOpen?.(rows[0])}>{rows.length}</button>
          </div>
        ))}
      </div>
    )
  },
})

defineWidget({
  id: 'week-ahead',
  name: 'Week ahead',
  description: 'The next seven days as columns: meetings on top, deadlines below.',
  category: 'Day',
  size: 'xl',
  render: ({ entityList, onOpen }) => {
    const start = startOfDay(new Date())
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
    const events = q(entityList).type('event').where((e) => e.status !== 'cancelled').all()
    const tasks = q(entityList).type('task').open().all()

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 'var(--gap-2)', overflowX: 'auto' }}>
        {days.map((day, i) => {
          const key = dayKey(day)
          const dayEvents = events.filter((e) => e.at && dayKey(e.at) === key)
          const dayTasks = tasks.filter((t) => t.due && dayKey(t.due) === key)
          return (
            <div key={key} style={{ minWidth: 92 }}>
              <div className="muted" style={{ fontSize: 'var(--t-xs)', fontWeight: 600, marginBottom: 6, color: i === 0 ? 'var(--accent)' : undefined }}>
                {formatDate(day, { weekday: 'short' })}
              </div>
              <div className="stack" style={{ gap: 4 }}>
                {dayEvents.slice(0, 4).map((e) => (
                  <button key={e.id} type="button" onClick={() => onOpen?.(e)} className="chip chip--button truncate" style={{ maxWidth: '100%', justifyContent: 'flex-start' }}>
                    {e.title}
                  </button>
                ))}
                {dayTasks.slice(0, 4).map((t) => (
                  <button key={t.id} type="button" onClick={() => onOpen?.(t)} className="chip chip--button chip--warning truncate" style={{ maxWidth: '100%', justifyContent: 'flex-start' }}>
                    {t.title}
                  </button>
                ))}
                {!dayEvents.length && !dayTasks.length && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>Clear</span>}
              </div>
            </div>
          )
        })}
      </div>
    )
  },
})

