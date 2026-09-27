// FF-082 — Fishing Run Timing & Regulatory Intelligence
// Columbia/Snake ladder counts (USACE Bonneville), ADF&G sonar passage, Utah DWR stocking.
// All three agents use live URL fetches — agent configs seeded via migration.

export const FISHING_RUN_TIMING_AGENT_KEYS = [
  'OUTDOOR_USACE_BONNEVILLE',
  'OUTDOOR_ADFG_SONAR',
  'OUTDOOR_UDWR_STOCKING',
] as const;

export type FishingRunTimingAgentKey = typeof FISHING_RUN_TIMING_AGENT_KEYS[number];

// Keywords for ADF&G sonar passage counts page
export const ADFG_SONAR_KEYWORDS = [
  'sockeye',
  'chinook',
  'coho',
  'passage',
  'count',
  'escapement',
];

// Keywords for Utah DWR stocking events
export const UDWR_STOCKING_KEYWORDS = [
  'stocked',
  'stocking',
  'planted',
  'rainbow',
  'brown trout',
  'cutthroat',
  'brook trout',
];
