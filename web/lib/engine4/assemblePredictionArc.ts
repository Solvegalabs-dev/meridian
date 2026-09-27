import { createServiceClient } from '@/lib/supabase/server'

export interface PredictionArc {
  prediction: {
    statement: string
    confidence_pct: number
    horizon_date: string
    created_at: string
    source: string
    filing_notes: string | null
  }
  confidence_trajectory: Array<{ score: number; created_at: string }>
  episodes: Array<{
    episode_number: number
    narrative: string
    top_signals: unknown
    confidence_start: number
    confidence_end: number
    top_action: string | null
  }>
  watch_alerts: Array<{
    alert_level: string
    signal_summary: string
    confidence: number
    created_at: string
    user_actioned_at: string | null
  }>
  outcome: {
    outcome_type: string
    outcome_note: string | null
    actual_completed_at: string | null
    swept_at_close: number | null
  } | null
  reflections: Array<{
    week_of: string
    confidence_flag: string | null
    reflection: string | null
    confidence_note: string | null
  }>
}

export async function assemblePredictionArc(predictionId: string): Promise<PredictionArc> {
  const supabase = createServiceClient()

  // Fetch prediction row
  const { data: pred, error: predErr } = await supabase
    .from('predictions')
    .select('statement, confidence_pct, horizon_date, created_at, source, notes, objective_id')
    .eq('id', predictionId)
    .single()

  if (predErr || !pred) throw new Error(`assemblePredictionArc: prediction ${predictionId} not found`)

  const objectiveId = pred.objective_id as string | null

  // Fetch all 5 remaining data layers in parallel
  const [
    trajectoryResult,
    episodesResult,
    alertsResult,
    outcomeResult,
    reflectionsResult,
  ] = await Promise.all([
    // confidence_trajectory — all scores ASC
    supabase
      .from('confidence_scores')
      .select('score, created_at')
      .eq('objective_id', objectiveId)
      .order('created_at', { ascending: true }),

    // episodes — last 10
    objectiveId
      ? supabase
          .from('objective_episodes')
          .select('episode_number, narrative, top_signals, confidence_start, confidence_end, top_action')
          .eq('objective_id', objectiveId)
          .order('episode_number', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),

    // watch_alerts — last 5
    objectiveId
      ? supabase
          .from('watch_alerts')
          .select('alert_level, signal_summary, confidence, created_at, user_actioned_at')
          .eq('objective_id', objectiveId)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),

    // objective_outcomes — most recent
    objectiveId
      ? supabase
          .from('objective_outcomes')
          .select('outcome_type, outcome_note, actual_completed_at, swept_at_close')
          .eq('objective_id', objectiveId)
          .order('recorded_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),

    // user_reflections — last 5 linked to this objective
    objectiveId
      ? supabase
          .from('user_reflections')
          .select('week_of, confidence_flag, reflection, confidence_note')
          .or(`found_signal_objective_id.eq.${objectiveId},unlogged_action_objective_id.eq.${objectiveId}`)
          .order('week_of', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
  ])

  const episodes = (episodesResult.data ?? []).map(ep => ({
    ...ep,
    narrative: (ep.narrative as string ?? '').slice(0, 400),
  }))

  // Reverse episodes to chronological order for display
  episodes.reverse()

  const arc: PredictionArc = {
    prediction: {
      statement: pred.statement as string,
      confidence_pct: pred.confidence_pct as number,
      horizon_date: pred.horizon_date as string,
      created_at: pred.created_at as string,
      source: (pred.source as string | null) ?? 'unknown',
      filing_notes: (pred.notes as string | null) ?? null,
    },
    confidence_trajectory: (trajectoryResult.data ?? []).map(r => ({
      score: r.score as number,
      created_at: r.created_at as string,
    })),
    episodes,
    watch_alerts: (alertsResult.data ?? []).map(r => ({
      alert_level: r.alert_level as string,
      signal_summary: r.signal_summary as string,
      confidence: r.confidence as number,
      created_at: r.created_at as string,
      user_actioned_at: (r.user_actioned_at as string | null) ?? null,
    })),
    outcome: outcomeResult.data?.length
      ? {
          outcome_type: outcomeResult.data[0].outcome_type as string,
          outcome_note: (outcomeResult.data[0].outcome_note as string | null) ?? null,
          actual_completed_at: (outcomeResult.data[0].actual_completed_at as string | null) ?? null,
          swept_at_close: (outcomeResult.data[0].swept_at_close as number | null) ?? null,
        }
      : null,
    reflections: (reflectionsResult.data ?? []).map(r => ({
      week_of: r.week_of as string,
      confidence_flag: (r.confidence_flag as string | null) ?? null,
      reflection: (r.reflection as string | null) ?? null,
      confidence_note: (r.confidence_note as string | null) ?? null,
    })),
  }

  const tokenEstimate = Math.round(JSON.stringify(arc).length / 4)
  console.log(`[engine4:step11] assemblePredictionArc prediction=${predictionId} token_estimate=${tokenEstimate}`)

  return arc
}
