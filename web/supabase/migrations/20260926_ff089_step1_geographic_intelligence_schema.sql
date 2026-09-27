-- FF-089 Step 1: Geographic Intelligence Engine schema
-- objective_profiles geo metadata + hunt_unit_registry, regulatory_registry, agent_evolution_proposals
ALTER TABLE objective_profiles
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS county TEXT,
  ADD COLUMN IF NOT EXISTS hunt_unit_id TEXT,
  ADD COLUMN IF NOT EXISTS land_ownership_pct JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS usgs_gauge_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS snotel_station_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS elevation_ft_avg INTEGER,
  ADD COLUMN IF NOT EXISTS elevation_ft_min INTEGER,
  ADD COLUMN IF NOT EXISTS elevation_ft_max INTEGER,
  ADD COLUMN IF NOT EXISTS adjacent_unit_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS annual_arc_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS regulatory_agents TEXT[] DEFAULT '{}';

CREATE TABLE IF NOT EXISTS hunt_unit_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  species TEXT NOT NULL,
  unit_name TEXT,
  centroid_lat DECIMAL(9,6),
  centroid_lon DECIMAL(9,6),
  elevation_ft_avg INTEGER,
  area_sq_miles DECIMAL,
  land_ownership_pct JSONB DEFAULT '{}',
  adjacent_unit_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state, unit_id, species)
);

CREATE TABLE IF NOT EXISTS regulatory_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  species TEXT NOT NULL,
  unit_id TEXT,
  regulation_type TEXT NOT NULL,
  source_url TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  current_value JSONB,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_evolution_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL,
  objective_id UUID REFERENCES objectives(id),
  geography JSONB NOT NULL,
  taxonomy_key TEXT NOT NULL,
  proposed_agent_key TEXT NOT NULL,
  proposed_display_name TEXT NOT NULL,
  proposed_source_url TEXT NOT NULL,
  proposed_threshold_type TEXT NOT NULL,
  proposed_threshold_value DECIMAL,
  proposed_cadence_minutes INTEGER,
  haiku_rationale TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
