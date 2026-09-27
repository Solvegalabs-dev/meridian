-- FF-083: Fishing Phenology Layer
-- 2 agent_configs rows: CALCULATED hatch window + iNaturalist aquatic insects

INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_HATCH_WINDOW',
    'outdoor', 'elk_hunt',
    'Hatch Window Probability',
    'Meeus hatch probability 0–1 from water temp vs species calendar (BWO/PMD/PED). Reads OUTDOOR_USGS_WATER_TEMP signal history.',
    'CALCULATED:hatch_window_meeus',
    'value_above', 0.3, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_INATURALIST_AQUATIC',
    'outdoor', 'elk_hunt',
    'iNaturalist Aquatic Insect Observations',
    'Community-reported aquatic insect sightings near Kenai River — mayfly, caddisfly, stonefly emergence signals',
    'https://api.inaturalist.org/v1/observations?taxon_id=47822&lat=60.487&lng=-150.777&radius=25&per_page=10',
    'keyword_match', NULL,
    ARRAY['mayfly', 'caddisfly', 'stonefly', 'midge', 'hatch', 'emergence', 'Ephemeroptera', 'Trichoptera', 'Plecoptera'],
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;
