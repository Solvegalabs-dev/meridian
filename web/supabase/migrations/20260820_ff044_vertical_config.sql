-- FF-044: Fusion Multi-Seat Agent Layer + Vertical Template
-- Migration 2: vertical_config table
-- Filed August 20, 2026 · Solvega Labs LLC

CREATE TABLE IF NOT EXISTS vertical_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL UNIQUE REFERENCES enterprise_institutions(id) ON DELETE CASCADE,
  vertical_type text NOT NULL CHECK (vertical_type IN ('auto_finance','real_estate','healthcare_rcm','staffing')),
  case_schema jsonb NOT NULL DEFAULT '[]',
  objective_templates jsonb NOT NULL DEFAULT '{}',
  signal_sources jsonb NOT NULL DEFAULT '[]',
  ui_theme jsonb,
  pricing_model jsonb,
  macro_event_categories text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE vertical_config ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE vertical_config IS 'FF-044: Vertical template configuration. One row per institution. Defines case schema, objectives, signals, and UI for each Fusion vertical. Filed August 20, 2026.';

-- RLS Policy
CREATE POLICY vertical_config_institution_read ON vertical_config
  FOR SELECT USING (
    institution_id IN (
      SELECT institution_id FROM enterprise_members
      WHERE user_id = auth.uid()
    )
  );
