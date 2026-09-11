import { headers } from 'next/headers'

/**
 * Rendered per request (reading the headers makes it dynamic) so the page
 * carries the request's CSP nonce like every other page, instead of a
 * prerendered copy whose scripts the policy would block.
 */
export default async function NotFound() {
  await headers()
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-3 px-6">
      <h1 className="text-xl font-semibold tracking-tight">Not found</h1>
      <p className="text-ink-2">There is nothing at this address.</p>
    </main>
  )
}
