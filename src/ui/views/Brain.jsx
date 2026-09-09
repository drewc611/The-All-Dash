import { useEffect, useMemo, useState } from 'react'
import { buildBrain, WEEKDAYS } from '../../brain/learn.js'
import { renderBrain } from '../../brain/markdown.js'
import { acceptOpinion, dismissOpinion, forgetOpinion, updateBrainProfile, setBrainNote, resetBrain } from '../../core/store.js'
import { relative } from '../../core/time.js'
import { Card, Empty } from '../components.jsx'
import { IconCheck, IconClose, IconTrash } from '../icons.jsx'
import { canSyncFolder, connectBrainFolder, disconnectBrainFolder, syncBrainNow, downloadBrainZip, downloadBrainFile } from '../brainSync.js'

/**
 * The Brain view: what the app has learned, who it thinks you are, the
 * opinions waiting for a yes or a no, and the Markdown files it all becomes.
 * Everything on this page is computed by rules from your own data; there is
 * no model behind it.
 */
export function Brain({ state, onOpen, onToast }) {
  const brain = useMemo(() => buildBrain(state), [state.entities, state.docs, state.brain, state.workspace])
  const files = useMemo(() => renderBrain(brain, state.brain || {}), [brain, state.brain])
  const pending = brain.opinions.filter((o) => o.status === 'pending')
  const accepted = brain.opinions.filter((o) => o.status === 'accepted')
  const dismissed = brain.opinions.filter((o) => o.status === 'dismissed')
  const empty = !Object.keys(state.entities).length

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat label="Facts" value={brain.facts.length} />
        <Stat label="Opinions waiting" value={pending.length} tone={pending.length ? 'accent' : null} />
        <Stat label="People" value={brain.people.length} />
        <Stat label="Topics" value={brain.topics.length} />
      </div>

      <div className="brain-grid">
        <Profile state={state} brain={brain} />
        <Card title="What it knows" subtitle="Recorded automatically. Rules over your own data; no model.">
          {brain.facts.length ? (
            <ul className="fact-list">{brain.facts.map((f) => <li key={f}>{f}</li>)}</ul>
          ) : (
            <Empty title="Nothing learned yet" hint={empty ? 'Import a few documents or load the sample project.' : 'Use the app for a while: finish tasks, open views, import files.'} />
          )}
        </Card>
      </div>

      <Card
        title="Opinions"
        subtitle="Judgements with evidence. Accept one and the dashboard changes; dismiss it and it stays quiet until the evidence changes."
        tools={accepted.length + dismissed.length > 0 ? <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{accepted.length} accepted · {dismissed.length} dismissed</span> : null}
        flush
      >
        {!brain.opinions.length ? (
          <Empty title="No opinions yet" hint="They appear once there is enough evidence: a few finished tasks, a few people, a couple of weeks of use." />
        ) : (
          <div className="list">
            {[...pending, ...accepted, ...dismissed].map((o) => (
              <Opinion key={o.id} opinion={o} entities={state.entities} onOpen={onOpen} onToast={onToast} />
            ))}
          </div>
        )}
      </Card>

      <div className="brain-grid">
        <Card title="People" subtitle="Who shows up in your work, and how they carry it." flush>
          {brain.people.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Name</th><th>Open</th><th>Done</th><th>Late</th><th>On time</th><th>Last seen</th><th>Works with</th></tr></thead>
                <tbody>
                  {brain.people.slice(0, 20).map((p) => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td>{p.open}</td>
                      <td>{p.done}</td>
                      <td>{p.overdue ? <span className="chip chip--critical">{p.overdue}</span> : 0}</td>
                      <td>{p.onTimeRate === null ? '-' : `${Math.round(p.onTimeRate * 100)}%`}</td>
                      <td className="muted">{p.lastSeen ? relative(p.lastSeen) : '-'}</td>
                      <td className="muted">{p.with.join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No people yet" hint="Names come from @mentions, attendee lists and assignee columns." />}
        </Card>
        <Card title="Topics" subtitle="Tags, with how they move and how often they slip." flush>
          {brain.topics.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Tag</th><th>Open</th><th>Late</th><th>Slips</th><th>Momentum</th><th>People</th></tr></thead>
                <tbody>
                  {brain.topics.slice(0, 20).map((t) => (
                    <tr key={t.tag}>
                      <td>#{t.tag}</td>
                      <td>{t.open}</td>
                      <td>{t.overdue ? <span className="chip chip--critical">{t.overdue}</span> : 0}</td>
                      <td>{t.slipRate === null ? '-' : `${Math.round(t.slipRate * 100)}%`}</td>
                      <td className={t.momentum > 0 ? 'stat__delta stat__delta--good' : t.momentum < 0 ? 'stat__delta stat__delta--neutral' : 'muted'}>{t.momentum > 0 ? `+${t.momentum}` : t.momentum || '·'}</td>
                      <td className="muted">{t.people.join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No topics yet" hint="Tags come from #hashtags, labels and category columns." />}
        </Card>
      </div>

      <Habits brain={brain} />
      <Files state={state} files={files} onToast={onToast} />

      <Card title="Forget everything">
        <div className="row row--wrap">
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: 240 }}>
            Clears the profile, notes, accepted and dismissed opinions and the usage counters. Your documents and items stay; the brain starts learning again from them.
          </p>
          <button className="btn btn--danger" onClick={() => { if (confirm('Forget everything the brain has learned?')) { resetBrain(); onToast?.('Brain reset.') } }}>
            <IconTrash width={13} height={13} /> Reset the brain
          </button>
        </div>
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span className="stat__value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</span>
    </div>
  )
}

function Profile({ state, brain }) {
  const profile = state.brain?.profile || {}
  const field = (key, label, placeholder) => (
    <div className="field" style={{ flex: 1, minWidth: 140 }}>
      <label className="field__label" htmlFor={`brain-${key}`}>{label}</label>
      <input id={`brain-${key}`} className="input" value={profile[key] || ''} placeholder={placeholder} onChange={(e) => updateBrainProfile({ [key]: e.target.value })} />
    </div>
  )
  return (
    <Card title="Who you are" subtitle="The three things it cannot infer. Everything else on this page it worked out.">
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
          {field('name', 'Name', 'Your name')}
          {field('role', 'Role', 'e.g. Engineering manager')}
          {field('focus', 'Focus right now', 'e.g. the Atlas migration')}
        </div>
        <div className="row row--wrap" style={{ gap: 'var(--gap-1)' }}>
          <span className="chip">{brain.profile.workspace}</span>
          {brain.profile.since && <span className="chip">first seen {relative(brain.profile.since)}</span>}
          <span className="chip">{brain.profile.sessions} {brain.profile.sessions === 1 ? 'session' : 'sessions'}</span>
          <span className="chip">{brain.profile.documents} {brain.profile.documents === 1 ? 'document' : 'documents'}</span>
          {brain.profile.timezone && <span className="chip mono">{brain.profile.timezone}</span>}
          {brain.rhythm.activeHours.length > 0 && <span className="chip chip--accent">usually {brain.rhythm.activeHours.join(', ')}</span>}
        </div>
      </div>
    </Card>
  )
}

function Opinion({ opinion, entities, onOpen, onToast }) {
  const evidence = opinion.evidence.map((id) => entities[id]).filter(Boolean).slice(0, 5)
  const tone = opinion.status === 'accepted' ? 'good' : opinion.status === 'dismissed' ? 'info' : 'accent'
  return (
    <div className={`list__item opinion opinion--${opinion.status}`}>
      <span className={`dot dot--${tone}`} />
      <div className="list__main">
        <div className="list__title" style={{ whiteSpace: 'normal' }}>{opinion.text}</div>
        <div className="list__meta row row--wrap" style={{ gap: 'var(--gap-1)' }}>
          <span className="chip">{opinion.kind}</span>
          {opinion.status === 'accepted' && <span className="chip chip--good"><IconCheck width={11} height={11} /> accepted {opinion.acceptedAt ? relative(opinion.acceptedAt) : ''}</span>}
          {opinion.status === 'dismissed' && <span className="chip">dismissed</span>}
          {evidence.map((e) => (
            <button key={e.id} type="button" className="chip chip--button" onClick={() => onOpen?.(e)} title={e.title}>{e.title.length > 32 ? `${e.title.slice(0, 30)}…` : e.title}</button>
          ))}
          {opinion.evidence.length > evidence.length && <span className="muted">+{opinion.evidence.length - evidence.length}</span>}
        </div>
      </div>
      <div className="list__side row" style={{ flex: 'none' }}>
        {opinion.status === 'pending' && (
          <>
            <button className="btn btn--sm btn--primary" onClick={() => { acceptOpinion(opinion); onToast?.('Accepted. The dashboard will use it.', 'good') }}><IconCheck width={12} height={12} /> Accept</button>
            <button className="btn btn--sm" onClick={() => dismissOpinion(opinion.id)}><IconClose width={12} height={12} /> Dismiss</button>
          </>
        )}
        {opinion.status !== 'pending' && (
          <button className="btn btn--sm btn--ghost" onClick={() => forgetOpinion(opinion.id)}>{opinion.status === 'accepted' ? 'Forget' : 'Reconsider'}</button>
        )}
      </div>
    </div>
  )
}

function Habits({ brain }) {
  const { rhythm, habits } = brain
  const maxDone = Math.max(1, ...rhythm.doneByWeekday)
  const maxMeet = Math.max(1, ...rhythm.meetingsByWeekday)
  const maxHour = Math.max(1, ...(brain.profile.sessions ? usageHours(brain) : []))
  return (
    <Card title="Habits" subtitle={habits.finished ? `${habits.finished} dated tasks finished in the app, ${habits.finishedLate} after their due date.` : 'Finish a few dated tasks in the app and the rhythm shows up here.'}>
      <div className="brain-grid">
        <div>
          <div className="stat__label" style={{ marginBottom: 'var(--gap-2)' }}>Tasks finished and meetings, by weekday</div>
          <div className="bars">
            {WEEKDAYS.map((name, i) => (
              <div key={name} className="bar-row">
                <span className="bar-row__label">{name.slice(0, 3)}</span>
                <span className="bar-row__track"><span className="bar-row__fill" style={{ width: `${(rhythm.doneByWeekday[i] / maxDone) * 100}%` }} /></span>
                <span className="bar-row__value">{rhythm.doneByWeekday[i]}</span>
                <span className="bar-row__track"><span className="bar-row__fill bar-row__fill--alt" style={{ width: `${(rhythm.meetingsByWeekday[i] / maxMeet) * 100}%` }} /></span>
                <span className="bar-row__value">{rhythm.meetingsByWeekday[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="stat__label" style={{ marginBottom: 'var(--gap-2)' }}>When the app is open</div>
          <div className="hour-strip" aria-label="App usage by hour">
            {usageHours(brain).map((n, h) => (
              <span key={h} className="hour-strip__cell" style={{ opacity: n ? 0.25 + (0.75 * n) / maxHour : 0.08 }} title={`${h}:00 · ${n}`} />
            ))}
          </div>
          <div className="row row--between muted" style={{ fontSize: 'var(--t-xs)' }}><span>12am</span><span>noon</span><span>11pm</span></div>
          <p className="muted" style={{ margin: 'var(--gap-2) 0 0', fontSize: 'var(--t-xs)' }}>
            {rhythm.activeHours.length ? `Mostly ${rhythm.activeHours.join(' and ')}.` : 'A few sessions in and this fills in.'}
            {habits.medianHorizonDays !== null ? ` You plan about ${Math.max(1, Math.round(habits.medianHorizonDays))} days ahead.` : ''}
          </p>
        </div>
      </div>
    </Card>
  )
}

const usageHours = (brain) => brain.rhythm.usageHours || []

function Files({ state, files, onToast }) {
  const [selected, setSelected] = useState('README.md')
  const [syncing, setSyncing] = useState(false)
  const file = files.find((f) => f.path === selected) || files[0]
  const sync = state.brain?.sync
  const supported = canSyncFolder()
  useEffect(() => { if (!files.some((f) => f.path === selected)) setSelected('README.md') }, [files, selected])

  const run = async (fn, done) => {
    setSyncing(true)
    try {
      const result = await fn()
      if (result?.ok === false) onToast?.('The folder needs permission again. Click Reconnect.', 'warning')
      else onToast?.(done(result), 'good')
    } catch (error) {
      if (error?.name !== 'AbortError') onToast?.(`Could not write the folder: ${error.message}`, 'critical')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <Card
      title="Files"
      subtitle={`${files.length} Markdown files. Your notes under each file are kept and re-attached every time it is regenerated.`}
      tools={
        <div className="row row--wrap">
          {supported && !sync?.folder && <button className="btn btn--sm btn--primary" disabled={syncing} onClick={() => run(() => connectBrainFolder(state), (r) => `Writing ${r.written} files to "${r.folder}" from now on.`)}>Connect a folder</button>}
          {supported && sync?.folder && <button className="btn btn--sm" disabled={syncing} onClick={() => run(() => syncBrainNow(state, { ask: true }), (r) => `${r.written} files written to "${r.folder}".`)}>{sync.lastSyncAt ? 'Sync now' : 'Reconnect'}</button>}
          {supported && sync?.folder && <button className="btn btn--sm btn--ghost" onClick={() => { disconnectBrainFolder(); onToast?.('Folder disconnected. The files on disk stay.') }}>Disconnect</button>}
          <button className="btn btn--sm" onClick={() => downloadBrainZip(state)}>Download .zip</button>
        </div>
      }
      flush
    >
      <div className="files">
        <div className="files__list">
          {files.map((f) => (
            <button key={f.path} type="button" className="files__item" aria-current={f.path === file?.path} onClick={() => setSelected(f.path)}>
              <span className="truncate mono">{f.path}</span>
              <span className="muted">{(f.text.length / 1024).toFixed(1)}k</span>
            </button>
          ))}
        </div>
        <div className="files__body">
          {sync?.folder ? (
            <div className="muted" style={{ fontSize: 'var(--t-xs)', marginBottom: 'var(--gap-2)' }}>
              Folder “{sync.folder}” · {sync.lastSyncAt ? `synced ${relative(sync.lastSyncAt)}` : 'not written yet'} · rewritten a few seconds after anything changes
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 'var(--t-xs)', marginBottom: 'var(--gap-2)' }}>
              {supported ? 'Connect a folder and these files are kept up to date on your disk, for you or for an agent.' : 'This browser cannot write folders; download the zip instead.'}
            </div>
          )}
          {file && (
            <>
              <div className="row" style={{ marginBottom: 'var(--gap-2)' }}>
                <span className="mono">{file.path}</span>
                <div className="spacer" />
                <button className="btn btn--sm btn--ghost" onClick={() => downloadBrainFile(file)}>Download this file</button>
              </div>
              <pre className="md-preview">{file.text}</pre>
              <div className="field" style={{ marginTop: 'var(--gap-3)' }}>
                <label className="field__label" htmlFor="brain-note">Your notes for this file</label>
                <textarea id="brain-note" className="textarea" rows={3} placeholder="Anything the rules cannot know. Appended under “## Notes”." value={state.brain?.notes?.[file.path] || ''} onChange={(e) => setBrainNote(file.path, e.target.value)} />
              </div>
            </>
          )}
        </div>
      </div>
    </Card>
  )
}
