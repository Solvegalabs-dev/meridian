// GET /api/strike/coverage?taxonomy_key=...&state=...: do we have data for this species and state?
// Read-only. Session and invite list required. Answers the intake notice on /strike/new.
import { NextResponse } from 'next/server'
import { requireInvitedUser } from '@/lib/strike/ownerGuard'
import { loadSeasonIndex } from '@/lib/strike/coverageData'
import { checkCoverage, coverageNotice, COVERAGE_MODE } from '@/lib/strike/coverage'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const invited = await requireInvitedUser()
  if (invited instanceof NextResponse) return invited

  const { searchParams } = new URL(request.url)
  const taxonomyKey = searchParams.get('taxonomy_key') ?? ''
  const state = searchParams.get('state') ?? ''
  if (!taxonomyKey) return NextResponse.json({ error: 'taxonomy_key is required' }, { status: 400 })

  const coverage = checkCoverage({ taxonomyKey, state, seasonIndex: await loadSeasonIndex(invited.db) })
  return NextResponse.json({
    covered: coverage.covered,
    mode: COVERAGE_MODE,
    notice: coverage.covered === false ? coverageNotice(coverage, COVERAGE_MODE) : null,
  })
}
