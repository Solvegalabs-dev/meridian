import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreOutcomeForPrediction } from '@/lib/engine4/scoreOutcomeForPrediction'

export const dynamic = 'force-dynamic'

// Path A: user closes an objective with a recorded outcome.
// Writes objective_outcomes, updates objective status/closure_type,
// and triggers Engine 4 prediction scoring + closure synthesis.
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    outcome_type: string
    outcome_note?: string | null
    actual_completed_at: string
    confidence_retrospective?: 'realistic' | 'overconfident' | 'underconfident' | null
    prediction_scores?: Array<{ prediction_id: string; outcome: string }>
  }

  if (!body.outcome_type || !body.actual_completed_at) {
    return NextResponse.json({ error: 'outcome_type and actual_completed_at are required' }, { status: 400 })
  }

  // Fetch current objective to capture swept_at_close (confidence at moment of close)
  const { data: objective } = await supabase
    .from('objectives')
    .select('confidence, user_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!objective) return NextResponse.json({ error: 'Objective not found' }, { status: 404 })

  // 1. Write objective_outcomes row
  const { data: outcomeRow, error: outcomeErr } = await supabase
    .from('objective_outcomes')
    .insert({
      user_id: user.id,
      objective_id: params.id,
      outcome_type: body.outcome_type.toUpperCase(),
      outcome_note: body.outcome_note ?? null,
      actual_completed_at: body.actual_completed_at,
      swept_at_close: objective.confidence ?? null,
    })
    .select('id')
    .single()

  if (outcomeErr || !outcomeRow) {
    return NextResponse.json({ error: outcomeErr?.message ?? 'Failed to write outcome' }, { status: 500 })
  }

  // 2. Write confidence_retrospective to outcome row (non-blocking)
  if (body.confidence_retrospective) {
    await supabase
      .from('objective_outcomes')
      .update({ confidence_retrospective: body.confidence_retrospective })
      .eq('id', outcomeRow.id)
  }

  // 3. Update objectives: status + closure_type
  const { error: statusErr } = await supabase
    .from('objectives')
    .update({ status: 'closed', closure_type: 'closed', updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (statusErr) {
    return NextResponse.json(
      { error: 'Outcome recorded but status update failed', outcome_id: outcomeRow.id },
      { status: 500 }
    )
  }

  // 4. Engine 4 prediction scoring + closure synthesis (non-blocking)
  try {
    const serviceClient = createServiceClient()

    const { data: activePredictions } = await serviceClient
      .from('predictions')
      .select('id, user_id')
      .eq('objective_id', params.id)
      .eq('status', 'active')

    if (activePredictions?.length) {
      const results = await Promise.allSettled(
        activePredictions.map(pred =>
          scoreOutcomeForPrediction(
            serviceClient,
            pred.id as string,
            outcomeRow.id,
            pred.user_id as string
          )
        )
      )

      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map(r => String(r.reason))

      if (failures.length) {
        console.error(`[complete] ${failures.length} scoring failure(s) for objective ${params.id}:`, failures)
      }

      console.log(
        `[complete] objective=${params.id} outcome=${body.outcome_type}` +
        ` predictions_scored=${results.filter(r => r.status === 'fulfilled').length}` +
        ` predictions_failed=${failures.length}`
      )
    }
  } catch (err) {
    console.error(`[complete] Engine 4 scoring failed for objective ${params.id}:`, err)
  }

  return NextResponse.json({ outcome_id: outcomeRow.id })
}
