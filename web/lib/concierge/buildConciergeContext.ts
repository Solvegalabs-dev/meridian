import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConciergeContext {
  objectives: {
    id: string; title: string; confidence: number; status: string
    notes: string | null; created_at: string; target_date: string | null
  }[]
  recent_actions: {
    id: string; objective_id: string; description: string
    action_date: string; created_at: string
  }[]
  predictions: {
    id: string; statement: string; confidence_pct: number | null
    horizon_date: string | null; accuracy_score: number | null; notes: string | null
  }[]
  latest_inference: object | null
  fac_signals: object[] | null
  watch_sources: { url: string; label: string | null; last_checked: string | null }[]
}

export async function buildConciergeContext(
  supabase: SupabaseClient,
  userId: string
): Promise<ConciergeContext> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: objectives },
    { data: recentActions },
    { data: predictions },
    { data: latestSweep },
    { data: watchSources },
  ] = await Promise.all([
    supabase
      .from('objectives')
      .select('id, title, confidence, status, notes, created_at, target_date')
      .eq('user_id', userId)
      .in('status', ['active', 'paused']),
    supabase
      .from('objective_actions')
      .select('id, objective_id, description, action_date, created_at')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('predictions')
      .select('id, statement, confidence_pct, horizon_date, accuracy_score, notes')
      .eq('user_id', userId)
      .eq('status', 'active'),
    supabase
      .from('sweeps')
      .select('inference_block')
      .eq('user_id', userId)
      .eq('status', 'complete')
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
    supabase
      .from('watch_sources')
      .select('url, label, last_checked')
      .eq('user_id', userId)
      .eq('is_active', true),
  ])

  // fac_reports has no user_id column — it's linked via objective_id, so scope
  // by this user's own objective ids instead.
  const objectiveIds = (objectives ?? []).map((o: { id: string }) => o.id)
  let facSignals: object[] | null = null
  if (latestSweep && objectiveIds.length > 0) {
    try {
      const { data: fac, error: facError } = await supabase
        .from('fac_reports')
        .select('signal_category, signal_summary, forward_signal_type, confidence_implication, source_url')
        .in('objective_id', objectiveIds)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (facError) console.error('[concierge-context] fac_reports query failed:', facError)
      if (fac) facSignals = [fac]
    } catch (error) {
      console.error('[concierge-context] fac_reports query threw:', error)
    }
  }

  return {
    objectives: (objectives ?? []) as ConciergeContext['objectives'],
    recent_actions: (recentActions ?? []) as ConciergeContext['recent_actions'],
    predictions: (predictions ?? []) as ConciergeContext['predictions'],
    latest_inference: (latestSweep?.inference_block as object | null) ?? null,
    fac_signals: facSignals,
    watch_sources: (watchSources ?? []) as ConciergeContext['watch_sources'],
  }
}
