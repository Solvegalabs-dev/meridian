-- FF-080: Terrain Intelligence Engine
-- Extends terrain_cache with structured columns for per-coordinate terrain analysis
-- Adds 2 agent_configs rows: USGS 3DEP elevation fetch + CALCULATED composite

-- terrain_cache was created in ff076_field_enhancement.sql (coordinate_key / jsonb cache).
-- These columns add the structured per-objective terrain model described in FF-080.
ALTER TABLE terrain_cache
  ADD COLUMN IF NOT EXISTS objective_id   UUID    REFERENCES objectives(id),
  ADD COLUMN IF NOT EXISTS lat            DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS lon            DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS elevation_ft   INTEGER,
  ADD COLUMN IF NOT EXISTS slope_aspect   TEXT,
  ADD COLUMN IF NOT EXISTS thermal_belt_min_ft INTEGER,
  ADD COLUMN IF NOT EXISTS thermal_belt_max_ft INTEGER,
  ADD COLUMN IF NOT EXISTS flat_bench_score    DECIMAL,
  ADD COLUMN IF NOT EXISTS water_proximity_m   INTEGER,
  ADD COLUMN IF NOT EXISTS ndvi_at_location    DECIMAL,
  ADD COLUMN IF NOT EXISTS bedding_probability DECIMAL,
  ADD COLUMN IF NOT EXISTS computed_at    TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS geojson_output JSONB;

CREATE INDEX IF NOT EXISTS idx_terrain_cache_objective
  ON terrain_cache(objective_id);

CREATE INDEX IF NOT EXISTS idx_terrain_cache_computed_at
  ON terrain_cache(computed_at DESC);

-- Agent configs
INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_USGS_3DEP_ELEVATION',
    'outdoor', 'elk_hunt',
    'USGS 3DEP Elevation Query',
    'EPQS point elevation in feet at objective coordinates — feeds terrain_cache',
    'https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Feet&includeDate=false',
    'new_record', NULL, NULL,
    720, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_TERRAIN_COMPOSITE',
    'outdoor', 'elk_hunt',
    'Terrain Composite Bedding Score',
    'Thermal belt + bench + water convergence composite — returns bedding probability 0–1 from terrain_cache',
    'CALCULATED:terrain_composite',
    'value_above', 0.6, NULL,
    720, 'climate_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;

-- Verification:
-- SELECT agent_key, display_name, cadence_minutes
-- FROM agent_configs
-- WHERE agent_key LIKE 'OUTDOOR_%'
-- ORDER BY created_at DESC LIMIT 10;
