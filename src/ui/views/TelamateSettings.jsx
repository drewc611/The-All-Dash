import { useState } from 'react'
import { updateTelamateSettings } from '../../core/store.js'
import { useFlag } from '../../core/useFlag.js'
import { getKey, setKey, isRemembered } from '../../ai/keys.js'
import { syncTelamate, TELAMATE_KEY, FLAG } from '../../integrations/telamate.js'
import { Card } from '../components.jsx'

/**
 * Where the Telamate front desk is and how often to ask it. The URL is
 * workspace state; the token is kept like the assistant keys (this tab, or
 * this device) and never leaves with an export. "Pull now" is the same pull
 * the timer runs, so a wrong URL shows up here rather than in the console.
 */
export function TelamateSettings({ state, onToast }) {
  const on = useFlag(FLAG)
  const settings = state.settings.telamate || {}
  const [token, setTokenState] = useState(() => getKey(TELAMATE_KEY))
  const [remember, setRemember] = useState(() => isRemembered(TELAMATE_KEY))
  const [pulling, setPulling] = useState(false)

  const saveToken = (value, keep = remember) => {
    setTokenState(value)
    setKey(TELAMATE_KEY, value, { remember: keep })
  }

  const pull = async () => {
    setPulling(true)
    try {
      const { entities } = await syncTelamate({ url: settings.url, token })
      onToast?.(`Pulled ${entities.length} records from Telamate.`, 'good')
    } catch (error) {
      onToast?.(error.message, 'critical')
    } finally {
      setPulling(false)
    }
  }

  return (
    <Card title="Telamate" subtitle="Optional. Pull the front desk's callbacks, conversations and counters into this workspace.">
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        {!on && (
          <p className="muted" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
            The Telamate flag is off in this build, so nothing is pulled and its widgets are hidden. The settings below are kept for when it is on.
          </p>
        )}
        <div className="field">
          <label className="field__label" htmlFor="telamate-url">Export URL</label>
          <input id="telamate-url" className="input" type="url" placeholder="https://desk.yourdomain.com/api/alldash/entities" value={settings.url || ''} onChange={(e) => updateTelamateSettings({ url: e.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="telamate-token">Admin token</label>
          <input id="telamate-token" className="input" type="password" autoComplete="off" placeholder="TELAMATE_ADMIN_TOKEN" value={token} onChange={(e) => saveToken(e.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="telamate-every">Pull every (minutes, 0 is off)</label>
          <input id="telamate-every" className="input" type="number" min={0} max={1440} style={{ width: 120 }} value={settings.everyMinutes ?? 5} onChange={(e) => updateTelamateSettings({ everyMinutes: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        <div className="row row--wrap">
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); saveToken(token, e.target.checked) }} />
            <span>Remember the token on this device</span>
          </label>
          <div className="spacer" />
          <button className="btn btn--sm" onClick={pull} disabled={pulling || !settings.url}>{pulling ? 'Pulling…' : 'Pull now'}</button>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
          The token goes from this browser to that URL only and is never part of a workspace export. Telamate must list this site in <code className="mono">TELAMATE_CORS_ORIGINS</code>.
        </p>
      </div>
    </Card>
  )
}
