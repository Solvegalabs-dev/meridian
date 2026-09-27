import { SupabaseClient } from '@supabase/supabase-js'

// Applied in sweep synthesis whenever a signal value is estimated, not observed.
// See Intelligence Integrity Standard: estimated values are never presented as confirmed.
export const ESTIMATED_CONFIDENCE_PENALTY = -4

interface SignalRow {
  observed_value: number | string
}

// Simple linear regression slope over N points, x = 0..N-1
function linearSlope(values: number[]): number {
  const n = values.length
  if (n < 2) return 0
  const sumX = (n * (n - 1)) / 2
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6
  const sumY = values.reduce((a, b) => a + b, 0)
  const sumXY = values.reduce((acc, v, i) => acc + i * v, 0)
  const denom = n * sumX2 - sumX * sumX
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom
}

async function getRecentObserved(
  supabase: SupabaseClient,
  agentKey: string,
  limit = 5
): Promise<number[]> {
  const { data } = await supabase
    .from('agent_signal_history')
    .select('observed_value')
    .eq('agent_key', agentKey)
    .eq('source', 'observed')
    .order('recorded_at', { ascending: false })
    .limit(limit)
  if (!data || data.length === 0) return []
  // Reverse to chronological order for slope computation
  return (data as SignalRow[]).reverse().map(r => Number(r.observed_value))
}

export async function recordObservedSignal(
  supabase: SupabaseClient,
  agentKey: string,
  objectiveId: string | undefined,
  value: number
): Promise<void> {
  await supabase.from('agent_signal_history').insert({
    agent_key: agentKey,
    objective_id: objectiveId ?? null,
    observed_value: value,
    source: 'observed',
  })
}

// Projects forward from recent observed values using linear slope.
// Returns the projected value, or null if fewer than 2 prior observed points.
export async function recordEstimatedSignal(
  supabase: SupabaseClient,
  agentKey: string,
  objectiveId: string | undefined
): Promise<number | null> {
  const values = await getRecentObserved(supabase, agentKey, 5)
  if (values.length < 2) return null

  const slope = linearSlope(values)
  const projected = values[values.length - 1] + slope

  await supabase.from('agent_signal_history').insert({
    agent_key: agentKey,
    objective_id: objectiveId ?? null,
    observed_value: projected,
    source: 'estimated',
  })

  console.log(`[signalHistory] ${agentKey}: estimated ${projected.toFixed(3)} (slope ${slope.toFixed(4)}, n=${values.length})`)
  return projected
}

// Returns the percentage deviation of the most recent observed value from what
// linear regression over prior points predicted. Returns null if < 3 points.
async function computeSlopeDeviation(
  supabase: SupabaseClient,
  agentKey: string
): Promise<number | null> {
  const values = await getRecentObserved(supabase, agentKey, 5)
  if (values.length < 3) return null

  const basis = values.slice(0, -1)
  const actual = values[values.length - 1]
  const slope = linearSlope(basis)
  const projected = basis[basis.length - 1] + slope

  if (projected === 0) return null
  return (Math.abs(actual - projected) / Math.abs(projected)) * 100
}

// Checks if 2+ agents for the same objective show simultaneous slope deviation > 20%.
// Writes a row to agent_correlation_flags when triggered — Strike Brief queries this.
export async function checkCrossAgentCorrelation(
  supabase: SupabaseClient,
  objectiveId: string
): Promise<void> {
  const since = new Date(Date.now() - 24 * 3600000).toISOString()
  const { data: recent } = await supabase
    .from('agent_signal_history')
    .select('agent_key')
    .eq('objective_id', objectiveId)
    .eq('source', 'observed')
    .gte('recorded_at', since)

  if (!recent || recent.length === 0) return

  const agentKeys = Array.from(new Set((recent as { agent_key: string }[]).map(r => r.agent_key)))

  const deviating: Array<{ agentKey: string; deviationPct: number }> = []

  for (const agentKey of agentKeys) {
    const dev = await computeSlopeDeviation(supabase, agentKey)
    if (dev !== null && dev > 20) {
      deviating.push({ agentKey, deviationPct: Math.round(dev * 10) / 10 })
    }
  }

  if (deviating.length < 2) return

  console.log(
    `[signalHistory] Cross-agent correlation for objective ${objectiveId}: ` +
    deviating.map(d => `${d.agentKey}=${d.deviationPct}%`).join(', ')
  )

  await supabase.from('agent_correlation_flags').insert({
    objective_id: objectiveId,
    agent_keys: deviating.map(d => d.agentKey),
    slope_deviations: Object.fromEntries(deviating.map(d => [d.agentKey, d.deviationPct])),
  })
}

// Convenience: record an observed signal and check cross-agent correlation.
// Use in agentRunner for hit/miss results that have a numeric observedValue.
export async function recordAndCheckSignal(
  supabase: SupabaseClient,
  agentKey: string,
  objectiveId: string | undefined,
  value: number
): Promise<void> {
  await recordObservedSignal(supabase, agentKey, objectiveId, value)
  if (objectiveId) {
    await checkCrossAgentCorrelation(supabase, objectiveId)
  }
}
