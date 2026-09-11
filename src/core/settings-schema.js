/*
 * What a settings block may say when it arrives in a file.
 *
 * Most of settings is preference - a theme, a density, which day a week
 * starts on - and a restored file is welcome to carry all of it. Three fields
 * are not preference:
 *
 *   settings.platform.url      where the platform API key is sent
 *   settings.assistant.baseUrl where the model API key is sent
 *   settings.media.*           consent to talk to Google, and to download 32MB
 *
 * The first two decide the destination of a secret, and the transport check
 * in ai/transport.js cannot help: it asks whether the URL is https, not whose
 * server it is. https://evil.example passes it exactly as an honest address
 * does. The third is consent, and consent does not travel in a file somebody
 * else wrote.
 *
 * So a restored file does not get to set them. Somebody who restores their
 * own backup re-types one URL and re-ticks two boxes; the alternative was
 * that opening a workspace file somebody sent you handed them your keys, the
 * address of every page you save, and - because the assistant sends the
 * grounding context with the request - the contents of your workspace.
 *
 * `trusted: true` is the path from localStorage on load, which is this
 * origin's own earlier state and can say what it likes.
 */

/** Settings fields a file may not decide, and what they fall back to. */
const NOT_FROM_A_FILE = {
  platformUrl: '',
  assistantBaseUrl: '',
  media: { youtube: false, ffmpeg: false },
}

/**
 * @param {object} incoming the settings block out of the file
 * @param {object} base the defaults to fall back to
 * @param {{trusted?: boolean}} options
 * @returns {{settings: object, dropped: string[]}} dropped names what was
 *          refused, so the UI can say so rather than silently breaking a
 *          restore the person expected to just work.
 */
export function normaliseSettings(incoming, base, { trusted = true } = {}) {
  const from = incoming && typeof incoming === 'object' ? incoming : {}
  const settings = {
    ...base,
    ...from,
    platform: { ...(base.platform || {}), ...(from.platform || {}) },
    assistant: { ...(base.assistant || {}), ...(from.assistant || {}) },
    media: { ...(base.media || {}), ...(from.media || {}) },
  }
  if (trusted) return { settings, dropped: [] }

  const dropped = []
  if (String(from.platform?.url || '').trim()) {
    settings.platform = { ...settings.platform, url: NOT_FROM_A_FILE.platformUrl }
    dropped.push('the platform URL')
  }
  if (String(from.assistant?.baseUrl || '').trim()) {
    settings.assistant = { ...settings.assistant, baseUrl: NOT_FROM_A_FILE.assistantBaseUrl }
    dropped.push('the assistant endpoint')
  }
  if (from.media?.youtube || from.media?.ffmpeg) {
    settings.media = { ...settings.media, ...NOT_FROM_A_FILE.media }
    dropped.push('the media permissions')
  }
  return { settings, dropped }
}
