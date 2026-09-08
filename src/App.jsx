import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useStore, updateUi } from './core/store.js'
import { onRegistryChange } from './core/registry.js'
import { q } from './core/query.js'
import { rangeFor, RANGE_PRESETS } from './core/time.js'
import { buildReminders, runNotifications } from './engine/reminders.js'
import { seedWorkspace } from './data/seed.js'

import { Board, BoardControls } from './ui/Board.jsx'
import { CommandBar } from './ui/CommandBar.jsx'
import { Inspector } from './ui/Inspector.jsx'
import { DropHint, Toasts, PasteSheet, FilePicker, useIntake } from './ui/Intake.jsx'
import { Timeline } from './ui/views/Timeline.jsx'
import { Library } from './ui/views/Library.jsx'
import { Settings } from './ui/views/Settings.jsx'
import { Segmented } from './ui/components.jsx'
import {
  IconToday, IconTimeline, IconChart, IconLibrary, IconSettings,
  IconSearch, IconUpload, IconBell, IconCommand,
} from './ui/icons.jsx'

import './ui/widgets/index.js'
import './ui/commands.js'

const VIEWS = [
  { id: 'today', label: 'Today', Icon: IconToday, board: true },
  { id: 'timeline', label: 'Timeline', Icon: IconTimeline },
  { id: 'analytics', label: 'Analytics', Icon: IconChart, board: true },
  { id: 'library', label: 'Library', Icon: IconLibrary },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
]

const readHash = () => {
  const id = window.location.hash.replace('#', '')
  return VIEWS.some((v) => v.id === id) ? id : 'today'
}

export default function App() {
  const state = useStore()
  const [view, setView] = useState(readHash)
  const [editing, setEditing] = useState(false)
  const [palette, setPalette] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [inspecting, setInspecting] = useState(null)
  const { dragging, toasts, accept, toast } = useIntake()
  const narrow = useNarrow()

  // Re-render when a plugin registers something after first paint.
  useSyncExternalStore(onRegistryChange, () => null, () => null)

  const entityList = useMemo(() => Object.values(state.entities), [state.entities])
  const range = useMemo(() => rangeFor(state.ui.range), [state.ui.range])

  const navigate = useCallback((next) => {
    setView(next)
    window.location.hash = next
    setEditing(false)
  }, [])

  useEffect(() => {
    const onHash = () => setView(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const theme = state.settings.theme
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    root.setAttribute('data-density', state.settings.density)
  }, [state.settings.theme, state.settings.density])

  useEffect(() => {
    const onKey = (event) => {
      const typing = /^(input|textarea|select)$/i.test(event.target.tagName) || event.target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPalette(true)
        return
      }
      if (typing) return
      if (event.key === '/') { event.preventDefault(); setPalette(true) }
      if (event.key === 'g') window.__allDashGoto = true
      else if (window.__allDashGoto) {
        const target = { t: 'today', l: 'timeline', a: 'analytics', d: 'library', s: 'settings' }[event.key]
        if (target) navigate(target)
        window.__allDashGoto = false
      }
    }
    window.addEventListener('keydown', onKey)
    const onPaste = () => setPasting(true)
    window.addEventListener('alldash:paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('alldash:paste', onPaste)
    }
  }, [navigate])

  // Reminders tick on a minute, plus whenever the tab comes back into focus.
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((n) => n + 1)
    const timer = setInterval(bump, 60000)
    document.addEventListener('visibilitychange', bump)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', bump) }
  }, [])

  const reminders = useMemo(
    () => buildReminders(entityList, state),
    [entityList, state.reminders, state.settings.reminderLeadMinutes]
  )

  useEffect(() => {
    runNotifications(reminders, state.settings.notifications)
  }, [reminders, state.settings.notifications])

  const context = {
    entities: state.entities,
    entityList,
    range,
    state,
    onOpen: setInspecting,
    navigate,
  }

  const active = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const dueNow = reminders.filter((r) => r.urgency === 'overdue' || r.urgency === 'now').length
  const empty = entityList.length === 0

  const related = inspecting
    ? q(entityList).where((e) => e.source?.docId === inspecting.source?.docId && e.id !== inspecting.id).take(8)
    : []

  return (
    <div className="app">
      <nav className="rail" aria-label="Views">
        <div className="rail__brand">
          <span className="rail__mark">AD</span>
          <span className="rail__name truncate">{state.workspace.name}</span>
        </div>

        <div className="rail__group">
          {VIEWS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className="rail__item"
              aria-current={id === view}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span>{label}</span>
              {id === 'today' && dueNow > 0 && <span className="rail__count">{dueNow}</span>}
            </button>
          ))}
        </div>

        <div className="rail__spacer" />

        <div className="rail__group rail__group--desktop">
          <button className="rail__item" onClick={() => setPalette(true)}>
            <IconCommand />
            <span>Command bar</span>
            <span className="rail__count"><span className="kbd">{isMac() ? '⌘' : 'Ctrl'}K</span></span>
          </button>
          <FilePicker onFiles={accept} className="rail__item">
            <IconUpload />
            <span>Import</span>
          </FilePicker>
          <button className="rail__item" onClick={() => setPasting(true)}>
            <IconBell />
            <span>Paste notes</span>
          </button>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            <h1>{active.label}</h1>
            {active.board && <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{range.label}</span>}
          </div>

          <div className="topbar__actions">
            {(active.board || view === 'settings') && (
              <Segmented
                label="Range"
                value={state.ui.range}
                options={(narrow ? ['today', 'week', '30d', 'all'] : RANGE_PRESETS).map((p) => ({ value: p, label: rangeLabel(p) }))}
                onChange={(next) => updateUi({ range: next })}
              />
            )}
            {active.board && <BoardControls view={view} editing={editing} onToggleEditing={() => setEditing((e) => !e)} />}
            <button className="btn btn--icon" onClick={() => setPalette(true)} aria-label="Search"><IconSearch /></button>
          </div>
        </header>

        <div className="scroller">
          {empty && view !== 'settings' ? (
            <FirstRun onSeed={() => seedWorkspace()} onFiles={accept} onPaste={() => setPasting(true)} />
          ) : active.board ? (
            <Board view={view} items={state.boards[view] || []} context={context} editing={editing} />
          ) : view === 'timeline' ? (
            <Timeline entityList={entityList} onOpen={setInspecting} />
          ) : view === 'library' ? (
            <Library entityList={entityList} docs={state.docs} onOpen={setInspecting} onFiles={accept} />
          ) : (
            <Settings state={state} entities={state.entities} range={range} onToast={toast} />
          )}
        </div>
      </div>

      {dragging && <DropHint />}
      <Toasts toasts={toasts} />
      {palette && (
        <CommandBar entities={state.entities} onClose={() => setPalette(false)} onOpen={setInspecting} navigate={navigate} />
      )}
      {pasting && <PasteSheet onClose={() => setPasting(false)} onDone={(message, tone) => toast(message, tone || 'good')} />}
      {inspecting && (
        <Inspector
          entity={state.entities[inspecting.id] || inspecting}
          related={related}
          onOpen={setInspecting}
          onClose={() => setInspecting(null)}
        />
      )}
      <input
        id="global-file-input"
        type="file"
        multiple
        hidden
        onChange={(e) => { accept(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}

function FirstRun({ onSeed, onFiles, onPaste }) {
  return (
    <div className="card" style={{ maxWidth: 620, margin: '8vh auto' }}>
      <div className="card__body" style={{ padding: 'var(--gap-6)' }}>
        <div className="stack">
          <h2 style={{ fontSize: 'var(--t-2xl)', letterSpacing: '-0.02em' }}>Give it something to read.</h2>
          <p className="secondary" style={{ margin: 0 }}>
            Drop meeting notes, a calendar export, a transcript or a spreadsheet anywhere on this page.
            It gets parsed into tasks, events, decisions, risks and metrics, and the dashboard builds itself
            from what it finds. Nothing leaves your browser.
          </p>
          <div className="row row--wrap" style={{ marginTop: 'var(--gap-2)' }}>
            <FilePicker onFiles={onFiles} className="btn btn--primary"><IconUpload width={13} height={13} /> Choose files</FilePicker>
            <button className="btn" onClick={onPaste}>Paste notes</button>
            <button className="btn" onClick={onSeed}>Load a sample project</button>
          </div>
          <div className="divider" style={{ margin: 'var(--gap-3) 0' }} />
          <div className="row row--wrap" style={{ gap: 'var(--gap-1)' }}>
            {['.md', '.txt', '.csv', '.tsv', '.xlsx', '.json', '.ics', '.vtt', '.srt', '.html'].map((ext) => (
              <span key={ext} className="chip mono">{ext}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** One media query, read reactively, for the handful of layout decisions CSS
    cannot make on its own. */
function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const onChange = (e) => setNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

const rangeLabel = (preset) =>
  ({ today: 'Today', week: 'Week', '7d': '7d', '30d': '30d', '90d': '90d', all: 'All' }[preset] || preset)

const isMac = () => typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent)

