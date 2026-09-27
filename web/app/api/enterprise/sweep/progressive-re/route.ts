import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import {
  planProgressiveSweepRE,
  executeProgressiveSweepRE,
} from '@/lib/enterprise/progressive-sweep-re'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  // Auth: service-role Bearer only
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { institutionId?: string; dry_run?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { institutionId, dry_run = true } = body

  if (!institutionId) {
    return NextResponse.json({ error: 'institutionId is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify institution exists and is RE vertical — 422 for non-RE
  const { data: institution, error: instErr } = await supabase
    .from('enterprise_institutions')
    .select('id, industry')
    .eq('id', institutionId)
    .single()

  if (instErr || !institution) {
    return NextResponse.json({ error: `Institution not found: ${institutionId}` }, { status: 404 })
  }

  if ((institution as { industry?: string | null }).industry !== 'real_estate') {
    return NextResponse.json(
      { error: 'progressive-re is only available for real_estate institutions' },
      { status: 422 }
    )
  }

  const startMs = Date.now()

  if (dry_run) {
    const plan = await planProgressiveSweepRE(institutionId)
    return NextResponse.json({
      dry_run: true,
      institutionId,
      triggeredListings: plan.triggeredListings,
      triggeredBuyers: plan.triggeredBuyers,
      totalTriggered: plan.totalTriggered,
      objectivesToSweep: plan.objectivesToSweep,
      objectivesToSkip: plan.objectivesToSkip.map(o => ({ id: o.id, obj_id: o.obj_id, title: o.title })),
      plannedAt: plan.plannedAt,
      duration_ms: Date.now() - startMs,
    })
  }

  // Live execution
  try {
    const result = await executeProgressiveSweepRE(institutionId)
    return NextResponse.json({
      dry_run: false,
      institutionId,
      triggeredListings: result.plan.triggeredListings,
      triggeredBuyers: result.plan.triggeredBuyers,
      objectivesSweep: result.swept.length,
      objectivesSkipped: result.skipped,
      casesPropagated: result.propagated,
      errors: result.errors,
      swept: result.swept.map(s => ({
        objectiveId: s.objectiveId,
        objId: s.objId,
        confidenceScore: s.confidenceScore,
        alertTriggered: s.alertTriggered,
        casesAnalyzed: s.casesAnalyzed,
        durationMs: s.durationMs,
      })),
      duration_ms: result.durationMs,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[progressive-re] Execute failed:', msg)
    return NextResponse.json({ error: `Sweep execution failed: ${msg}` }, { status: 500 })
  }
}
