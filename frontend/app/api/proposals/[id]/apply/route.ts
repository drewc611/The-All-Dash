import { NextResponse } from 'next/server'

import { ApiError, applyProposal } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * Browser → this route → backend, so the API key stays on the server.
 *
 * One proposal per request and no list endpoint that applies. There is no bulk
 * route on purpose: a review queue with an approve-everything button is a
 * queue nobody reads. The proxy already refuses a cross-site POST to /api.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await applyProposal(id))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'failed' }, { status })
  }
}
