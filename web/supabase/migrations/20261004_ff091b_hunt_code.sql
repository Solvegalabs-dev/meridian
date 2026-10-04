-- FF-091 PR B (Part B1): UDWR hunt number on the objective, and a cache for the UDWR boundary.
--
-- Idempotent. Every data repair is guarded, so the migration is safe on a project where
-- those rows do not exist (for example the rebuild project). RLS on with NO policies and
-- anon/authenticated revoked for every new table: only the service role reads or writes.

-- 1. Hunt number on the profile ------------------------------------------------

ALTER TABLE objective_profiles
  ADD COLUMN IF NOT EXISTS hunt_code text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'objective_profiles_hunt_code_format'
  ) THEN
    ALTER TABLE objective_profiles
      ADD CONSTRAINT objective_profiles_hunt_code_format
      CHECK (hunt_code IS NULL OR hunt_code ~ '^[A-Z]{2}[0-9]{4}$');
  END IF;
END
$$;

-- Backfill from geo.unit, where the hunt number was already stored (verified on the live project).
UPDATE objective_profiles
SET hunt_code = upper(geo->>'unit')
WHERE hunt_code IS NULL
  AND geo->>'unit' ~ '^[A-Za-z]{2}[0-9]{4}$';

-- 2. EA2004 repair (Chalk Creek) -----------------------------------------------
-- The stopgap set hunt_unit_id to the hunt number. The matcher needs the registry slug, and
-- the hunt number now lives in hunt_code. Only runs when the registry row exists.

DO $$
BEGIN
  IF to_regclass('public.hunt_unit_registry') IS NOT NULL
     AND EXISTS (SELECT 1 FROM hunt_unit_registry WHERE unit_id = 'chalk-creek') THEN
    UPDATE objective_profiles
    SET hunt_code = 'EA2004',
        hunt_unit_id = 'chalk-creek'
    WHERE id = '3f54ca30-1404-4dce-814a-2de1e4ab9b58'
      AND hunt_unit_id = 'EA2004';

    UPDATE objective_spots
    SET hunt_unit_id = 'chalk-creek'
    WHERE hunt_unit_id = 'EA2004'
      AND objective_id IN (
        SELECT objective_id FROM objective_profiles
        WHERE id = '3f54ca30-1404-4dce-814a-2de1e4ab9b58'
      );
  END IF;
END
$$;

-- hunt_seasons repair: the one unit-specific row for EA2004 becomes a hunt-code row.
DO $$
BEGIN
  IF to_regclass('public.hunt_seasons') IS NOT NULL THEN
    UPDATE hunt_seasons
    SET hunt_code = 'EA2004',
        hunt_unit_id = NULL
    WHERE state = 'UT'
      AND species = 'elk'
      AND hunt_unit_id = 'EA2004'
      AND season_year = 2026
      AND hunt_code IS NULL;
  END IF;
END
$$;

-- 3. Spot pin check result (B4) ------------------------------------------------
-- NULL = unknown (no hunt number, or no cached boundary). true/false = inside/outside the unit.

ALTER TABLE objective_spots
  ADD COLUMN IF NOT EXISTS inside_boundary boolean;

-- 4. UDWR boundary cache (B2) --------------------------------------------------
-- Written only on a user-triggered lookup. Expires after 30 days (checked in code).

CREATE TABLE IF NOT EXISTS udwr_hunt_cache (
  hunt_code         text PRIMARY KEY CHECK (hunt_code ~ '^[A-Z]{2}[0-9]{4}$'),
  boundary_id       text,
  season_text       text,
  boundary_geojson  jsonb,
  fetched_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE udwr_hunt_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON udwr_hunt_cache FROM anon, authenticated;
