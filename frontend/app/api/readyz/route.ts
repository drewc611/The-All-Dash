import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Readiness: the backend this pod is configured for answers its own /healthz. */
export async function GET() {
  const base = (process.env.BACKEND_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/healthz`, { cache: 'no-store', signal: AbortSignal.timeout(2000) })
    if (res.ok) return NextResponse.json({ status: 'ok', backend: true })
    return NextResponse.json({ status: 'degraded', backend: false }, { status: 503 })
  } catch {
    return NextResponse.json({ status: 'degraded', backend: false }, { status: 503 })
  }
}
