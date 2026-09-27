// app/api/enterprise/objectives/[id]/retire/route.ts
// FF-050: Retire an enterprise objective (objective achieved).
// Modeled on FF-040 /complete flow. Admin only.
// Sets lifecycle_state=retired, status=inactive, objective_state=paused.
// Optionally triggers a final sweep (default ON for focus objectives).

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: {
    institution_id: string
    lifecycle_reason: string
    lifecycle_notes?: string | null
    run_final_sweep?: boolean
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { institution_id: institutionId } = body
  if (!institutionId) {
    return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
  }

  const check = await requireEnterpriseAdmin(institutionId)
  if (!check.ok) return check.response

  if (!body.lifecycle_reason?.trim()) {
    return NextResponse.json({ error: 'lifecycle_reason is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Verify objective + ownership
  const { data: objective } = await supabase
    .from('enterprise_objectives')
    .select('id, institution_id, status, objective_state, lifecycle_state')
    .eq('id', params.id)
    .single()

  if (!objective) {
    return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
  }
  if ((objective.institution_id as string) !== institutionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if ((objective.status as string) !== 'active') {
    return NextResponse.json(
      { error: 'Objective is already inactive — cannot retire again' },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  let finalSweepStatus: 'skipped' | 'triggered' | 'failed' = 'skipped'

  // 1. Optional final sweep — default ON for focus objectives
  const isFocus = (objective.objective_state as string) === 'focus'
  const shouldSweep = body.run_final_sweep !== undefined
    ? body.run_final_sweep
    : isFocus // default: run final sweep only for focus objectives

  if (shouldSweep) {
    try {
      const sweepMod = await import('@/lib/enterprise/sweep-fork1')
      const sweepMod2 = await import('@/lib/enterprise/sweep-fork2')

      // Check vertical to pick the right fork
      const { data: inst } = await supabase
        .from('enterprise_institutions')
        .select('vertical_type')
        .eq('id', institutionId)
        .single()

      const isRE = (inst as { vertical_type?: string | null } | null)?.vertical_type === 'real_estate'

      let fork1Result: { metricsId: string }
      if (isRE) {
        const reMod1 = await import('@/lib/enterprise/sweep-fork1-re')
        fork1Result = await reMod1.runREPortfolioSweep(institutionId)
        const reMod2 = await import('@/lib/enterprise/sweep-fork2-re')
        await reMod2.runREObjectiveSweep(institutionId, params.id, fork1Result.metricsId)
      } else {
        fork1Result = await sweepMod.runPortfolioSweep(institutionId)
        await sweepMod2.runObjectiveSweep(institutionId, params.id, fork1Result.metricsId)
      }

      finalSweepStatus = 'triggered'
    } catch (err) {
      console.error('[FF-050/retire] final sweep failed (non-blocking):', err)
      finalSweepStatus = 'failed'
    }
  }

  // 2. Write lifecycle state — this is the point of no return
  const { error: updateErr } = await supabase
    .from('enterprise_objectives')
    .update({
      status: 'inactive',
      objective_state: 'paused',
      lifecycle_state: 'retired',
      lifecycle_changed_at: now,
      lifecycle_reason: body.lifecycle_reason.trim(),
      lifecycle_notes: body.lifecycle_notes?.trim() ?? null,
      updated_at: now,
    })
    .eq('id', params.id)

  if (updateErr) {
    console.error('[FF-050/retire] lifecycle update failed:', updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  console.log(`[FF-050] Objective ${params.id} retired. Final sweep: ${finalSweepStatus}`)

  return NextResponse.json({
    success: true,
    objectiveId: params.id,
    lifecycleState: 'retired',
    finalSweepStatus,
  })
}
