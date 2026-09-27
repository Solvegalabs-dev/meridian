// FF-081 — Fishing Water Condition Agents
// USGS water temp, dissolved O2, turbidity + NOAA barometric pressure trend.
// All four agents use live URL fetches — agent configs seeded via migration.
// Note: USGS site 15266300 = Kenai River near Soldotna, AK.
// Geographic targeting (FF-074) will parameterize gauge selection at runtime.

export const FISHING_WATER_AGENT_KEYS = [
  'OUTDOOR_USGS_WATER_TEMP',
  'OUTDOOR_USGS_DISSOLVED_O2',
  'OUTDOOR_NOAA_BAROMETRIC',
  'OUTDOOR_USGS_TURBIDITY',
] as const;

export type FishingWaterAgentKey = typeof FISHING_WATER_AGENT_KEYS[number];

// Threshold reference values — documented here for clarity
export const WATER_THRESHOLDS = {
  TROUT_OPTIMAL_TEMP_F:    65,   // value_below — trout stress above this
  DISSOLVED_O2_STRESS_MGL:  7,   // value_below — hypoxia stress threshold
  PRESSURE_TREND_PCT:       5,   // delta_pct  — feeding trigger window
  TURBIDITY_UNFISHABLE_NTU: 50,  // value_above — clarity too low
} as const;
