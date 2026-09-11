import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../../core/store.js'
import { PROVIDERS, provider as providerSpec, PRICED_AT, endpointFor, usesCustomEndpoint } from '../../ai/catalogue.js'
import { formatCost, summarise, windowStart, spentSince } from '../../ai/cost.js'
import { plan, suggestChain, describePlan, circuitOpen, DEFAULT_POLICY } from '../../ai/route.js'
import { setChain, setBudget, setCacheEnabled, clearLedger, routerPolicy } from '../../ai/router-store.js'
import { listKeyAliases, aliasLabel } from '../../ai/keys.js'
import { stats as cacheStats, clear as clearCache } from '../../ai/cache.js'
import { Card, Empty } from '../components.jsx'
import { IconPlus, IconTrash, IconUp, IconDown, IconRefresh, IconCheck } from '../icons.jsx'

/**
 * The router.
 *
 * Everything here is about making a decision visible before it costs
 * anything: what the chain will try, what each step would cost, why a step is
 * being skipped, and - afterwards - which provider actually produced usable
 * answers rather than merely responding.
 */
export function Router({ onToast }) {
  const router = useStore((s) => s.router) || { chain: [], budget: {}, calls: [], health: {} }
  const [cache, setCache] = useState(null)

  const keys = useMemo(() => {
    const found = {}
    for (const p of PROVIDERS) {
      const aliases = listKeyAliases(p.id)
      if (aliases.length || p.local) found[p.id] = aliases
    }
    return found
  }, [router.chain])

  useEffect(() => { cacheStats().then(setCache) }, [router.calls.length])

  const built = useMemo(
    () => plan({
      chain: router.chain,
      keys,
      health: router.health,
      request: { system: 'x'.repeat(6000), messages: [{ content: 'a typical question' }], maxTokens: 2000 },
    }),
    [router.chain, keys, router.health],
  )

  const since = windowStart(router.budget.period || 'day')
  const spent = spentSince(router.calls, since)
  const rows = useMemo(() => summarise(router.calls), [router.calls])
  const saved = router.calls.reduce((n, call) => n + (call.saved || 0), 0)

  const move = (index, delta) => {
    const next = [...router.chain]
    const to = index + delta
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    setChain(next)
  }

  return (
    <div className="stack">
      <Card
        title="The chain"
        subtitle="Tried in order. A step that fails — including one that answers badly — falls through to the next."
      >
        <div className="stack">
          {router.chain.length === 0 ? (
            <Empty
              title="No chain yet"
              hint="Without one the assistant uses the single provider from Settings, exactly as before. A chain adds fallbacks, a ceiling and the comparison below."
              action={
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => {
                    const suggested = suggestChain(keys)
                    if (!suggested.length) return onToast?.('Add an API key first, in Settings → Assistant.')
                    setChain(suggested)
                    onToast?.(`Built a chain of ${suggested.length}`)
                  }}
                >Build one from my keys</button>
              }
            />
          ) : (
            <ol className="chain">
              {router.chain.map((step, index) => {
                const skipped = built.skipped.find((s) => s.provider === step.provider && s.model === step.model)
                const attempt = built.attempts.find((a) => a.provider === step.provider && a.model === step.model)
                const rested = circuitOpen(router.health, step.provider, { ...DEFAULT_POLICY, now: Date.now() })
                return (
                  <li key={`${step.provider}-${step.model}-${index}`} className={`chain__step${skipped ? ' is-skipped' : ''}`}>
                    <span className="chain__rank">{index + 1}</span>
                    <span className="chain__what">
                      <strong>{providerSpec(step.provider)?.label || step.provider}</strong>
                      <span className="muted"> {step.model}</span>
                      <span className="chain__why">
                        {skipped
                          ? `Skipped: ${skipped.why}`
                          : `${formatCost(attempt?.estimate?.dollars)} for a typical question`}
                        {rested && !skipped ? ' · resting' : ''}
                      </span>
                      {/* The address the key actually goes to. Shown always,
                          because an endpoint nobody can see is one nobody can
                          notice has been changed. */}
                      <span className="chain__where">{hostOf(step) || 'no endpoint set'}</span>
                    </span>
                    <span className="chain__tools">
                      <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}><IconUp width={12} height={12} /></button>
                      <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Move down" disabled={index === router.chain.length - 1} onClick={() => move(index, 1)}><IconDown width={12} height={12} /></button>
                      <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Remove" onClick={() => setChain(router.chain.filter((_, i) => i !== index))}><IconTrash width={12} height={12} /></button>
                    </span>
                  </li>
                )
              })}
            </ol>
          )}

          <AddStep keys={keys} onAdd={(step) => setChain([...router.chain, step])} />

          {router.chain.length > 0 && (
            <p className="router__plan">
              {built.runnable
                ? <>Right now: {describePlan(built)} {built.worst !== null && built.attempts.length > 1 && <span className="muted">Worst case, if every step has to run: {formatCost(built.worst)}.</span>}</>
                : built.reason}
            </p>
          )}
        </div>
      </Card>

      <Card title="The ceiling" subtitle="Checked before the call, not after. Over it, the request is refused.">
        <div className="stack">
          <div className="router__budget">
            <label className="field">
              <span className="field__label">Limit</span>
              <div className="row">
                <span className="muted">$</span>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="0.5"
                  value={router.budget.limit || ''}
                  placeholder="0 for none"
                  onChange={(e) => setBudget({ limit: Number(e.target.value) || 0 })}
                />
              </div>
            </label>

            <label className="field">
              <span className="field__label">Per</span>
              <select className="select" value={router.budget.period} onChange={(e) => setBudget({ period: e.target.value })}>
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">Attempts</span>
              <select className="select" value={router.budget.maxAttempts} onChange={(e) => setBudget({ maxAttempts: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>

          {router.budget.limit > 0 && (
            <>
              <div className="meter__track">
                <span className="meter__mine" style={{ width: `${Math.min(100, (spent / router.budget.limit) * 100)}%` }} />
              </div>
              <span className="muted">
                {formatCost(spent)} of {formatCost(router.budget.limit)} this {router.budget.period}
              </span>
            </>
          )}

          <label className="toggle toggle--wide">
            <input type="checkbox" checked={!!router.budget.allowUnpriced} onChange={(e) => setBudget({ allowUnpriced: e.target.checked })} />
            <span className="stack" style={{ gap: '2px' }}>
              <strong>Allow models with no price</strong>
              <span className="muted">
                A model the catalogue does not price cannot be checked against a ceiling. Off, those calls
                are refused rather than waved through, which is the only way a ceiling means anything.
              </span>
            </span>
          </label>

          <label className="toggle toggle--wide">
            <input type="checkbox" checked={router.cache !== false} onChange={(e) => setCacheEnabled(e.target.checked)} />
            <span className="stack" style={{ gap: '2px' }}>
              <strong>Reuse answers</strong>
              <span className="muted">
                An identical question, on the same model, over unchanged workspace facts, returns the
                stored answer for nothing. Edit anything it was based on and the stored answer is
                discarded — so unlike a similarity cache, it cannot serve you last week's number.
                {cache?.count ? ` Holding ${cache.count} answer${cache.count === 1 ? '' : 's'} now.` : ''}
              </span>
            </span>
          </label>

          {cache?.count > 0 && (
            <div className="row">
              <button type="button" className="btn btn--sm" onClick={async () => { await clearCache(); setCache({ count: 0, bytes: 0 }); onToast?.('Cache emptied') }}>
                Empty the cache
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card
        title="What each provider actually costs you"
        subtitle="Not per call — per answer that worked. A cheap model that fails a third of the time is not cheap."
        tools={router.calls.length > 0 && (
          <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Clear the ledger" onClick={() => { clearLedger(); onToast?.('Ledger cleared') }}><IconRefresh width={12} height={12} /></button>
        )}
      >
        {!rows.length ? (
          <Empty title="Nothing recorded yet" hint="Ask the assistant something and every attempt lands here: what it cost, how long it took, and whether the answer held up." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Calls</th>
                  <th className="num">Good</th>
                  <th className="num">Median ms</th>
                  <th className="num">Spent</th>
                  <th className="num">Per good answer</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <strong>{providerSpec(row.provider)?.label || row.provider}</strong>
                      <span className="muted"> {row.model}</span>
                    </td>
                    <td className="num tabular">{row.calls}</td>
                    <td className="num tabular">
                      <span className={row.goodRate < 0.8 ? 'router__bad' : ''}>{Math.round(row.goodRate * 100)}%</span>
                    </td>
                    <td className="num tabular">{row.averageMs || '—'}</td>
                    <td className="num tabular">{formatCost(row.dollars)}</td>
                    <td className="num tabular"><strong>{formatCost(row.perGoodAnswer)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {saved > 0 && (
          <p className="secondary" style={{ margin: 'var(--gap-3) 0 0' }}>
            Reused answers have saved {formatCost(saved)} so far.
          </p>
        )}

        <p className="secondary" style={{ margin: 'var(--gap-3) 0 0', fontSize: 'var(--t-xs)' }}>
          Prices are from the catalogue, taken on {PRICED_AT}, and vendors change them. Tokens are
          estimated rather than counted, because no tokeniser ships in this app — both numbers are
          close enough to compare providers and not close enough to reconcile an invoice.
        </p>
      </Card>
    </div>
  )
}

/** Where a step will send the request, as a person reads a host. */
function hostOf(step) {
  const url = endpointFor(step.provider, step.baseUrl)
  if (!url) return ''
  try { return new URL(url).host } catch { return url }
}

function AddStep({ keys, onAdd }) {
  const usable = PROVIDERS.filter((p) => (keys[p.id] || []).length > 0 || p.local)
  const [providerId, setProviderId] = useState(usable[0]?.id || 'anthropic')
  const [modelId, setModelId] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const spec = providerSpec(providerId)

  useEffect(() => {
    setModelId(providerSpec(providerId)?.models?.[0]?.id || '')
    setBaseUrl('')
  }, [providerId])

  if (!usable.length) {
    return <p className="secondary" style={{ margin: 0 }}>Add an API key in Settings → Assistant, then a chain can be built here.</p>
  }

  return (
    <div className="router__add">
      <label className="field">
        <span className="field__label">Provider</span>
        <select className="select" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{(keys[p.id] || []).length > 1 ? ` (${keys[p.id].length} keys)` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Model</span>
        {spec?.models?.length ? (
          <select className="select" value={modelId} onChange={(e) => setModelId(e.target.value)}>
            {spec.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        ) : (
          <input className="input" value={modelId} placeholder="model name" onChange={(e) => setModelId(e.target.value)} />
        )}
      </label>

      {usesCustomEndpoint(providerId) && (
        <label className="field">
          <span className="field__label">Endpoint</span>
          <input
            className="input"
            type="url"
            value={baseUrl}
            placeholder={providerSpec(providerId)?.baseUrl || 'https://…'}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
      )}

      <button type="button" className="btn" disabled={!modelId} onClick={() => onAdd({ provider: providerId, model: modelId, baseUrl: usesCustomEndpoint(providerId) ? baseUrl.trim() : '' })}>
        <IconPlus width={12} height={12} /> Add to the chain
      </button>

      {(keys[providerId] || []).length > 1 && (
        <span className="muted">
          Requests spread across {keys[providerId].map(aliasLabel).join(', ')}.
        </span>
      )}
    </div>
  )
}
