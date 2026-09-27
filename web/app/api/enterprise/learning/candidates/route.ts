import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET — fetch pending cohort and field candidates for admin review
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const institution_id = searchParams.get('institution_id')
  if (!institution_id) {
    return NextResponse.json({ error: 'institution_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const [cohortCandidates, fieldCandidates] = await Promise.all([
    supabase
      .from('enterprise_cohort_candidates')
      .select('*')
      .eq('institution_id', institution_id)
      .eq('status', 'pending')
      .order('trigger_count', { ascending: false }),
    supabase
      .from('enterprise_field_candidates')
      .select('*')
      .eq('institution_id', institution_id)
      .in('status', ['pending', 'linked'])
      .order('occurrence_count', { ascending: false }),
  ])

  return NextResponse.json({
    cohort_candidates: cohortCandidates.data ?? [],
    field_candidates: fieldCandidates.data ?? [],
  })
}

// PATCH — approve or reject a candidate
// body: { type: 'cohort' | 'field', id: string, action: string, reviewed_by?: string }
// cohort actions: 'approved' | 'rejected'
// field actions: 'dismissed' | 'linked' | 'schema_added'
export async function PATCH(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { type, id, action, reviewed_by } = body as {
    type: 'cohort' | 'field'
    id: string
    action: string
    reviewed_by?: string
  }

  if (!type || !id || !action) {
    return NextResponse.json({ error: 'type, id, and action required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Approve a cohort candidate — promotes it to enterprise_cohort_definitions
  if (type === 'cohort' && action === 'approved') {
    const { data: candidate } = await supabase
      .from('enterprise_cohort_candidates')
      .select('*')
      .eq('id', id)
      .single()

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const { error: defError } = await supabase
      .from('enterprise_cohort_definitions')
      .insert({
        institution_id: candidate.institution_id,
        cohort_name: candidate.proposed_name,
        field_combination: candidate.field_combination,
        signal_types: [],
        propagation_strength: 'medium',
        approved_by: reviewed_by ?? 'admin',
      })

    if (defError) {
      return NextResponse.json({ error: defError.message }, { status: 500 })
    }

    await supabase
      .from('enterprise_cohort_candidates')
      .update({
        status: 'approved',
        reviewed_by: reviewed_by ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)

    return NextResponse.json({ success: true, promoted_to_definition: true })
  }

  // Reject a cohort candidate
  if (type === 'cohort') {
    const { error } = await supabase
      .from('enterprise_cohort_candidates')
      .update({
        status: action,
        reviewed_by: reviewed_by ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // Field candidate status update — no reviewed_by/reviewed_at columns on this table
  if (type === 'field') {
    const validFieldActions = ['dismissed', 'linked', 'schema_added']
    if (!validFieldActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid field action. Must be one of: ${validFieldActions.join(', ')}` },
        { status: 400 }
      )
    }

    const { error } = await supabase
      .from('enterprise_field_candidates')
      .update({ status: action, last_seen_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}
