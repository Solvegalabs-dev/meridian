// app/api/enterprise/objectives/[id]/drop/route.ts
// FF-050: Drop an enterprise objective (objective abandoned/cancelled).
// Modeled on FF-040 /abandon flow. Admin only. No final sweep.
// Sets lifecycle_state=dropped, status=inactive, objective_state=paused.

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  let body: {
    institution_id: string
    lifecycle_reason: string
    lifecycle_notes?: string | null
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
    .select('id, institution_id, status')
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
      { error: 'Objective is already inactive' },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()

  const { error: updateErr } = await supabase
    .from('enterprise_objectives')
    .update({
      status: 'inactive',
      objective_state: 'paused',
      lifecycle_state: 'dropped',
      lifecycle_changed_at: now,
      lifecycle_reason: body.lifecycle_reason.trim(),
      lifecycle_notes: body.lifecycle_notes?.trim() ?? null,
      updated_at: now,
    })
    .eq('id', params.id)

  if (updateErr) {
    console.error('[FF-050/drop] lifecycle update failed:', updateErr)
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  console.log(`[FF-050] Objective ${params.id} dropped.`)

  return NextResponse.json({
    success: true,
    objectiveId: params.id,
    lifecycleState: 'dropped',
  })
}
