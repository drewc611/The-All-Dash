const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Short, sortable-enough id. Not a UUID on purpose - these end up in URLs. */
export function uid(prefix = 'e') {
  const bytes = new Uint8Array(8)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return `${prefix}_${Date.now().toString(36)}${out.slice(0, 5)}`
}

/** Stable id derived from content, so re-importing the same file does not duplicate. */
export function hashId(prefix, ...parts) {
  const str = parts.join(' ')
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0
    h2 = Math.imul(h2 + c, 2246822519) >>> 0
  }
  return `${prefix}_${h1.toString(36)}${h2.toString(36)}`
}
