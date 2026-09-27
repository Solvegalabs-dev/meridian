-- FF-076: Strike Brief Field Enhancement
-- Three new columns on strike_briefs + two new tables

ALTER TABLE strike_briefs
  ADD COLUMN IF NOT EXISTS movement_windows jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS terrain_intel jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS terrain_source text DEFAULT NULL;

-- field_queries: CyberScout in-field Q&A log
CREATE TABLE field_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL,
  user_id uuid NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  context_used jsonb DEFAULT '{}',
  confidence_tier text CHECK (confidence_tier IN ('T1', 'T2', 'T3', 'T4')),
  voice_input boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE field_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_field_queries" ON field_queries
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_field_queries_objective ON field_queries(objective_id);
CREATE INDEX idx_field_queries_user ON field_queries(user_id, created_at DESC);

-- terrain_cache: USGS 3DEP results cached per coordinate set
CREATE TABLE terrain_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordinate_key text NOT NULL UNIQUE,
  elevation_data jsonb NOT NULL,
  terrain_interpretation jsonb NOT NULL,
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '30 days')
);

CREATE INDEX idx_terrain_cache_key ON terrain_cache(coordinate_key);
