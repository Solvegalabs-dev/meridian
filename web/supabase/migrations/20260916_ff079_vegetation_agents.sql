-- FF-079: Vegetation & Food Source Intelligence
-- 4 agent_configs rows — all live URL fetches, no CALCULATED: routing

INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_NDVI_UTAH',
    'outdoor', 'elk_hunt',
    'MODIS NDVI Greenness Index',
    'MODIS MOD13Q1 NDVI at objective coordinates vs 5-year baseline — detects vegetation green-up or senescence',
    'https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?lat={lat}&lon={lon}&startDate={year}-01-01&endDate={year}-12-31&kmAboveBelow=2&kmLeftRight=2',
    'value_below', 0.3, NULL,
    168, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_PHENOLOGY_ASPEN',
    'outdoor', 'elk_hunt',
    'Aspen Leaf Stage — USA-NPN',
    'USA National Phenology Network aspen phenophase tracker — leaf stage signals elk feed availability',
    'https://npn.usgs.gov/observations/getObservations.json?request_src=rest&bottom_left_x=-111&bottom_left_y=40&top_right_x=-109&top_right_y=41&start_date={year}-07-01&end_date={year}-10-01&species_id=1058&phenophase_id=498',
    'keyword_match', NULL,
    ARRAY['Colored leaves', 'Falling leaves', 'Breaking leaf buds', 'Unfolded leaves', 'Increasing leaf size'],
    168, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_FIRE_HISTORY_USFS',
    'outdoor', 'elk_hunt',
    'USFS Post-Fire Regrowth Zones',
    'MTBS fire perimeters for Utah — post-fire openings attract elk browse',
    'https://apps.fs.usda.gov/arcx/rest/services/EDW/EDW_MTBS_01/MapServer/0/query?where=STATE+%3D+%27UT%27&outFields=*&f=json',
    'keyword_match', NULL,
    ARRAY['FIRE_YEAR', 'fire', 'burn', 'regrowth', 'post-fire'],
    720, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_INATURALIST_VEGETATION',
    'outdoor', 'elk_hunt',
    'iNaturalist Vegetation Observations',
    'Tracheophyta observations near Uinta Basin — community-reported vegetation health signals',
    'https://api.inaturalist.org/v1/observations?taxon_id=47126&lat=40.948&lng=-110.668&radius=50&per_page=20',
    'keyword_match', NULL,
    ARRAY['plant', 'grass', 'forb', 'shrub', 'browse', 'vegetation'],
    168, 'climate_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;

-- Verification:
-- SELECT agent_key, display_name, status, cadence_minutes
-- FROM agent_configs
-- WHERE agent_key LIKE 'OUTDOOR_%'
-- ORDER BY created_at DESC LIMIT 10;
