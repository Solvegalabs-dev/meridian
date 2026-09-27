import { createClient } from '@/lib/supabase/server'

export type OutcomeType = 'HIT' | 'PARTIAL' | 'MISS' | 'OPEN'

export interface ScoredPrediction {
  id: string
  statement: string
  filed_confidence: number
  horizon_date: string
  outcome_type: OutcomeType
  outcome_text: string | null
  accuracy_score: number | null
  scored_at: string | null
  objective_title: string | null
  objective_obj_id: string | null
}

export interface TrackRecordSummary {
  total_scored: number
  total_open: number
  hit_count: number
  partial_count: number
  miss_count: number
  hit_rate: number
  avg_filed_confidence: number
  accuracy_trend: 'improving' | 'declining' | 'stable' | 'insufficient_data'
}

function parseOutcomeType(outcome: string | null): OutcomeType {
  if (!outcome) return 'OPEN'
  const upper = outcome.trimStart().toUpperCase()
  if (upper.startsWith('HIT')) return 'HIT'
  if (upper.startsWith('PARTIAL')) return 'PARTIAL'
  if (upper.startsWith('MISS')) return 'MISS'
  return 'OPEN'
}

const EMPTY_SUMMARY: TrackRecordSummary = {
  total_scored: 0,
  total_open: 0,
  hit_count: 0,
  partial_count: 0,
  miss_count: 0,
  hit_rate: 0,
  avg_filed_confidence: 0,
  accuracy_trend: 'insufficient_data',
}

export async function getUserTrackRecord(userId: string): Promise<{
  summary: TrackRecordSummary
  predictions: ScoredPrediction[]
}> {
  const supabase = createClient()

  const { data, error } = await supabase
    .from('predictions')
    .select(`
      id,
      statement,
      confidence_pct,
      horizon_date,
      outcome,
      accuracy_score,
      scored_at,
      objectives ( title, obj_id )
    `)
    .eq('user_id', userId)
    .order('horizon_date', { ascending: false })

  if (error) {
    console.error('[TrackRecord] Query error:', error)
    return { summary: EMPTY_SUMMARY, predictions: [] }
  }

  const predictions: ScoredPrediction[] = (data ?? []).map((row) => {
    const obj = (row.objectives as unknown) as { title: string; obj_id: string } | null
    const rawOutcome = row.outcome as string | null
    return {
      id: row.id as string,
      statement: row.statement as string,
      filed_confidence: row.confidence_pct as number,
      horizon_date: row.horizon_date as string,
      outcome_type: parseOutcomeType(rawOutcome),
      outcome_text: rawOutcome,
      accuracy_score: row.accuracy_score as number | null,
      scored_at: row.scored_at as string | null,
      objective_title: obj?.title ?? null,
      objective_obj_id: obj?.obj_id ?? null,
    }
  })

  const scored = predictions.filter(p => p.outcome_type !== 'OPEN')
  const open = predictions.filter(p => p.outcome_type === 'OPEN')
  const hits = scored.filter(p => p.outcome_type === 'HIT')
  const partials = scored.filter(p => p.outcome_type === 'PARTIAL')
  const misses = scored.filter(p => p.outcome_type === 'MISS')

  const hitRate = scored.length > 0
    ? (hits.length + partials.length * 0.5) / scored.length
    : 0

  const avgConf = predictions.length > 0
    ? predictions.reduce((sum, p) => sum + p.filed_confidence, 0) / predictions.length
    : 0

  // Compare newer half vs older half of scored predictions (ordered newest-first)
  let accuracyTrend: TrackRecordSummary['accuracy_trend'] = 'insufficient_data'
  if (scored.length >= 4) {
    const half = Math.floor(scored.length / 2)
    const newer = scored.slice(0, half)
    const older = scored.slice(half)
    const olderRate = older.filter(p => p.outcome_type === 'HIT').length / older.length
    const newerRate = newer.filter(p => p.outcome_type === 'HIT').length / newer.length
    if (newerRate > olderRate + 0.1) accuracyTrend = 'improving'
    else if (newerRate < olderRate - 0.1) accuracyTrend = 'declining'
    else accuracyTrend = 'stable'
  }

  return {
    summary: {
      total_scored: scored.length,
      total_open: open.length,
      hit_count: hits.length,
      partial_count: partials.length,
      miss_count: misses.length,
      hit_rate: hitRate,
      avg_filed_confidence: avgConf,
      accuracy_trend: accuracyTrend,
    },
    predictions,
  }
}
