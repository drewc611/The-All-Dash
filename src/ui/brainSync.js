import { useEffect, useRef } from 'react'
import { buildBrain } from '../brain/learn.js'
import { renderBrain, signature } from '../brain/markdown.js'
import { zipFiles } from '../brain/bundle.js'
import { canSyncFolder, connectFolder, disconnectFolder, folderHandle, writeFiles } from '../brain/sync.js'
import { setBrainSync } from '../core/store.js'
import { dayKey } from '../core/time.js'
import { downloadBytes, downloadText } from './download.js'

/**
 * The brain's files on disk. A connected folder is rewritten a few seconds
 * after anything learned changes; without one, the zip is a click away.
 */

export { canSyncFolder }

export const brainFiles = (state) => renderBrain(buildBrain(state), state.brain || {})

export async function syncBrainNow(state, { ask = false } = {}) {
  const handle = await folderHandle({ ask })
  if (!handle) return { ok: false, reason: 'no-folder' }
  const files = brainFiles(state)
  const written = await writeFiles(handle, files)
  setBrainSync({ folder: handle.name, lastSyncAt: new Date().toISOString(), signature: signature(files) })
  return { ok: true, written, folder: handle.name }
}

export async function connectBrainFolder(state) {
  const folder = await connectFolder()
  setBrainSync({ folder, lastSyncAt: null, signature: '' })
  return syncBrainNow({ ...state, brain: { ...(state.brain || {}), sync: { folder } } }, { ask: true })
}

export async function disconnectBrainFolder() {
  await disconnectFolder()
  setBrainSync(null)
}

export function downloadBrainZip(state) {
  const bytes = zipFiles(brainFiles(state), { prefix: 'all-dash-brain/' })
  downloadBytes(bytes, `all-dash-brain-${dayKey(new Date())}.zip`, 'application/zip')
}

export function downloadBrainFile(file) {
  downloadText(file.text, file.path.split('/').pop(), 'text/markdown')
}

/** Background sync: debounced, silent, and only when a folder is connected. */
export function useBrainSync(state) {
  const last = useRef(state.brain?.sync?.signature || '')
  useEffect(() => {
    if (!state.brain?.sync?.folder || !canSyncFolder()) return undefined
    const files = brainFiles(state)
    const sig = signature(files)
    if (sig === last.current) return undefined
    const timer = setTimeout(async () => {
      try {
        const result = await syncBrainNow(state)
        if (result.ok) last.current = sig
      } catch {
        // Permission lapsed or the folder went away; the Brain view shows Reconnect.
      }
    }, 3000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.entities, state.docs, state.brain, state.workspace])
}
