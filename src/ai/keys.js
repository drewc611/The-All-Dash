/**
 * API keys live outside the workspace on purpose.
 *
 * The store is exported, restored and pasted into bug reports; a key must
 * never travel with it. By default a key is kept in sessionStorage, so it is
 * gone when the tab closes. "Remember on this device" moves it to
 * localStorage under its own name, still never part of the workspace JSON.
 */

const name = (provider) => `all-dash:key:${provider}`

const storage = (kind) => {
  try {
    return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage
  } catch {
    return null
  }
}

export function getKey(provider) {
  for (const kind of ['session', 'local']) {
    try {
      const value = storage(kind)?.getItem(name(provider))
      if (value) return value
    } catch {
      // Storage can throw in private windows; a missing key is the same outcome.
    }
  }
  return ''
}

export function setKey(provider, value, { remember = false } = {}) {
  const trimmed = String(value || '').trim()
  for (const kind of ['session', 'local']) {
    try { storage(kind)?.removeItem(name(provider)) } catch { /* ignore */ }
  }
  if (!trimmed) return
  try { storage(remember ? 'local' : 'session')?.setItem(name(provider), trimmed) } catch { /* ignore */ }
}

export function isRemembered(provider) {
  try { return Boolean(storage('local')?.getItem(name(provider))) } catch { return false }
}

/**
 * Every key stored for a provider, as the names `getKey` takes.
 *
 * One person with three keys for the same vendor is what "load balancing"
 * means here: it spreads rate limits and nothing else. The plain provider id
 * is the first alias, so a workspace that predates this keeps working
 * untouched, and `provider#work` style names sit alongside it.
 */
export function listKeyAliases(provider) {
  const aliases = []
  if (getKey(provider)) aliases.push(provider)
  const prefix = `${name(provider)}#`
  for (const kind of ['session', 'local']) {
    const s = storage(kind)
    if (!s) continue
    try {
      for (let i = 0; i < s.length; i += 1) {
        const key = s.key(i)
        if (!key || !key.startsWith(prefix)) continue
        const alias = `${provider}#${key.slice(prefix.length)}`
        if (!aliases.includes(alias)) aliases.push(alias)
      }
    } catch { /* private windows throw on enumeration */ }
  }
  return aliases
}

/** The label a person gave a key, for the settings list. */
export const aliasLabel = (alias) => {
  const at = String(alias).indexOf('#')
  return at === -1 ? 'default' : String(alias).slice(at + 1)
}

export function clearKeys() {
  for (const kind of ['session', 'local']) {
    const s = storage(kind)
    if (!s) continue
    try {
      for (let i = s.length - 1; i >= 0; i--) {
        const k = s.key(i)
        if (k && k.startsWith('all-dash:key:')) s.removeItem(k)
      }
    } catch { /* ignore */ }
  }
}
