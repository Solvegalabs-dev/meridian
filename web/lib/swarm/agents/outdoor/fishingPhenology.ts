// FF-083 — Fishing Phenology Layer
// CALCULATED:hatch_window_meeus → computeHatchWindow()
// Reads this objective's OUTDOOR_USGS_WATER_TEMP signal history (Celsius) and maps to
// hatch probability 0–1 based on species temperature windows.
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';
import { provenance, type SourceDetail } from '@/lib/strike/signalFormat';

export const FISHING_PHENOLOGY_AGENT_KEYS = [
  'OUTDOOR_HATCH_WINDOW',
  'OUTDOOR_INATURALIST_AQUATIC',
] as const;

export type FishingPhenologyAgentKey = typeof FISHING_PHENOLOGY_AGENT_KEYS[number];

// Hatch windows in Celsius (USGS always returns °C)
// BWO = Blue-Winged Olive, PMD = Pale Morning Dun, PED = Pale Evening Dun
export const HATCH_SPECIES = [
  { name: 'BWO', minC: 7.2,  maxC: 10.0 },  // 45–50°F
  { name: 'PMD', minC: 14.4, maxC: 18.3 },  // 58–65°F
  { name: 'PED', minC: 16.7, maxC: 20.0 },  // 62–68°F
] as const;

export const AQUATIC_INSECT_KEYWORDS = [
  'mayfly',
  'caddisfly',
  'stonefly',
  'midge',
  'hatch',
  'emergence',
  'Ephemeroptera',
  'Trichoptera',
  'Plecoptera',
];

// A water temperature older than this says nothing about today's hatch.
const MAX_TEMP_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Fraction (0–1) of species whose temperature window contains the water temperature in Celsius.
export function hatchScoreFromTempC(tempC: number): number {
  const activeCount = HATCH_SPECIES.filter(s => tempC >= s.minC && tempC <= s.maxC).length;
  return Math.round((activeCount / HATCH_SPECIES.length) * 10000) / 10000;
}

export type HatchReading = { value: number; detail: NonNullable<SourceDetail> };

// Returns the hatch score for THIS objective, computed from its own water temperature (FF-100): the latest observed
// reading from a gauge near the spot, no older than 3 days. No such reading (no gauge nearby, a distant gauge, or only
// old rows from the fixed Alaska gauge) is a miss, not a score. The gauge is carried into the result so the score says
// where its water temperature came from.
export async function computeHatchWindow(objectiveId?: string, now: Date = new Date()): Promise<HatchReading | null> {
  if (!objectiveId) return null;
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('agent_signal_history')
    .select('observed_value, source_detail, recorded_at')
    .eq('agent_key', 'OUTDOOR_USGS_WATER_TEMP')
    .eq('objective_id', objectiveId)
    .eq('source', 'observed')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const detail = data.source_detail as SourceDetail | undefined;
  if (provenance('OUTDOOR_USGS_WATER_TEMP', detail) !== 'nearby_gauge' || !detail) return null;
  if (now.getTime() - Date.parse(String(data.recorded_at)) > MAX_TEMP_AGE_MS) return null;

  const tempC = Number(data.observed_value);
  if (isNaN(tempC)) return null;

  return {
    value: hatchScoreFromTempC(tempC),
    detail: { kind: 'gauge', derived_from: 'OUTDOOR_USGS_WATER_TEMP', site_no: detail.site_no, site_name: detail.site_name, distance_mi: detail.distance_mi },
  };
}
