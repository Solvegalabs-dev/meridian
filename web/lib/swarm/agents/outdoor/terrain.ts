// FF-080 — Terrain Intelligence Engine
// CALCULATED:terrain_composite → computeTerrainIntelligence()
// Reads terrain_cache and returns composite bedding probability (0–1).
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';

export const TERRAIN_AGENT_KEYS = [
  'OUTDOOR_USGS_3DEP_ELEVATION',
  'OUTDOOR_TERRAIN_COMPOSITE',
] as const;

export type TerrainAgentKey = typeof TERRAIN_AGENT_KEYS[number];

// Weights for composite bedding probability
const BENCH_WEIGHT   = 0.40;
const WATER_WEIGHT   = 0.35;
const THERMAL_WEIGHT = 0.25;

// Water proximity beyond this distance (m) scores zero
const WATER_MAX_PROXIMITY_M = 1000;

export async function computeTerrainIntelligence(objectiveId?: string): Promise<number | null> {
  if (!objectiveId) return null;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from('terrain_cache')
    .select('bedding_probability, flat_bench_score, water_proximity_m, thermal_belt_min_ft, thermal_belt_max_ft, elevation_ft')
    .eq('objective_id', objectiveId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  // Return pre-computed value if present
  if (data.bedding_probability !== null && data.bedding_probability !== undefined) {
    return data.bedding_probability as number;
  }

  const bench   = typeof data.flat_bench_score   === 'number' ? (data.flat_bench_score as number)   : 0;
  const waterM  = typeof data.water_proximity_m   === 'number' ? (data.water_proximity_m as number)   : WATER_MAX_PROXIMITY_M;
  const waterScore = Math.max(0, 1 - waterM / WATER_MAX_PROXIMITY_M);

  const minFt  = data.thermal_belt_min_ft as number | null;
  const maxFt  = data.thermal_belt_max_ft as number | null;
  const elevFt = data.elevation_ft        as number | null;
  const inThermalBelt =
    minFt !== null && maxFt !== null && elevFt !== null &&
    elevFt >= minFt && elevFt <= maxFt;
  const thermalScore = inThermalBelt ? 1 : 0;

  const composite =
    bench       * BENCH_WEIGHT +
    waterScore  * WATER_WEIGHT +
    thermalScore * THERMAL_WEIGHT;

  return Math.round(composite * 10000) / 10000;
}
