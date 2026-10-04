-- FF-091 PR A (Part A): hunt spots.
--
-- An objective can hunt several areas in one season. Each area is a spot. One spot is
-- active at a time; its coordinates are copied onto objective_profiles, which the agents
-- and the location editor read. Signals and briefs are tagged with the spot they were
-- produced for, so a switch does not mix the old area's data into the new one.
--
-- Idempotent. RLS on with NO policies, and anon/authenticated revoked: only the service
-- role reads or writes, and every API route checks objectives.user_id first.
-- Never USING (true).

-- A1. Spots ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS objective_spots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id      uuid NOT NULL REFERENCES objectives(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL,
  name              text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  lat               double precision NOT NULL,
  lon               double precision NOT NULL,
  is_active         boolean NOT NULL DEFAULT false,
  sort_order        int NOT NULL DEFAULT 0,
  geo_snapshot      jsonb,           -- FullGeography for this point (NWS grid, gauges, SNOTEL, elevation, county, state)
  geo_resolved_at   timestamptz,     -- NULL = age unknown, treated as stale on switch
  hunt_unit_id      text,            -- resolver slug at this point; informational only
  activated_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- One active spot per objective.
CREATE UNIQUE INDEX IF NOT EXISTS objective_spots_one_active
  ON objective_spots (objective_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS objective_spots_objective_idx
  ON objective_spots (objective_id, sort_order);

ALTER TABLE objective_spots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON objective_spots FROM anon, authenticated;

-- Backfill: each profile that already has coordinates gets one active 'Primary spot'.
-- Skipped for any objective that already has a spot, so a re-run adds nothing.
INSERT INTO objective_spots (
  objective_id, user_id, name, lat, lon, is_active, sort_order,
  geo_snapshot, geo_resolved_at, hunt_unit_id, activated_at
)
SELECT
  p.objective_id,
  o.user_id,
  'Primary spot',
  p.lat::double precision,
  p.lon::double precision,
  true,
  0,
  jsonb_build_object(
    'nws_grid_office',    p.nws_grid_office,
    'nws_grid_x',         p.nws_grid_x,
    'nws_grid_y',         p.nws_grid_y,
    'nws_zone_id',        p.nws_zone_id,
    'state',              p.state,
    'county',             p.county,
    'usgs_gauge_ids',     to_jsonb(p.usgs_gauge_ids),
    'snotel_station_ids', to_jsonb(p.snotel_station_ids),
    'elevation_ft_avg',   p.elevation_ft_avg
  ),
  NULL,              -- the profile's resolve time is not recorded, so the snapshot counts as stale
  p.hunt_unit_id,
  now()
FROM objective_profiles p
JOIN objectives o ON o.id = p.objective_id
WHERE p.objective_id IS NOT NULL
  AND p.lat IS NOT NULL
  AND p.lon IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM objective_spots s WHERE s.objective_id = p.objective_id);

-- A1. strike_briefs.spot_id --------------------------------------------------

ALTER TABLE strike_briefs
  ADD COLUMN IF NOT EXISTS spot_id uuid REFERENCES objective_spots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS strike_briefs_objective_spot_idx
  ON strike_briefs (objective_id, spot_id);

UPDATE strike_briefs b
SET spot_id = os.id
FROM objective_spots os
WHERE os.objective_id = b.objective_id
  AND os.is_active
  AND b.spot_id IS NULL;

-- A1. signals.spot_id --------------------------------------------------------
-- signals can be large. The backfill runs in batches of 5000 rows, and only rows whose
-- first objective has an active spot are touched, so the loop always makes progress.
-- Every batch is in this migration's transaction; the row count is not verified in this PR.

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS spot_id uuid REFERENCES objective_spots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS signals_objective_spot_idx
  ON signals (objective_id, spot_id);

DO $$
DECLARE
  affected int;
BEGIN
  LOOP
    WITH batch AS (
      SELECT s.id, os.id AS spot_id
      FROM signals s
      JOIN objective_spots os
        ON os.objective_id = s.objective_ids[1]::uuid
       AND os.is_active
      WHERE s.spot_id IS NULL
      LIMIT 5000
    )
    UPDATE signals s
    SET spot_id = batch.spot_id
    FROM batch
    WHERE s.id = batch.id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
  END LOOP;
END
$$;

-- A4. Atomic activate --------------------------------------------------------
-- Clears the old active spot and sets the new one in a single transaction. The row lock
-- serialises concurrent activates for the same objective, and the partial unique index
-- is the backstop. Callable by the service role only.

CREATE OR REPLACE FUNCTION activate_objective_spot(p_objective_id uuid, p_spot_id uuid)
RETURNS objective_spots
LANGUAGE plpgsql
AS $$
DECLARE
  result objective_spots;
BEGIN
  PERFORM 1 FROM objective_spots WHERE objective_id = p_objective_id FOR UPDATE;

  UPDATE objective_spots
  SET is_active = false
  WHERE objective_id = p_objective_id
    AND is_active
    AND id <> p_spot_id;

  UPDATE objective_spots
  SET is_active    = true,
      activated_at = CASE WHEN is_active THEN activated_at ELSE now() END
  WHERE id = p_spot_id
    AND objective_id = p_objective_id
  RETURNING * INTO result;

  IF result.id IS NULL THEN
    RAISE EXCEPTION 'spot_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION activate_objective_spot(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_objective_spot(uuid, uuid) TO service_role;
