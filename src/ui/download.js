/**
 * Hand the browser a file to save.
 *
 * The object URL is revoked on a later tick, not immediately after click():
 * the navigation to a blob URL is asynchronous in some browsers and revoking
 * too early cancels the download.
 */
export function downloadText(text, filename, type = 'text/plain') {
  downloadBlob(new Blob([text], { type }), filename)
}

export function downloadBytes(bytes, filename, type = 'application/octet-stream') {
  downloadBlob(new Blob([bytes], { type }), filename)
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
