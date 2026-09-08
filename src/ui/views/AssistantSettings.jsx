import { useEffect, useState } from 'react'
import { updateAssistantSettings } from '../../core/store.js'
import { PROVIDERS, resolve, listModels } from '../../ai/providers.js'
import { getKey, setKey, isRemembered } from '../../ai/keys.js'
import { testConnection, isConfigured } from '../../ai/assistant.js'
import { Card, Segmented } from '../components.jsx'
import { canListen, canSpeak } from '../voice.js'

/**
 * Where the assistant is pointed. Provider, endpoint, model, key, and the
 * two privacy dials: what leaves the machine (titles or bodies) and how
 * many items go with each question.
 */
export function AssistantSettings({ state, onToast }) {
  const settings = state.settings.assistant || {}
  const spec = PROVIDERS[settings.provider] || PROVIDERS.anthropic
  const target = resolve(settings)
  const [key, setKeyDraft] = useState(() => getKey(spec.id))
  const [remember, setRemember] = useState(() => isRemembered(spec.id))
  const [models, setModels] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setKeyDraft(getKey(spec.id))
    setRemember(isRemembered(spec.id))
    setModels([])
  }, [spec.id])

  const saveKey = (value = key, keep = remember) => {
    setKey(spec.id, value, { remember: keep })
    setKeyDraft(value)
  }

  const fetchModels = async () => {
    setBusy(true)
    const found = await listModels({ ...target, apiKey: getKey(spec.id) })
    setBusy(false)
    setModels(found)
    onToast?.(found.length ? `${found.length} models available.` : 'Could not list models. Type the name by hand.', found.length ? 'good' : 'critical')
  }

  const probe = async () => {
    setBusy(true)
    try {
      const reply = await testConnection(state)
      onToast?.(`${spec.label} answered: "${reply.slice(0, 60)}"`, 'good')
    } catch (error) {
      onToast?.(error.message, 'critical')
    } finally {
      setBusy(false)
    }
  }

  const choices = [...new Set([...(spec.models || []), ...models])]

  return (
    <Card title="Assistant" subtitle="Ask questions about your work and get changes proposed, never applied for you.">
      <div className="stack">
        <div className="field">
          <span className="field__label">Model provider</span>
          <Segmented
            label="Provider"
            value={spec.id}
            options={Object.values(PROVIDERS).map((p) => ({ value: p.id, label: p.label }))}
            onChange={(provider) => updateAssistantSettings({ provider, baseUrl: '', model: '' })}
          />
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>{spec.hint}</span>
        </div>

        <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label className="field__label" htmlFor="ai-base">Endpoint</label>
            <input id="ai-base" className="input mono" placeholder={spec.baseUrl} value={settings.baseUrl || ''} onChange={(e) => updateAssistantSettings({ baseUrl: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 180 }}>
            <label className="field__label" htmlFor="ai-model">Model</label>
            <input id="ai-model" className="input mono" list="ai-models" placeholder={spec.model || 'model name'} value={settings.model || ''} onChange={(e) => updateAssistantSettings({ model: e.target.value })} />
            <datalist id="ai-models">{choices.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <button className="btn" onClick={fetchModels} disabled={busy}>List models</button>
        </div>

        {spec.needsKey && (
          <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 2, minWidth: 220 }}>
              <label className="field__label" htmlFor="ai-key">API key</label>
              <input
                id="ai-key"
                className="input mono"
                type="password"
                autoComplete="off"
                placeholder={spec.keyHint}
                value={key}
                onChange={(e) => setKeyDraft(e.target.value)}
                onBlur={() => saveKey()}
              />
            </div>
            <label className="row" style={{ cursor: 'pointer', height: 32 }}>
              <input type="checkbox" checked={remember} onChange={(e) => { setRemember(e.target.checked); saveKey(key, e.target.checked) }} />
              <span>Remember on this device</span>
            </label>
            {key && <button className="btn btn--sm" onClick={() => saveKey('', false)}>Forget key</button>}
          </div>
        )}
        {spec.needsKey && (
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            The key is sent from this browser straight to {spec.label} and stored {remember ? 'on this device' : 'for this tab only'}. It is never part of a workspace export.
          </span>
        )}

        <div className="row row--wrap" style={{ alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label className="field__label" htmlFor="ai-privacy">What the model sees</label>
            <select id="ai-privacy" className="select" value={settings.privacy || 'full'} onChange={(e) => updateAssistantSettings({ privacy: e.target.value })}>
              <option value="full">Titles, dates, people, tags and a short excerpt of each body</option>
              <option value="titles">Titles, dates, people and tags only. No note or transcript text.</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <label className="field__label" htmlFor="ai-limit">Items per question</label>
            <input id="ai-limit" className="input" type="number" min={10} max={120} value={settings.contextLimit || 40} onChange={(e) => updateAssistantSettings({ contextLimit: Number(e.target.value) || 40 })} />
          </div>
        </div>

        {(canSpeak() || canListen()) && (
          <div className="row row--wrap">
            {canSpeak() && (
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={Boolean(settings.speak)} onChange={(e) => updateAssistantSettings({ speak: e.target.checked })} />
                <span>Read replies aloud</span>
              </label>
            )}
            {canListen() && (
              <label className="row" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={Boolean(settings.handsFree)} onChange={(e) => updateAssistantSettings({ handsFree: e.target.checked })} />
                <span>Hands-free: send when I stop talking, listen again after the reply</span>
              </label>
            )}
          </div>
        )}

        <div className="row">
          <button className="btn btn--primary" onClick={probe} disabled={busy || !isConfigured(settings)}>Test connection</button>
          <span className="muted" style={{ fontSize: 'var(--t-xs)' }}>
            {isConfigured(settings) ? `Ready: ${target.model} at ${target.baseUrl}` : spec.needsKey && !getKey(spec.id) ? 'Add a key to enable it.' : 'Pick a model to enable it.'}
          </span>
        </div>
      </div>
    </Card>
  )
}
