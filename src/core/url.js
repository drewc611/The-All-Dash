/*
 * Making a URL safe to put in an href.
 *
 * Shared, because three places render a URL somebody else supplied: a link
 * inside a saved article, a link column on a board, and a document's source
 * address. React does not sanitise href - it renders `javascript:` and
 * `data:` URLs verbatim and only warns in development - so this is the
 * boundary that has to hold, and it holds in one place rather than three.
 */

const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

// Everything a browser strips before it parses a URL: C0 controls, space and
// DEL. Without this, "java\tscript:alert(1)" is a working script URL, because
// the tab is removed after this code has decided the string looks harmless.
const STRIPPED = /[\u0000-\u0020\u007f]/g

/**
 * Returns the URL to use, or null when it is not one a link may carry.
 *
 * A relative URL resolves against `base` when there is one, which also makes
 * relative links inside a saved article work rather than 404.
 */
export function safeUrl(raw, base = '') {
  const cleaned = String(raw ?? '').replace(STRIPPED, '')
  if (!cleaned) return null
  try {
    const url = base ? new URL(cleaned, base) : new URL(cleaned)
    return SAFE_SCHEMES.has(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
