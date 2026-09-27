// app/api/enterprise/objectives/[id]/reactivate/route.ts
// FF-050: Reactivate a retired or dropped enterprise objective.
// Sets lifecycle_state=active, status=active, objective_state=monitoring_lite.
// Admin only.

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: { institution_id: string }

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

  // Verify objective + ownership
  const { data: objective } = await supabase
    .from('enterprise_objectives')
    .select('id, institution_id, status, lifecycle_state, objective_order')
    .eq('id', params.id)
    .single()

  if (!objective) {
    return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
  }
  if ((objective.institution_id as string) !== institutionId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if ((objective.status as string) === 'active') {
    return NextResponse.json(
      { error: 'Objective is already active' },
      { status: 409 }
    )
  }

  // Find the highest current objective_order so the reactivated obj goes to the end
  const { data: topRow } = await supabase
    .from('enterprise_objectives')
    .select('objective_order')
    .eq('institution_id', institutionId)
    .eq('status', 'active')
    .order('objective_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextOrder = ((topRow?.objective_order as number | null) ?? 0) + 1
  const now = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from('enterprise_objectives')
    .update({
      status: 'active',
      objective_state: 'monitoring_lite',
      lifecycle_state: 'active',
      lifecycle_changed_at: now,
      // Preserve reason/notes as historical record — do not clear them
      objective_order: nextOrder,
      updated_at: now,
    })
    .eq('id', params.id)

  if (updateErr) {
    console.error('[FF-050/reactivate] lifecycle update failed:', updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  console.log(`[FF-050] Objective ${params.id} reactivated at order ${nextOrder}.`)

  return NextResponse.json({
    success: true,
    objectiveId: params.id,
    lifecycleState: 'active',
    objectiveState: 'monitoring_lite',
    objectiveOrder: nextOrder,
  })
}
