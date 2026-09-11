/*
 * The one rule about where a key may travel.
 *
 * Its own module because two very different callers need it: the streaming
 * layer, which is thirty kilobytes of wire formats for a dozen providers, and
 * the platform client, which is a thin fetch wrapper the app loads on every
 * visit. Leaving this in providers.js meant the second one dragged in the
 * first, and every first paint downloaded three chat protocols to check that
 * a URL starts with https.
 */

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Refuse to put a key on the wire in clear text.
 *
 * Loopback is allowed: a key going to Ollama or LM Studio on this machine
 * never leaves it, and demanding a certificate for that would only push
 * people into turning the check off.
 *
 * This is about transport, not destination. It says the key cannot be read in
 * transit; it does not say the address is one you chose. That is the
 * catalogue's job - see endpointFor() - and the two together are what stop a
 * restored workspace pointing a key at somebody else's https server.
 */
export function assertKeyTransport(baseUrl, apiKey) {
  if (!apiKey) return
  let url
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`"${baseUrl}" is not a valid URL.`)
  }
  if (url.protocol === 'https:') return
  const host = url.hostname.toLowerCase()
  if (LOOPBACK.has(host) || host.endsWith('.localhost')) return
  throw new Error(`Refusing to send your API key to ${url.host} over plain HTTP. Use an https:// endpoint, or one on this machine (localhost).`)
}
