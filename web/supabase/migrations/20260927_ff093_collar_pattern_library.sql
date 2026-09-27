-- FF-093: Outdoor Movebank Collar Intelligence Agent
-- New tables: collar_pattern_library (calibrated movement patterns),
-- collar_events_raw (temp staging for raw GPS fixes, purged after extraction)
-- 1 agent_configs row (CALCULATED, combined fetch+extract) + 1 agent_registry row

CREATE TABLE IF NOT EXISTS collar_pattern_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  species_taxon_key text NOT NULL,
  geo_hash text NOT NULL,
  state_code text,
  unit_id text,

  season_month int NOT NULL,
  valid_for_seasons int[],

  peak_movement_windows jsonb,

  median_bedding_ft int,
  bedding_p25_ft int,
  bedding_p75_ft int,
  elevation_migration_trend text,

  drought_modifiers jsonb,
  temp_optimal_range_f int[],
  temp_suppression_f int,

  thermal_belt_pct decimal(4,3),
  aligns_ff080 boolean DEFAULT false,

  movebank_study_ids bigint[],
  individual_count int,
  gps_fix_count bigint,
  years_coverage text,
  data_owner_credit text,

  confidence_tier int DEFAULT 1,
  computed_at timestamptz DEFAULT now(),
  expires_at timestamptz,

  UNIQUE(species_taxon_key, geo_hash, season_month)
);

CREATE INDEX IF NOT EXISTS idx_collar_pattern_lookup
  ON collar_pattern_library (species_taxon_key, geo_hash, season_month);

CREATE INDEX IF NOT EXISTS idx_collar_pattern_state_unit
  ON collar_pattern_library (state_code, unit_id);

ALTER TABLE collar_pattern_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_collar_pattern_library" ON collar_pattern_library
  FOR ALL USING (true);

-- Staging table for raw GPS fixes between fetch and pattern extraction.
-- Rows are deleted by collarPatternExtractor once a batch has been binned.
CREATE TABLE IF NOT EXISTS collar_events_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id bigint NOT NULL,
  individual_id text,
  event_ts timestamptz NOT NULL,
  lat numeric NOT NULL,
  lon numeric NOT NULL,
  species_taxon_key text NOT NULL,
  fetched_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_collar_events_raw_species
  ON collar_events_raw (species_taxon_key, study_id);

ALTER TABLE collar_events_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_collar_events_raw" ON collar_events_raw
  FOR ALL USING (true);

-- Agent config — single combined fetch+extract CALCULATED agent.
-- (Movebank's 2-step, Basic-Auth, rate-limited API doesn't fit the generic
-- single-GET fetch model other agent_configs rows use, so fetch + pattern
-- extraction are one function rather than two dependent agent rows.)
INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES (
  'OUTDOOR_MOVEBANK_COLLAR',
  'outdoor', 'elk_hunt',
  'Movebank Collar Pattern Intelligence',
  'Fetches Movebank GPS collar studies/events for the objective''s species + geo, bins movement by hour-of-day (IQR peak method), cross-references drought + FF-080 thermal belt, writes calibrated patterns to collar_pattern_library.',
  'CALCULATED:movebank_collar_patterns',
  'new_record', NULL, NULL,
  43200, 'climate_regulatory', 'ELK_HUNT:', true, false
)
ON CONFLICT (agent_key) DO NOTHING;

-- Agent registry — routing/assignment row consumed by objectiveRouter.ts.
-- requires_key = true; objectiveRouter auto-queues a credential request
-- (agent_credential_requests) the first time a matching objective is created
-- without MOVEBANK_USERNAME/MOVEBANK_PASSWORD present in the environment.
INSERT INTO agent_registry (
  agent_code, taxonomy_keys, geo_scope, data_source_url, requires_key, status
)
VALUES (
  'OUTDOOR_MOVEBANK_COLLAR',
  ARRAY[
    'elk.bull', 'elk.cow',
    'deer.mule', 'deer.whitetail',
    'caribou', 'moose', 'pronghorn',
    'salmon.king', 'salmon.sockeye', 'salmon.silver'
  ],
  'national',
  'CALCULATED:movebank_collar_patterns',
  true, 'live'
)
ON CONFLICT (agent_code) DO UPDATE SET
  taxonomy_keys = EXCLUDED.taxonomy_keys,
  geo_scope = EXCLUDED.geo_scope,
  data_source_url = EXCLUDED.data_source_url,
  requires_key = EXCLUDED.requires_key,
  status = EXCLUDED.status;
