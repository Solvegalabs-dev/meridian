export const FISHING_TAXONOMY = {
  'salmon.king.river_migration': {
    label: 'King salmon · River migration',
    species: 'King salmon (Chinook)',
    method: 'River migration',
    geo_scope: 'AK',
    agent_bundle: [
      'OUTDOOR_USGS_STREAMFLOW_STATE',
      'OUTDOOR_USGS_WATER_TEMP',
      'OUTDOOR_USGS_DISSOLVED_O2',
      'OUTDOOR_NOAA_BAROMETRIC',
      'OUTDOOR_USACE_BONNEVILLE',
      'OUTDOOR_ADFG_SONAR',
      'OUTDOOR_SALMON_PROGRESSION',
      'OUTDOOR_MOON_PHASE',
      'OUTDOOR_INATURALIST_AQUATIC',
    ],
    signal_chips: [
      { agent: 'OUTDOOR_USGS_WATER_TEMP',       label: 'Water temp',     unit: '°F' },
      { agent: 'OUTDOOR_USGS_STREAMFLOW_STATE',  label: 'Flow rate',      unit: 'cfs' },
      { agent: 'OUTDOOR_USGS_DISSOLVED_O2',      label: 'Dissolved O₂',  unit: 'mg/L' },
      { agent: 'OUTDOOR_SALMON_PROGRESSION',     label: 'Run timing',     unit: '%' },
      { agent: 'OUTDOOR_USACE_BONNEVILLE',       label: 'Bonneville',     unit: 'fish/day' },
    ],
    prep_phases: ['pre_season', 'pre_run', 'peak_run', 'tail_end'] as const,
    run_window_label: 'Run windows',
  },

  'salmon.sockeye.river_migration': {
    label: 'Sockeye · River migration',
    species: 'Sockeye salmon',
    method: 'River migration',
    geo_scope: 'AK',
    agent_bundle: [
      'OUTDOOR_USGS_STREAMFLOW_STATE',
      'OUTDOOR_USGS_WATER_TEMP',
      'OUTDOOR_USGS_DISSOLVED_O2',
      'OUTDOOR_ADFG_SONAR',
      'OUTDOOR_SALMON_PROGRESSION',
      'OUTDOOR_MOON_PHASE',
    ],
    signal_chips: [
      { agent: 'OUTDOOR_USGS_WATER_TEMP',      label: 'Water temp',  unit: '°F' },
      { agent: 'OUTDOOR_USGS_STREAMFLOW_STATE', label: 'Flow rate',   unit: 'cfs' },
      { agent: 'OUTDOOR_SALMON_PROGRESSION',   label: 'Run timing',  unit: '%' },
      { agent: 'OUTDOOR_ADFG_SONAR',           label: 'ADF&G sonar', unit: 'fish/day' },
    ],
    prep_phases: ['pre_season', 'pre_run', 'peak_run', 'tail_end'] as const,
    run_window_label: 'Run windows',
  },

  'trout.rainbow.fly_fishing': {
    label: 'Rainbow trout · Fly fishing',
    species: 'Rainbow trout',
    method: 'Fly fishing',
    geo_scope: 'US_WEST',
    agent_bundle: [
      'OUTDOOR_USGS_STREAMFLOW_STATE',
      'OUTDOOR_USGS_WATER_TEMP',
      'OUTDOOR_USGS_DISSOLVED_O2',
      'OUTDOOR_HATCH_WINDOW',
      'OUTDOOR_INATURALIST_AQUATIC',
      'OUTDOOR_MOON_PHASE',
      'OUTDOOR_NOAA_BAROMETRIC',
    ],
    signal_chips: [
      { agent: 'OUTDOOR_USGS_WATER_TEMP',       label: 'Water temp',   unit: '°F' },
      { agent: 'OUTDOOR_USGS_STREAMFLOW_STATE',  label: 'Flow rate',    unit: 'cfs' },
      { agent: 'OUTDOOR_USGS_DISSOLVED_O2',      label: 'Dissolved O₂', unit: 'mg/L' },
      { agent: 'OUTDOOR_HATCH_WINDOW',           label: 'Hatch window', unit: 'probability' },
      { agent: 'OUTDOOR_NOAA_BAROMETRIC',        label: 'Barometric',   unit: 'inHg' },
    ],
    prep_phases: ['pre_season', 'pre_run', 'peak_run', 'tail_end'] as const,
    run_window_label: 'Feed windows',
  },

  'trout.brown.fly_fishing': {
    label: 'Brown trout · Fly fishing',
    species: 'Brown trout',
    method: 'Fly fishing',
    geo_scope: 'US_WEST',
    agent_bundle: [
      'OUTDOOR_USGS_STREAMFLOW_STATE',
      'OUTDOOR_USGS_WATER_TEMP',
      'OUTDOOR_USGS_DISSOLVED_O2',
      'OUTDOOR_HATCH_WINDOW',
      'OUTDOOR_MOON_PHASE',
      'OUTDOOR_NOAA_BAROMETRIC',
    ],
    signal_chips: [
      { agent: 'OUTDOOR_USGS_WATER_TEMP',       label: 'Water temp',   unit: '°F' },
      { agent: 'OUTDOOR_USGS_STREAMFLOW_STATE',  label: 'Flow rate',    unit: 'cfs' },
      { agent: 'OUTDOOR_HATCH_WINDOW',           label: 'Hatch window', unit: 'probability' },
      { agent: 'OUTDOOR_NOAA_BAROMETRIC',        label: 'Barometric',   unit: 'inHg' },
      { agent: 'OUTDOOR_MOON_PHASE',             label: 'Moon',         unit: '%' },
    ],
    prep_phases: ['pre_season', 'pre_run', 'peak_run', 'tail_end'] as const,
    run_window_label: 'Feed windows',
  },
} as const

export const FISHING_PREP_PHASES = {
  pre_season: {
    label: 'Pre-season',
    description: 'License, gear, access permits, water body research.',
    tasks: [
      'Confirm fishing license and any special permit requirements',
      'Research water body access — public vs private bank',
      'Check USGS gauge ID for target river section',
      'Review prior year run timing data for this drainage',
    ],
  },
  pre_run: {
    label: 'Pre-run',
    description: 'Conditions building. Fish staging at river mouth or lower sections.',
    tasks: [
      'Monitor water temperature — target range for species',
      'Check streamflow — optimal cfs range for wading',
      'Watch for early run reports from ADF&G or UDWR',
      'Confirm access routes — some roads close with high water',
    ],
  },
  peak_run: {
    label: 'Peak run',
    description: 'Primary fishing window. Maximum fish density in target section.',
    tasks: [
      'Daily water temp check — fish activity window',
      'Monitor flow rate — wading safety threshold',
      'Note hatch timing — match the hatch for trout',
      'Log catch data — contribute to pattern library',
    ],
  },
  tail_end: {
    label: 'Tail end',
    description: 'Run declining. Remaining fish may be most accessible.',
    tasks: [
      'Shift to deeper pools — fish consolidating',
      'Water clarity improving — lighter tippet required',
      'Note final run count for season outcome scoring',
      'File harvest outcome for prediction calibration',
    ],
  },
}

export const FISHING_SUPPORTED_STATES = ['AK', 'UT', 'MT', 'ID', 'CO', 'WY']

export const FISHING_TAXONOMY_KEYS = new Set(Object.keys(FISHING_TAXONOMY))

export function isFishingTaxonomyKey(key: string): boolean {
  return FISHING_TAXONOMY_KEYS.has(key)
}
