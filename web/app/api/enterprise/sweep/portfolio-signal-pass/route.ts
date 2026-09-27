import { type NextRequest, NextResponse } from 'next/server'
import { runPortfolioSignalPass } from '@/lib/enterprise/portfolio-signal-pass'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  // Auth: service-role Bearer only
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { institutionId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { institutionId } = body

  if (!institutionId) {
    return NextResponse.json({ error: 'institutionId is required' }, { status: 400 })
  }

  try {
    const result = await runPortfolioSignalPass(institutionId)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[portfolio-signal-pass] Failed:', msg)
    return NextResponse.json({ error: `Signal pass failed: ${msg}` }, { status: 500 })
  }
}
