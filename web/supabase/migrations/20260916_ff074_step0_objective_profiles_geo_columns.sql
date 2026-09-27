-- FF-074 Step 0: Add geographic columns to objective_profiles
ALTER TABLE objective_profiles
  ADD COLUMN IF NOT EXISTS lat DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS lon DECIMAL(9,6),
  ADD COLUMN IF NOT EXISTS nws_grid_office TEXT,
  ADD COLUMN IF NOT EXISTS nws_grid_x INTEGER,
  ADD COLUMN IF NOT EXISTS nws_grid_y INTEGER,
  ADD COLUMN IF NOT EXISTS nws_zone_id TEXT,
  ADD COLUMN IF NOT EXISTS elevation_ft INTEGER;
