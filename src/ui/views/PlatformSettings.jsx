import { useState } from 'react'
import { updateSettings } from '../../core/store.js'
import { getKey, setKey, isRemembered } from '../../ai/keys.js'
import { PLATFORM_KEY, webCapabilities } from '../../platform/client.js'
import { Card } from '../components.jsx'

/**
 * Where the platform tier is and how to talk to it. The URL is workspace
 * state; the key is kept like the assistant keys (this tab, or this device)
 * and never leaves with an export. "Test" asks /web/capabilities, which also
 * says what the deployment can do: search and rendering need Firecrawl,
 * extract and agent need a model.
 */
export function PlatformSettings({ state, onToast }) {
  const url = state.settings.platform?.url || ''
  const [key, setKeyState] = useState(() => getKey(PLATFORM_KEY))
  const [remember, setRemember] = useState(() => isRemembered(PLATFORM_KEY))
  const [caps, setCaps] = useState(null)
  const [testing, setTesting] = useState(false)

  const saveKey = (value, keep = remember) => {
    setKeyState(value)
    setKey(PLATFORM_KEY, value, { remember: keep })
  }

  const test = async () => {
    setTesting(true)
    setCaps(null)
    try {
      const result = await webCapabilities()
      setCaps(result)
      onToast?.('Connected to the platform.', 'good')
    } catch (error) {
      onToast?.(error.message, 'critical')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card title="Platform" subtitle="Optional. Connect the API to import web pages and crawl sites into this workspace.">
      <div className="stack" style={{ gap: 'var(--gap-3)' }}>
        <div className="field">
          <label className="field__label" htmlFor="platform-url">API URL</label>
          <input id="platform-url" className="input" type="url" placeholder="https://dash.yourdomain.com/api or http://localhost:8000" value={url} onChange={(e) => updateSettings({ platform: { ...(state.settings.platform || {}), url: e.target.value } })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="platform-key">Platform API key</label>
          <input id="platform-key" className="input" type="password" autoComplete="off" placeholder="X-API-Key" value={key} onChange={(e) => saveKey(e.target.value)} />
        </div>
        <div className="row row--wrap">
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); saveKey(key, e.target.checked) }} />
            <span>Remember the key on this device</span>
          </label>
          <div className="spacer" />
          <button className="btn btn--sm" onClick={test} disabled={testing || !url || !key}>{testing ? 'Testing…' : 'Test'}</button>
        </div>
        {caps && (
          <div className="row row--wrap" style={{ gap: 'var(--gap-1)' }} aria-label="Platform capabilities">
            {caps.native.map((c) => <span key={c} className="chip chip--good">{c}</span>)}
            <span className={`chip ${caps.search ? 'chip--good' : ''}`}>{caps.search ? 'search' : 'search: needs Firecrawl'}</span>
            <span className={`chip ${caps.render ? 'chip--good' : ''}`}>{caps.render ? 'render + screenshots' : 'render: needs Firecrawl'}</span>
            <span className={`chip ${caps.extract ? 'chip--good' : ''}`}>{caps.extract ? `extract + agent (${caps.model})` : 'extract, agent: needs a model'}</span>
          </div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
          The key goes from this browser to the API only, over HTTPS or to localhost, and is never part of a workspace export. The API must list this site in <code className="mono">ALLDASH_CORS_ORIGINS</code>.
        </p>
      </div>
    </Card>
  )
}
