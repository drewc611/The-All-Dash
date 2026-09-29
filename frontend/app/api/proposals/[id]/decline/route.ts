import { NextResponse } from 'next/server'

import { ApiError, declineProposal } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Saying no is a decision too: the row stays, and the same question is not asked again. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await declineProposal(id))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'failed' }, { status })
  }
}
