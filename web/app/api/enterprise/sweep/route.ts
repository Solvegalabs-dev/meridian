import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runPortfolioSweep } from '@/lib/enterprise/sweep-fork1'
import { runObjectiveSweep } from '@/lib/enterprise/sweep-fork2'
import { runREPortfolioSweep } from '@/lib/enterprise/sweep-fork1-re'
import { runREObjectiveSweep } from '@/lib/enterprise/sweep-fork2-re'
import type { ObjectiveSweepResult } from '@/lib/enterprise/sweep-fork2'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const startMs = Date.now()

  // Auth: service-role Bearer only
  const authHeader = request.headers.get('Authorization')
  if (!authHeader || authHeader !== `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { institution_id?: string; objective_ids?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { institution_id: institutionId, objective_ids: requestedObjectiveIds } = body
  if (!institutionId) {
    return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify institution exists and get industry (used to determine vertical fork)
  const { data: institution, error: instErr } = await supabase
    .from('enterprise_institutions')
    .select('id, industry')
    .eq('id', institutionId)
    .single()

  if (instErr || !institution) {
    return NextResponse.json({ error: `Institution not found: ${institutionId}` }, { status: 404 })
  }

  const isRE = (institution as { industry?: string | null }).industry === 'real_estate'

  // ── Fork 1: Portfolio sweep (vertical-aware) ──
  let fork1Result: { metricsId: string }
  try {
    fork1Result = isRE
      ? await runREPortfolioSweep(institutionId)
      : await runPortfolioSweep(institutionId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[FF-035-B] Fork 1 failed (${isRE ? 'RE' : 'AF'}):`, msg)
    await supabase.from('enterprise_sweeps').insert({
      institution_id: institutionId,
      trigger_type: 'manual',
      status: 'failed',
      fork: 'portfolio',
      sweep_type: 'portfolio',
      engine_version: isRE ? 're-sweep-v1' : 'ff-035b-v1',
      started_at: new Date(startMs).toISOString(),
      completed_at: new Date().toISOString(),
      error_message: msg,
    })
    return NextResponse.json({ error: `Portfolio sweep failed: ${msg}` }, { status: 500 })
  }

  // ── Fork 2: Objective sweeps ──
  // Load objectives in focus state (or the specifically requested ones)
  let objectivesQuery = supabase
    .from('enterprise_objectives')
    .select('id, obj_id, objective_state')
    .eq('institution_id', institutionId)
    .eq('status', 'active')

  if (requestedObjectiveIds && requestedObjectiveIds.length > 0) {
    objectivesQuery = objectivesQuery.in('id', requestedObjectiveIds)
  } else {
    objectivesQuery = objectivesQuery.eq('objective_state', 'focus')
  }

  const { data: objectivesData } = await objectivesQuery.order('objective_order')
  const objectives = objectivesData ?? []

  // Run all objective sweeps concurrently with Promise.allSettled
  const settled = await Promise.allSettled(
    objectives.map(obj =>
      isRE
        ? runREObjectiveSweep(institutionId, obj.id as string, fork1Result.metricsId)
        : runObjectiveSweep(institutionId, obj.id as string, fork1Result.metricsId)
    )
  )

  const fork2Results: ObjectiveSweepResult[] = []
  const failedObjectiveIds: string[] = []
  const engineVersion = isRE ? 're-sweep-v1' : 'ff-035b-v1'

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      fork2Results.push(result.value)
    } else {
      const obj = objectives[i]
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      console.error(`[FF-035-B] Fork 2 failed for ${obj.obj_id} (${obj.id}):`, msg)
      failedObjectiveIds.push(obj.id as string)

      await supabase.from('enterprise_sweeps').insert({
        institution_id: institutionId,
        objective_id: obj.id,
        trigger_type: 'manual',
        status: 'failed',
        fork: 'objective',
        sweep_type: obj.objective_state === 'monitoring_lite' ? 'lite' : 'full',
        engine_version: engineVersion,
        started_at: new Date(startMs).toISOString(),
        completed_at: new Date().toISOString(),
        error_message: msg,
      })
    }
  }

  return NextResponse.json({
    institution_id: institutionId,
    vertical: isRE ? 'real_estate' : 'auto_finance',
    fork1: fork1Result,
    fork2: fork2Results,
    total_duration_ms: Date.now() - startMs,
    objectives_swept: fork2Results.length,
    objectives_failed: failedObjectiveIds.length,
    failed_objective_ids: failedObjectiveIds,
  })
}
