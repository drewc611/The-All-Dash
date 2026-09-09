import { getKey } from '../ai/keys.js'
import { assertKeyTransport } from '../ai/providers.js'
import { getState } from '../core/store.js'

/**
 * The browser app talking to its own platform tier (backend/), when one is
 * configured in Settings → Platform. The URL lives in the workspace; the key
 * lives with the assistant keys (session or device storage), never in an
 * export. Nothing here runs unless the person set both.
 */

export const PLATFORM_KEY = 'platform'

export function platformConfig(state = getState()) {
  const url = String(state?.settings?.platform?.url || '').trim().replace(/\/+$/, '')
  const key = getKey(PLATFORM_KEY)
  return { url, key, configured: Boolean(url && key) }
}

export class PlatformError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export async function platformCall(path, { method = 'GET', body, signal, state } = {}) {
  const { url, key, configured } = platformConfig(state)
  if (!configured) throw new PlatformError(0, 'Set the platform URL and API key in Settings → Platform first.')
  assertKeyTransport(url, key)
  let res
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-api-key': key },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new PlatformError(0, `Could not reach ${url}. Is the API running, and is ${typeof location !== 'undefined' ? location.origin : 'this origin'} in its ALLDASH_CORS_ORIGINS?`)
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : res.status === 401 ? 'The platform rejected the API key.' : `The platform answered ${res.status}.`
    throw new PlatformError(res.status, detail)
  }
  return data
}

export const webCapabilities = (opts) => platformCall('/web/capabilities', opts)
export const webScrape = (url, opts) => platformCall('/web/scrape', { method: 'POST', body: { url, formats: ['markdown'] }, ...opts })
export const webCrawl = (url, { limit = 10, maxDepth = 2 } = {}, opts) =>
  platformCall('/web/crawl', { method: 'POST', body: { url, limit, max_depth: maxDepth, formats: ['markdown'] }, ...opts })
