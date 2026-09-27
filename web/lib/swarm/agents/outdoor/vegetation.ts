// FF-079 — Vegetation & Food Source Intelligence
// MODIS NDVI, USA-NPN aspen phenology, USFS post-fire regrowth, iNaturalist vegetation.
// All four agents use live URL fetches — agent configs seeded via migration.

export const VEGETATION_AGENT_KEYS = [
  'OUTDOOR_NDVI_UTAH',
  'OUTDOOR_PHENOLOGY_ASPEN',
  'OUTDOOR_FIRE_HISTORY_USFS',
  'OUTDOOR_INATURALIST_VEGETATION',
] as const;

export type VegetationAgentKey = typeof VEGETATION_AGENT_KEYS[number];

// Phenophase keywords indicating active aspen leaf stage
export const ASPEN_PHENOPHASE_KEYWORDS = [
  'Colored leaves',
  'Falling leaves',
  'Breaking leaf buds',
  'Unfolded leaves',
  'Increasing leaf size',
];

// USFS fire history keywords indicating recent/active post-fire regrowth zones
export const FIRE_REGROWTH_KEYWORDS = [
  'FIRE_YEAR',
  'fire',
  'burn',
  'regrowth',
  'post-fire',
];
