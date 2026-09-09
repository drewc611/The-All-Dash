import { NextResponse } from 'next/server'

import { ApiError, toggleTask } from '@/lib/api'

export const dynamic = 'force-dynamic'

/** Browser → this route → backend, so the API key stays on the server. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    return NextResponse.json(await toggleTask(id))
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'failed' }, { status })
  }
}
