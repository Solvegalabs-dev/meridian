// app/api/enterprise/objectives/[id]/route.ts
// FF-050: Edit (PATCH) a single enterprise objective. Admin only.

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'

// ── PATCH /api/enterprise/objectives/[id] ────────────────────────────────────
// Inline-edit: title, statement, case_scope, objective_state, lite_sweep_cadence_days,
// alert_threshold. Skips fields absent from the body (partial update).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: {
    institution_id: string
    title?: string
    statement?: string
    objective_state?: 'focus' | 'monitoring_lite'
    case_scope?: string | null
    lite_sweep_cadence_days?: number | null
    alert_threshold?: Record<string, unknown> | null
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

  const supabase = createServiceClient()

  // Verify objective belongs to this institution
  const { data: existing } = await supabase
    .from('enterprise_objectives')
    .select('id, institution_id, status')
    .eq('id', params.id)
    .single()

  if (!existing) {
    return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
  }
  if ((existing.institution_id as string) !== institutionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if ((existing.status as string) !== 'active') {
    return NextResponse.json(
      { error: 'Cannot edit a retired or dropped objective — reactivate it first' },
      { status: 409 }
    )
  }

  // Build partial update: only include keys the caller sent
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.statement !== undefined) updates.statement = body.statement.trim()
  if (body.objective_state !== undefined) updates.objective_state = body.objective_state
  if (body.case_scope !== undefined) updates.case_scope = body.case_scope
  if (body.lite_sweep_cadence_days !== undefined) updates.lite_sweep_cadence_days = body.lite_sweep_cadence_days
  if (body.alert_threshold !== undefined) updates.alert_threshold = body.alert_threshold

  const { data: updated, error } = await supabase
    .from('enterprise_objectives')
    .update(updates)
    .eq('id', params.id)
    .select('id, obj_id, title, statement, objective_state, case_scope, objective_order')
    .single()

  if (error) {
    console.error('[FF-050] objective edit failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ objective: updated })
}
