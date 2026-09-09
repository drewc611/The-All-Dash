import { NextResponse } from 'next/server'

import { ApiError, runDaily } from '@/lib/api'

export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    return NextResponse.json(await runDaily(), { status: 202 })
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    return NextResponse.json({ detail: error instanceof Error ? error.message : 'failed' }, { status })
  }
}
