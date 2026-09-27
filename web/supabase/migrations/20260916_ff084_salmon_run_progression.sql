-- FF-084: Salmon Run Progression Engine
-- New table: salmon_run_progression
-- 2 agent_configs rows: USACE McNary ladder count + CALCULATED run projection

CREATE TABLE IF NOT EXISTS salmon_run_progression (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  run_year         INTEGER      NOT NULL,
  species          TEXT         NOT NULL,
  ladder_location  TEXT         NOT NULL,
  passage_date     DATE         NOT NULL,
  daily_count      INTEGER,
  cumulative_count INTEGER,
  projected_arrival JSONB,
  computed_at      TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE salmon_run_progression ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_salmon_run_progression" ON salmon_run_progression
  FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_salmon_run_progression_year_species
  ON salmon_run_progression(run_year, species);

CREATE INDEX IF NOT EXISTS idx_salmon_run_progression_computed_at
  ON salmon_run_progression(computed_at DESC);

-- Agent configs
INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_USACE_MCNARY',
    'outdoor', 'elk_hunt',
    'USACE McNary Ladder Count',
    'Columbia/Snake adult salmon passage at McNary Dam — daily count above 500 confirms run past mid-river',
    'https://www.cbr.washington.edu/dart/cs/php/rpt/adult_annual.php?sc=1&outputFormat=csv&year=2026&proj=MCN&species=1&run=1',
    'value_above', 500.0, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_SALMON_PROGRESSION',
    'outdoor', 'elk_hunt',
    'Salmon Run Progression Engine',
    'Projects chinook leading-edge position (miles from Bonneville) using 7-day passage history + 20 mph travel rate. Writes to salmon_run_progression.',
    'CALCULATED:salmon_run_progression',
    'new_record', NULL, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;
