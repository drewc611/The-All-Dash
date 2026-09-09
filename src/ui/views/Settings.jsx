import { useMemo, useState } from 'react'
import {
  updateSettings, exportWorkspace, importWorkspace, clearWorkspace,
  addCustomMetric, removeCustomMetric,
} from '../../core/store.js'
import { listParsers, listWidgets } from '../../core/registry.js'
import { availableMetrics, discoveredSeries, evaluate } from '../../engine/metrics.js'
import { requestNotificationPermission } from '../../engine/reminders.js'
import { REDUCERS } from '../../core/query.js'
import { ENTITY_TYPES, TYPE_LABEL } from '../../data/schema.js'
import { format } from '../../core/format.js'
import { dayKey } from '../../core/time.js'
import { Card, Segmented, Empty } from '../components.jsx'
import { Sparkline } from '../viz/charts.jsx'
import { IconTrash, IconPlus, IconUpload } from '../icons.jsx'
import { seedWorkspace } from '../../data/seed.js'
import { downloadText } from '../download.js'
import { AssistantSettings } from './AssistantSettings.jsx'
import { PlatformSettings } from './PlatformSettings.jsx'

export function Settings({ state, entities, range, onToast }) {
  return (
    <div className="stack">
      <div className="board">
        <div className="board__cell" data-size="md"><Appearance state={state} /></div>
        <div className="board__cell" data-size="md"><Reminders state={state} onToast={onToast} /></div>
        <div className="board__cell" data-size="xl"><AssistantSettings state={state} onToast={onToast} /></div>
        <div className="board__cell" data-size="xl"><MetricBuilder state={state} entities={entities} range={range} onToast={onToast} /></div>
        <div className="board__cell" data-size="md"><PlatformSettings state={state} onToast={onToast} /></div>
        <div className="board__cell" data-size="md"><Data onToast={onToast} /></div>
        <div className="board__cell" data-size="md"><Harness /></div>
      </div>
    </div>
  )
}

function Appearance({ state }) {
  return (
    <Card title="Appearance">
      <div className="stack">
        <div className="field">
          <span className="field__label">Theme</span>
          <Segmented
            label="Theme"
            value={state.settings.theme}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
            onChange={(theme) => updateSettings({ theme })}
          />
        </div>
        <div className="field">
          <span className="field__label">Density</span>
          <Segmented
            label="Density"
            value={state.settings.density}
            options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
            onChange={(density) => updateSettings({ density })}
          />
        </div>
      </div>
    </Card>
  )
}

function Reminders({ state, onToast }) {
  const enable = async () => {
    const result = await requestNotificationPermission()
    if (result === 'granted') {
      updateSettings({ notifications: true })
      onToast('Notifications on. Reminders will surface even when this tab is in the background.', 'good')
    } else {
      onToast(result === 'unsupported' ? 'This browser has no notification support.' : 'Permission declined - the in-app reminder list still works.', 'critical')
    }
  }

  return (
    <Card title="Reminders">
      <div className="stack">
        <div className="field">
          <label className="field__label" htmlFor="lead">Warn me this far ahead</label>
          <select
            id="lead"
            className="select"
            value={state.settings.reminderLeadMinutes}
            onChange={(e) => updateSettings({ reminderLeadMinutes: Number(e.target.value) })}
          >
            {[5, 10, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </div>
        <div className="row">
          {state.settings.notifications ? (
            <>
              <span className="chip chip--good">System notifications on</span>
              <button className="btn btn--sm" onClick={() => updateSettings({ notifications: false })}>Turn off</button>
            </>
          ) : (
            <button className="btn" onClick={enable}>Enable system notifications</button>
          )}
        </div>
        <p className="muted" style={{ fontSize: 'var(--t-xs)', margin: 0 }}>
          Reminders are derived from due dates and event start times, so re-importing a corrected calendar corrects them too.
        </p>
      </div>
    </Card>
  )
}

const BLANK = {
  name: '',
  entityType: 'task',
  seriesName: '',
  reduce: 'count',
  dateField: 'at',
  unit: '',
  goal: 'up',
  tags: '',
  target: '',
  onlyOpen: false,
}

function MetricBuilder({ state, entities, range, onToast }) {
  const [draft, setDraft] = useState(BLANK)
  const series = useMemo(() => discoveredSeries(entities), [entities])
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const config = {
    ...draft,
    id: `custom:${draft.name.toLowerCase().replace(/\s+/g, '-') || 'preview'}`,
    name: draft.name || 'Preview',
    tags: draft.tags ? draft.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
  }

  const preview = useMemo(() => {
    const compiled = availableMetrics(entities, [config]).find((m) => m.id === config.id)
    return compiled ? evaluate(compiled, entities, range) : null
  }, [entities, range, JSON.stringify(config)])

  const save = () => {
    if (!draft.name.trim()) return
    addCustomMetric(config)
    onToast(`"${config.name}" is now available in every metric widget.`, 'good')
    setDraft(BLANK)
  }

  return (
    <Card title="Build a metric" subtitle="Any slice of your data becomes a number, a sparkline and an insight rule.">
      <div className="stack">
        <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 160 }}>
            <label className="field__label" htmlFor="m-name">Name</label>
            <input id="m-name" className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Weekly signups" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label className="field__label" htmlFor="m-type">Over</label>
            <select id="m-type" className="select" value={draft.entityType} onChange={(e) => set({ entityType: e.target.value })}>
              <option value="any">Anything</option>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label className="field__label" htmlFor="m-reduce">Reduce by</label>
            <select id="m-reduce" className="select" value={draft.reduce} onChange={(e) => set({ reduce: e.target.value })}>
              {REDUCERS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label className="field__label" htmlFor="m-date">Date field</label>
            <select id="m-date" className="select" value={draft.dateField} onChange={(e) => set({ dateField: e.target.value })}>
              <option value="at">Happened at</option>
              <option value="due">Due</option>
              <option value="createdAt">Imported at</option>
              <option value="updatedAt">Last touched</option>
            </select>
          </div>
        </div>

        <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
          {series.length > 0 && (
            <div className="field" style={{ flex: 2, minWidth: 160 }}>
              <label className="field__label" htmlFor="m-series">Series found in your data</label>
              <select id="m-series" className="select" value={draft.seriesName} onChange={(e) => set({ seriesName: e.target.value })}>
                <option value="">Any</option>
                {series.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
              </select>
            </div>
          )}
          <div className="field" style={{ flex: 1, minWidth: 130 }}>
            <label className="field__label" htmlFor="m-tags">Only tags</label>
            <input id="m-tags" className="input" value={draft.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="launch, billing" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100 }}>
            <label className="field__label" htmlFor="m-unit">Unit</label>
            <input id="m-unit" className="input" value={draft.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="$, %, h" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 100 }}>
            <label className="field__label" htmlFor="m-target">Target</label>
            <input id="m-target" className="input" type="number" value={draft.target} onChange={(e) => set({ target: e.target.value })} placeholder="optional" />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <span className="field__label">Good is</span>
            <Segmented
              label="Direction"
              value={draft.goal}
              options={[{ value: 'up', label: 'Up' }, { value: 'down', label: 'Down' }]}
              onChange={(goal) => set({ goal })}
            />
          </div>
        </div>

        <div className="row row--between" style={{ padding: 'var(--gap-3)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', background: 'var(--surface-2)' }}>
          <div className="stat">
            <span className="stat__label">{config.name}</span>
            <span className="stat__value">{preview ? format(preview.value, preview.unit) : '0'}</span>
            <span className="stat__foot">
              {range.label.toLowerCase()}
              {preview?.change !== null && preview?.change !== undefined && Number.isFinite(preview.previous) ? ` - ${preview.change >= 0 ? '+' : ''}${Math.round(preview.change * 100)}% vs previous` : ''}
              {preview?.target ? ` - ${Math.round((preview.progress || 0) * 100)}% of target` : ''}
            </span>
          </div>
          <div style={{ width: 180 }}>{preview?.series?.length > 1 && <Sparkline points={preview.series} height={44} />}</div>
        </div>

        <div className="row">
          <button className="btn btn--primary" onClick={save} disabled={!draft.name.trim()}><IconPlus width={13} height={13} /> Save metric</button>
          <button className="btn" onClick={() => setDraft(BLANK)}>Reset</button>
        </div>

        {state.customMetrics.length > 0 && (
          <div className="stack" style={{ gap: 'var(--gap-2)' }}>
            <span className="field__label">Saved metrics</span>
            {state.customMetrics.map((m) => (
              <div key={m.id} className="row" style={{ padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)' }}>
                <span style={{ fontWeight: 520 }}>{m.name}</span>
                <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{m.reduce} over {m.entityType}{m.seriesName ? ` / ${m.seriesName}` : ''}{m.target ? ` - target ${m.target}` : ''}</span>
                <div className="spacer" />
                <button className="btn btn--icon btn--danger btn--sm" onClick={() => removeCustomMetric(m.id)} aria-label={`Delete ${m.name}`}><IconTrash width={13} height={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

function Data({ onToast }) {
  const download = () =>
    downloadText(exportWorkspace(), `all-dash-${dayKey(new Date())}.json`, 'application/json')

  const restore = async (files) => {
    const file = files?.[0]
    if (!file) return
    try {
      importWorkspace(await file.text())
      onToast('Workspace restored.', 'good')
    } catch (error) {
      onToast(`Could not read that file: ${error.message}`, 'critical')
    }
  }

  return (
    <Card title="Your data">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Everything lives in this browser. Nothing is uploaded anywhere. Export to move between machines, or to keep a snapshot before a big import.
        </p>
        <div className="row row--wrap">
          <button className="btn" onClick={download}>Export workspace</button>
          <label className="btn" style={{ cursor: 'pointer' }}>
            <IconUpload width={13} height={13} /> Restore
            <input type="file" accept=".json" hidden onChange={(e) => { restore(e.target.files); e.target.value = '' }} />
          </label>
          <button className="btn" onClick={() => { seedWorkspace(); onToast('Sample project loaded.', 'good') }}>Load sample project</button>
          <button
            className="btn btn--danger"
            onClick={() => { if (confirm('Delete everything in this workspace? This cannot be undone.')) { clearWorkspace(); onToast('Workspace cleared.') } }}
          >
            <IconTrash width={13} height={13} /> Clear everything
          </button>
        </div>
      </div>
    </Card>
  )
}

function Harness() {
  const parsers = listParsers()
  const widgets = listWidgets()
  return (
    <Card title="The harness" subtitle="What is plugged in right now.">
      <div className="stack">
        <div className="field">
          <span className="field__label">Readers ({parsers.length})</span>
          <div className="row row--wrap">
            {parsers.map((p) => (
              <span key={p.id} className="chip" title={p.name}>{p.extensions.length ? p.extensions.join(' ') : 'fallback'}</span>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field__label">Widgets ({widgets.length})</span>
          <div className="row row--wrap">
            {widgets.map((w) => <span key={w.id} className="chip">{w.name}</span>)}
          </div>
        </div>
        <div className="field">
          <span className="field__label">Extend it</span>
          <pre className="mono" style={{ margin: 0, padding: 'var(--gap-3)', background: 'var(--surface-sunken)', borderRadius: 'var(--r-sm)', fontSize: 'var(--t-xs)', overflowX: 'auto' }}>
{`AllDash.defineWidget({
  id: 'my-widget',
  name: 'My widget',
  description: 'Whatever you need',
  render: ({ entityList }) =>
    <b>{entityList.length} items</b>,
})`}
          </pre>
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            Available on window as AllDash. Also takes defineParser, defineMetric and defineCommand.
          </span>
        </div>
      </div>
    </Card>
  )
}
