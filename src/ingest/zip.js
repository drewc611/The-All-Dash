/**
 * A ~90 line ZIP reader, so .xlsx works with no dependency at all.
 *
 * The browser already ships an inflater (DecompressionStream), it just is not
 * wired to anything. Reading the central directory and handing the deflate
 * stream over is the whole trick.
 */

const EOCD_SIG = 0x06054b50
const CDH_SIG = 0x02014b50
const LFH_SIG = 0x04034b50

const corrupt = (why) => new Error(`Corrupt zip: ${why}`)

export async function readZip(buffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const total = bytes.length
  // Every offset read from the file is checked against the file's real size
  // before it is used, so a truncated or hand-mangled archive fails with a
  // message rather than a RangeError from deep inside DataView.
  const within = (start, length) => start >= 0 && length >= 0 && start + length <= total

  const eocd = findEocd(view, total)
  if (eocd < 0) throw new Error('Not a zip archive')

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  if (!within(offset, 46)) throw corrupt('central directory is outside the file')
  const files = new Map()

  for (let i = 0; i < count; i++) {
    if (!within(offset, 46) || view.getUint32(offset, true) !== CDH_SIG) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    if (!within(offset + 46, nameLength)) throw corrupt('entry name runs past the end of the file')
    if (!within(localOffset, 30)) throw corrupt('entry header is outside the file')
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength))
    files.set(name, { method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }

  return {
    names: () => [...files.keys()],
    has: (name) => files.has(name),
    async text(name) {
      const entry = files.get(name)
      if (!entry) return null
      if (view.getUint32(entry.localOffset, true) !== LFH_SIG) throw corrupt(`bad header for ${name}`)
      const nameLength = view.getUint16(entry.localOffset + 26, true)
      const extraLength = view.getUint16(entry.localOffset + 28, true)
      const start = entry.localOffset + 30 + nameLength + extraLength
      if (!within(start, entry.compressedSize)) throw corrupt(`${name} runs past the end of the file`)
      const raw = bytes.subarray(start, start + entry.compressedSize)
      if (entry.method === 0) return new TextDecoder().decode(raw)
      if (entry.method !== 8) throw new Error(`Unsupported compression (${entry.method}) in ${name}`)
      return new TextDecoder().decode(await inflateRaw(raw))
    },
  }
}

function findEocd(view, length) {
  if (length < 22) return -1
  const min = Math.max(0, length - 66000)
  for (let i = length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  return -1
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot inflate zip entries (no DecompressionStream)')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
