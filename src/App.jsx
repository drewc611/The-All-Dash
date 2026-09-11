import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useStore, updateUi, recordUsage, getState } from './core/store.js'
import { onRegistryChange } from './core/registry.js'
import { q } from './core/query.js'
import { rangeFor, RANGE_PRESETS } from './core/time.js'
import { buildReminders, runNotifications } from './engine/reminders.js'
import { seedWorkspace } from './data/seed.js'

import { Board, BoardControls } from './ui/Board.jsx'
import { CommandBar } from './ui/CommandBar.jsx'
import { Inspector } from './ui/Inspector.jsx'
import { DropHint, Toasts, PasteSheet, UrlSheet, FilePicker, useIntake } from './ui/Intake.jsx'
import { Timeline } from './ui/views/Timeline.jsx'
import { Library } from './ui/views/Library.jsx'
import { Settings } from './ui/views/Settings.jsx'
import { Triage } from './ui/views/Triage.jsx'
import { Brain } from './ui/views/Brain.jsx'
import { Work } from './ui/views/Work.jsx'
import { Studio } from './ui/views/Studio.jsx'
import { MiniPlayer } from './ui/media/MiniPlayer.jsx'
import { runTimedAutomations } from './work/store.js'
import { useBrainSync } from './ui/brainSync.js'
import { Assistant } from './ui/Assistant.jsx'
import { buildTriage } from './engine/triage.js'
import { Segmented } from './ui/components.jsx'
import { FilterBar, applyFilters } from './ui/FilterBar.jsx'
import {
  IconToday, IconTimeline, IconChart, IconLibrary, IconSettings,
  IconSearch, IconUpload, IconBell, IconCommand, IconPulse, IconSpark, IconBrain, IconGrid,
  IconDoc, IconLink, IconPlay, IconVideo,
} from './ui/icons.jsx'

import './ui/widgets/index.js'
import './ui/commands.js'

const VIEWS = [
  { id: 'today', label: 'Today', Icon: IconToday, board: true },
  { id: 'work', label: 'Boards', Icon: IconGrid },
  { id: 'triage', label: 'Triage', Icon: IconPulse, filters: true },
  { id: 'timeline', label: 'Timeline', Icon: IconTimeline, filters: true },
  { id: 'analytics', label: 'Analytics', Icon: IconChart, board: true },
  { id: 'studio', label: 'Studio', Icon: IconVideo },
  { id: 'library', label: 'Library', Icon: IconLibrary },
  { id: 'brain', label: 'Brain', Icon: IconBrain },
  { id: 'settings', label: 'Settings', Icon: IconSettings },
]

const readHash = () => {
  const id = window.location.hash.replace('#', '')
  if (VIEWS.some((v) => v.id === id)) return id
  // No hash: the brain may have learned which view the person opens first.
  const start = getState().settings?.startView
  return VIEWS.some((v) => v.id === start) ? start : 'today'
}

export default function App() {
  const state = useStore()
  const [view, setView] = useState(readHash)
  const scroller = useRef(null)
  const [editing, setEditing] = useState(false)
  const [palette, setPalette] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [importingUrl, setImportingUrl] = useState(null)
  const [inspecting, setInspecting] = useState(null)
  const [asking, setAsking] = useState(null)
  const { dragging, toasts, accept, toast } = useIntake()
  const narrow = useNarrow()

  // Re-render when a plugin registers something after first paint.
  useSyncExternalStore(onRegistryChange, () => null, () => null)

  const allEntities = useMemo(() => Object.values(state.entities), [state.entities])
  // Boards see the filtered world; the library and inspector always see everything.
  const entityList = useMemo(() => applyFilters(allEntities, state.ui), [allEntities, state.ui.filterPeople, state.ui.filterTags])
  const scopedEntities = useMemo(
    () => (entityList === allEntities ? state.entities : Object.fromEntries(entityList.map((e) => [e.id, e]))),
    [entityList, allEntities, state.entities]
  )
  const range = useMemo(() => rangeFor(state.ui.range), [state.ui.range])

  const navigate = useCallback((next) => {
    setView(next)
    window.location.hash = next
    setEditing(false)
    recordUsage('view', next)
  }, [])

  // The brain's usage counters: one session per load, then a heartbeat every
  // half hour while the tab is visible, so "usually here 9-11am" is real.
  useEffect(() => {
    recordUsage('session')
    recordUsage('view', readHash())
    const beat = setInterval(() => { if (document.visibilityState === 'visible') recordUsage('active') }, 30 * 60 * 1000)
    return () => clearInterval(beat)
  }, [])
  useBrainSync(state)

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setAsking((a) => a || {})
        return
      }
      if (typing) return
      if (event.key === '/') { event.preventDefault(); setPalette(true) }
      if (event.key === 'g') window.__allDashGoto = true
      else if (window.__allDashGoto) {
        const target = { t: 'today', r: 'triage', l: 'timeline', a: 'analytics', d: 'library', b: 'brain', s: 'settings', w: 'work', m: 'studio' }[event.key]
        if (target) navigate(target)
        window.__allDashGoto = false
      }
    }
    window.addEventListener('keydown', onKey)
    const onPaste = () => setPasting(true)
    const onToast = (e) => toast(e.detail?.message || '', e.detail?.tone || 'info')
    const onAsk = (e) => setAsking(e.detail || {})
    const onImportUrl = (e) => setImportingUrl(e.detail?.url || '')
    window.addEventListener('alldash:import-url', onImportUrl)
    window.addEventListener('alldash:paste', onPaste)
    window.addEventListener('alldash:toast', onToast)
    window.addEventListener('alldash:ask', onAsk)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('alldash:paste', onPaste)
      window.removeEventListener('alldash:import-url', onImportUrl)
      window.removeEventListener('alldash:toast', onToast)
      window.removeEventListener('alldash:ask', onAsk)
    }
  }, [navigate, toast])

  // Reminders tick on a minute, plus whenever the tab comes back into focus.
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => { setTick((n) => n + 1); runTimedAutomations() }
    const timer = setInterval(bump, 60000)
    document.addEventListener('visibilitychange', bump)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', bump) }
  }, [])

  const reminders = useMemo(
    () => buildReminders(allEntities, state),
    [allEntities, state.reminders, state.settings.reminderLeadMinutes]
  )

  useEffect(() => {
    runNotifications(reminders, state.settings.notifications)
  }, [reminders, state.settings.notifications])

  const onAsk = useCallback((prefill) => setAsking(prefill || {}), [])
  const context = {
    entities: scopedEntities,
    entityList,
    range,
    state,
    onOpen: setInspecting,
    onAsk,
    navigate,
  }

  const urgent = useMemo(
    () => buildTriage(state.entities, { range, customMetrics: state.customMetrics, mutes: state.triage, brain: state.brain }).filter((s) => s.severity === 'critical' || s.severity === 'serious').length,
    [state.entities, range, state.customMetrics, state.triage, state.brain]
  )

  const unreadWork = (state.work?.notifications || []).filter((n) => !n.read).length
  const active = VIEWS.find((v) => v.id === view) || VIEWS[0]
  const dueNow = reminders.filter((r) => r.urgency === 'overdue' || r.urgency === 'now').length
  const empty = allEntities.length === 0

  /* A new view starts at the top. Without this, arriving at Today from a
     scrolled Analytics leaves the first card halfway up the screen. */
  useEffect(() => { scroller.current?.scrollTo({ top: 0, behavior: 'instant' }) }, [view, empty])

  const related = inspecting
    ? q(allEntities).where((e) => e.source?.docId === inspecting.source?.docId && e.id !== inspecting.id).take(8)
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
              {id === 'work' && unreadWork > 0 && <span className="rail__count">{unreadWork}</span>}
              {id === 'triage' && urgent > 0 && <span className="rail__count rail__count--urgent">{urgent}</span>}
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
          <button className="rail__item" onClick={() => setAsking({})}>
            <IconSpark />
            <span>Assistant</span>
            <span className="rail__count"><span className="kbd">{isMac() ? '⌘' : 'Ctrl'}J</span></span>
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
            {active.board && <span className="topbar__sub">{range.label}</span>}
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
            <button className="btn btn--icon" onClick={() => setAsking({})} aria-label="Assistant" title="Assistant"><IconSpark /></button>
            <button className="btn btn--icon" onClick={() => setPalette(true)} aria-label="Search"><IconSearch /></button>
          </div>
        </header>

        {(active.board || active.filters) && !empty && <FilterBar entityList={allEntities} ui={state.ui} />}

        <div className="scroller" ref={scroller}>
          {/* Boards and Settings work on an empty workspace; every other
              view needs something to read first. */}
          {empty && view !== 'settings' && view !== 'work' && view !== 'studio' ? (
            <FirstRun onSeed={() => seedWorkspace()} onFiles={accept} onPaste={() => setPasting(true)} onUrl={() => setImportingUrl('')} />
          ) : active.board ? (
            <Board view={view} items={state.boards[view] || []} context={context} editing={editing} />
          ) : view === 'triage' ? (
            <Triage entities={scopedEntities} state={state} range={range} onOpen={setInspecting} onAsk={onAsk} onToast={toast} />
          ) : view === 'timeline' ? (
            <Timeline entityList={entityList} onOpen={setInspecting} />
          ) : view === 'library' ? (
            <Library entityList={allEntities} docs={state.docs} onOpen={setInspecting} onFiles={accept} />
          ) : view === 'work' ? (
            <Work state={state} onToast={toast} onOpenEntity={setInspecting} />
          ) : view === 'studio' ? (
            <Studio entities={allEntities} onToast={toast} onOpen={setInspecting} />
          ) : view === 'brain' ? (
            <Brain state={state} onOpen={setInspecting} onToast={toast} />
          ) : (
            <Settings state={state} entities={state.entities} range={range} onToast={toast} />
          )}
        </div>
      </div>

      {dragging && <DropHint />}
      <MiniPlayer />
      <Toasts toasts={toasts} />
      {palette && (
        <CommandBar entities={state.entities} onClose={() => setPalette(false)} onOpen={setInspecting} navigate={navigate} />
      )}
      {asking && (
        <Assistant
          prefill={asking}
          entities={state.entities}
          state={state}
          range={range}
          onOpen={setInspecting}
          navigate={navigate}
          onClose={() => setAsking(null)}
          onToast={toast}
        />
      )}
      {pasting && <PasteSheet onClose={() => setPasting(false)} onDone={(message, tone) => toast(message, tone || 'good')} />}
      {importingUrl !== null && <UrlSheet prefill={importingUrl} navigate={navigate} onClose={() => setImportingUrl(null)} onDone={(message, tone) => toast(message, tone || 'good')} />}
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

function FirstRun({ onSeed, onFiles, onPaste, onUrl }) {
  return (
    <div className="firstrun">
      <span className="firstrun__mark">AD</span>
      <h2 className="firstrun__head">Give it something to read.</h2>
      <p className="firstrun__lede">
        Drop meeting notes, a calendar export, a transcript or a spreadsheet anywhere on this page.
        It gets parsed into tasks, events, decisions, risks and metrics, and the dashboard builds
        itself from what it finds. Nothing leaves your browser.
      </p>

      {/* Four ways in, each with the case for taking it - four identical
          buttons would leave the choice to guesswork. */}
      <div className="firstrun__ways">
        <FilePicker onFiles={onFiles} className="way">
          <IconUpload className="way__icon" />
          <strong>Choose files</strong>
          <span>Notes, decks, sheets, calendars, transcripts.</span>
        </FilePicker>
        <button className="way" onClick={onPaste}>
          <IconDoc className="way__icon" />
          <strong>Paste notes</strong>
          <span>Straight from a doc or a chat window.</span>
        </button>
        <button className="way" onClick={onUrl}>
          <IconLink className="way__icon" />
          <strong>Import a web page</strong>
          <span>A wiki page, a changelog, a status post.</span>
        </button>
        <button className="way" onClick={onSeed}>
          <IconPlay className="way__icon" />
          <strong>Load a sample project</strong>
          <span>See the whole thing working in one click.</span>
        </button>
      </div>

      <div className="firstrun__exts">
        {['.md', '.txt', '.docx', '.pptx', '.xlsx', '.csv', '.json', '.ics', '.vtt', '.html'].map((ext) => (
          <span key={ext} className="chip mono">{ext}</span>
        ))}
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

