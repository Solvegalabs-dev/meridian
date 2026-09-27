// FF-084 — Salmon Run Progression Engine
// CALCULATED:salmon_run_progression → computeSalmonRunProgression()
// Reads last 7 days of USACE passage counts from agent_signal_history,
// applies adult chinook travel rate (~20 miles/day), writes projected
// position to salmon_run_progression table, returns miles-from-McNary.
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';

export const SALMON_PROGRESSION_AGENT_KEYS = [
  'OUTDOOR_USACE_MCNARY',
  'OUTDOOR_SALMON_PROGRESSION',
] as const;

export type SalmonProgressionAgentKey = typeof SALMON_PROGRESSION_AGENT_KEYS[number];

// Adult chinook baseline travel rate (miles/day, river current speed assumed)
const CHINOOK_TRAVEL_RATE_MPD = 20;

// River distance (miles) from Bonneville Dam to McNary Dam
const BONNEVILLE_TO_MCNARY_MI = 146;

// Reads last N days of signal history for a given agent key
async function getRecentCounts(
  agentKey: string,
  days = 7
): Promise<Array<{ value: number; recordedAt: string }>> {
  const supabase = createServiceClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const { data } = await supabase
    .from('agent_signal_history')
    .select('observed_value, recorded_at')
    .eq('agent_key', agentKey)
    .eq('source', 'observed')
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false });

  if (!data || data.length === 0) return [];
  return (data as Array<{ observed_value: number | string; recorded_at: string }>).map(r => ({
    value: Number(r.observed_value),
    recordedAt: r.recorded_at,
  }));
}

// Projects leading-edge position from sequential ladder passage counts.
// Returns miles traveled from Bonneville (proxy for run position in river).
// Side-effect: writes a row to salmon_run_progression.
export async function computeSalmonRunProgression(): Promise<number | null> {
  const supabase = createServiceClient();

  const bonCounts = await getRecentCounts('OUTDOOR_USACE_BONNEVILLE', 7);
  const mcnCounts = await getRecentCounts('OUTDOOR_USACE_MCNARY', 7);

  if (bonCounts.length === 0 && mcnCounts.length === 0) return null;

  // Average daily count at Bonneville over observed window
  const avgBonCount = bonCounts.length > 0
    ? bonCounts.reduce((s, r) => s + r.value, 0) / bonCounts.length
    : 0;

  // Days since first significant Bonneville count (proxy for leading-edge travel time)
  const now = Date.now();
  const firstBonDate = bonCounts.length > 0
    ? new Date(bonCounts[bonCounts.length - 1].recordedAt).getTime()
    : now;
  const daysSinceLeadingEdge = Math.max(0, (now - firstBonDate) / 86400000);

  // Leading edge projected position from Bonneville (temperature adjustment placeholder: 1.0)
  const tempAdjustment = 1.0;
  const projectedMilesFromBonneville = Math.round(
    daysSinceLeadingEdge * CHINOOK_TRAVEL_RATE_MPD * tempAdjustment
  );

  // Miles past McNary (negative = not yet arrived)
  const milesPastMcnary = projectedMilesFromBonneville - BONNEVILLE_TO_MCNARY_MI;

  const today = new Date().toISOString().split('T')[0];
  const projectedArrival = {
    bonneville_avg_daily: Math.round(avgBonCount),
    days_since_leading_edge: Math.round(daysSinceLeadingEdge),
    projected_miles_from_bonneville: projectedMilesFromBonneville,
    miles_past_mcnary: milesPastMcnary,
    mcnary_arrival_estimated: milesPastMcnary >= 0,
    computed_date: today,
  };

  // Write progression record
  const { error: insertError } = await supabase.from('salmon_run_progression').insert({
    run_year: new Date().getFullYear(),
    species: 'chinook',
    ladder_location: 'Bonneville→McNary',
    passage_date: today,
    daily_count: bonCounts.length > 0 ? Math.round(bonCounts[0].value) : null,
    cumulative_count: bonCounts.length > 0
      ? Math.round(bonCounts.reduce((s, r) => s + r.value, 0))
      : null,
    projected_arrival: projectedArrival,
  });
  if (insertError) console.error('[salmonProgression] write failed:', insertError.message);

  return projectedMilesFromBonneville;
}
