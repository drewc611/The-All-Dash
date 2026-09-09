import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Liveness for the pod: the Node process answers. Readiness is /api/readyz. */
export function GET() {
  return NextResponse.json({ status: 'ok' })
}
