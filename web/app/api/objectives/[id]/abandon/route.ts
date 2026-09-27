import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    abandonment_reason: string
    abandonment_permanent: boolean
    abandonment_note?: string | null
    child_action?: 'archive_all' | 'leave_active' | null
    prediction_scores?: Array<{ prediction_id: string; outcome: string }>
  }

  if (!body.abandonment_reason || body.abandonment_permanent === undefined) {
    return NextResponse.json({ error: 'abandonment_reason and abandonment_permanent are required' }, { status: 400 })
  }

  // Fetch current objective state
  const { data: objective } = await supabase
    .from('objectives')
    .select('confidence, category, created_at')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!objective) return NextResponse.json({ error: 'Objective not found' }, { status: 404 })

  const currentConfidence = objective.confidence ?? null
  let outcomeId: string | null = null

  // 1. Write objective_outcomes row
  try {
    const { data: outcomeRow, error: outcomeErr } = await supabase
      .from('objective_outcomes')
      .insert({
        user_id: user.id,
        objective_id: params.id,
        outcome_type: 'ABANDONED',
        outcome_note: body.abandonment_note ?? null,
        abandonment_reason: body.abandonment_reason,
        abandonment_permanent: body.abandonment_permanent,
        abandonment_note: body.abandonment_note ?? null,
        actual_completed_at: new Date().toISOString(),
        swept_at_close: currentConfidence,
      })
      .select('id')
      .single()

    if (outcomeErr) throw outcomeErr
    outcomeId = outcomeRow?.id ?? null
  } catch (err) {
    console.error('[abandon] outcome insert failed:', err)
    return NextResponse.json({ error: 'Failed to write outcome' }, { status: 500 })
  }

  // 2. Update objectives status + closure_type
  try {
    await supabase
      .from('objectives')
      .update({ status: 'abandoned', closure_type: 'abandoned', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', user.id)
  } catch (err) {
    console.error('[abandon] objective status update failed:', err)
  }

  // 3. Handle child objectives
  if (body.child_action === 'archive_all') {
    try {
      await supabase
        .from('objectives')
        .update({ status: 'closed', closure_type: 'closed', updated_at: new Date().toISOString() })
        .eq('parent_objective_id', params.id)
        .eq('user_id', user.id)
        .eq('status', 'active')
    } catch (err) {
      console.error('[abandon] child archive failed:', err)
    }
  }

  // 4. Score active predictions via Engine 4 (non-blocking)
  try {
    const serviceClient = createServiceClient()
    const { data: activePredictions } = await serviceClient
      .from('predictions')
      .select('id, user_id')
      .eq('objective_id', params.id)
      .eq('status', 'active')

    if (activePredictions?.length && outcomeId) {
      let scoreOutcomeForPrediction: ((
        supabase: typeof serviceClient,
        predictionId: string,
        outcomeId: string,
        userId: string
      ) => Promise<void>) | null = null

      try {
        const mod = await import('@/lib/engine4/scoreOutcomeForPrediction')
        scoreOutcomeForPrediction = mod.scoreOutcomeForPrediction
      } catch {
        // Engine 4 not available — mark predictions directly
      }

      if (scoreOutcomeForPrediction && outcomeId) {
        await Promise.allSettled(
          activePredictions.map(pred =>
            scoreOutcomeForPrediction!(
              serviceClient,
              pred.id as string,
              outcomeId!,
              pred.user_id as string
            )
          )
        )
      } else {
        // Fallback: mark predictions as scored with abandoned outcome
        await Promise.allSettled(
          activePredictions.map(pred =>
            serviceClient
              .from('predictions')
              .update({ status: 'scored' })
              .eq('id', pred.id as string)
          )
        )
      }
    }
  } catch (err) {
    console.error('[abandon] prediction scoring failed:', err)
  }

  // 5. Write abandonment episode to objective_episodes
  try {
    const { data: latestEp } = await supabase
      .from('objective_episodes')
      .select('episode_number')
      .eq('objective_id', params.id)
      .order('episode_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextEpisodeNumber = (latestEp?.episode_number ?? 0) + 1
    const reasonLabel = body.abandonment_reason.replace(/_/g, ' ')
    const permanentLabel = body.abandonment_permanent ? 'permanent' : 'may return'

    await supabase.from('objective_episodes').insert({
      objective_id: params.id,
      user_id: user.id,
      episode_number: nextEpisodeNumber,
      narrative: `Goal abandoned. Reason: ${reasonLabel}. Permanent: ${permanentLabel}. Note: ${body.abandonment_note ?? 'none'}`,
      confidence_start: currentConfidence ?? 0,
      confidence_end: currentConfidence ?? 0,
      confidence_delta: 0,
      top_signals: null,
      top_action: null,
    })
  } catch (err) {
    console.error('[abandon] episode write failed:', err)
  }

  // 6. Cross-objective abandonment pattern check
  try {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    const { data: recentAbandons } = await supabase
      .from('objective_outcomes')
      .select('id, objectives!inner(category)')
      .eq('objectives.user_id', user.id)
      .eq('objectives.category', objective.category as string)
      .eq('outcome_type', 'ABANDONED')
      .gte('recorded_at', ninetyDaysAgo)

    if ((recentAbandons?.length ?? 0) >= 2) {
      const weekOf = new Date().toISOString().split('T')[0]
      await supabase.from('user_reflections').insert({
        user_id: user.id,
        week_of: weekOf,
        reflection: `Abandonment pattern detected in ${objective.category as string} — consider whether objectives in this area are being set at the right scope or timeline.`,
      })
    }
  } catch (err) {
    console.error('[abandon] pattern check failed:', err)
  }

  return NextResponse.json({ success: true, outcomeId })
}
