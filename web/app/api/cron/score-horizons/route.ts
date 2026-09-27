import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreOutcomeForPrediction } from '@/lib/engine4/scoreOutcomeForPrediction'

export const dynamic = 'force-dynamic'

// Runs daily at 06:00 UTC via Vercel cron.
// Finds predictions whose horizon has passed and whose objective has a recorded
// outcome, then auto-scores each via Engine 4. Protected by X-Cron-Secret.
export async function GET(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret')
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  // Find predictions past horizon with status='active' (not yet scored)
  const { data: activePredictions, error: predErr } = await supabase
    .from('predictions')
    .select('id, user_id, objective_id, confidence_pct, horizon_date')
    .lte('horizon_date', new Date().toISOString())
    .eq('status', 'active')
    .not('objective_id', 'is', null)

  if (predErr) {
    console.error('[engine4:cron] Failed to query predictions:', predErr)
    return NextResponse.json({ error: predErr.message }, { status: 500 })
  }

  if (!activePredictions?.length) {
    return NextResponse.json({ scored: 0, message: 'No predictions ready' })
  }

  // Filter out predictions that already have a prediction_scores row
  // (handles re-runs and any race conditions)
  const { data: alreadyScored } = await supabase
    .from('prediction_scores')
    .select('prediction_id')
    .in('prediction_id', activePredictions.map(p => p.id))

  const scoredIds = new Set((alreadyScored ?? []).map(r => r.prediction_id as string))
  const toScore = activePredictions.filter(p => !scoredIds.has(p.id))

  if (!toScore.length) {
    return NextResponse.json({ scored: 0, message: 'No predictions ready' })
  }

  let scored = 0
  const errors: string[] = []

  for (const prediction of toScore) {
    try {
      // Find the most recent outcome for this objective
      const { data: outcomes } = await supabase
        .from('objective_outcomes')
        .select('id, outcome_type, recorded_at')
        .eq('objective_id', prediction.objective_id)
        .order('recorded_at', { ascending: false })
        .limit(1)

      if (!outcomes?.length) {
        // No outcome recorded yet — skip; cron will retry tomorrow
        console.log(`[engine4:cron] No outcome for prediction ${prediction.id} (objective ${prediction.objective_id}), skipping`)
        continue
      }

      await scoreOutcomeForPrediction(
        supabase,
        prediction.id,
        outcomes[0].id,
        prediction.user_id as string
      )
      scored++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[engine4:cron] Failed to score prediction ${prediction.id}:`, msg)
      errors.push(`${prediction.id}: ${msg}`)
    }
  }

  return NextResponse.json({
    scored,
    total: toScore.length,
    ...(errors.length ? { errors } : {}),
  })
}
