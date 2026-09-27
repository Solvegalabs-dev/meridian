// FF-083 — Fishing Phenology Layer
// CALCULATED:hatch_window_meeus → computeHatchWindow()
// Reads OUTDOOR_USGS_WATER_TEMP signal history (Celsius) and maps to
// hatch probability 0–1 based on species temperature windows.
// Note: requires agentRunner.ts runCalculated() to be updated with this case.

import { createServiceClient } from '@/lib/supabase/server';

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

// Returns hatch probability 0–1: fraction of species whose temp window is active.
// Reads most recent observed water temp from agent_signal_history.
export async function computeHatchWindow(): Promise<number | null> {
  const supabase = createServiceClient();

  const { data } = await supabase
    .from('agent_signal_history')
    .select('observed_value')
    .eq('agent_key', 'OUTDOOR_USGS_WATER_TEMP')
    .eq('source', 'observed')
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const tempC = Number(data.observed_value);
  if (isNaN(tempC)) return null;

  const activeCount = HATCH_SPECIES.filter(
    s => tempC >= s.minC && tempC <= s.maxC
  ).length;

  return Math.round((activeCount / HATCH_SPECIES.length) * 10000) / 10000;
}
