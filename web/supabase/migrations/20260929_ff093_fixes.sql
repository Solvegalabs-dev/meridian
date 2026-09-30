-- FF-093 fix tasker (2026-09-29): security, timezone, location, drought,
-- species-key, licensing, and cleanup fixes found in review of PR #9.
-- Written to be safe whether or not 20260927_ff093_collar_pattern_library.sql
-- was ever applied, and safe to re-run.

-- ============================================================
-- Fix 1 (P0, security): RLS policies were `FOR ALL USING (true)` with no
-- `TO` clause, which applies to every role — including anon. The anon key
-- could read and write both collar tables. Service role bypasses RLS and
-- needs no policy at all, so the fix is: drop the policy, add none back,
-- and explicitly revoke table privileges from anon/authenticated.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.collar_pattern_library') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_collar_pattern_library" ON collar_pattern_library';
    EXECUTE 'REVOKE ALL ON collar_pattern_library FROM anon, authenticated';
  END IF;

  IF to_regclass('public.collar_events_raw') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "service_role_collar_events_raw" ON collar_events_raw';
  END IF;
END $$;

-- Verification (not executed) — expected: zero rows.
-- SELECT tablename, policyname, roles::text, qual FROM pg_policies WHERE tablename LIKE 'collar_%';

-- ============================================================
-- Fix 2 (P0, timezone): movement windows are now binned in the objective's
-- local hour (see collarPatternExtractor.ts), not UTC. Store which zone was
-- used so calibration/UI can be explicit about it.
-- Fix 7 (P1, licensing): only CC0/CC-BY-licensed studies are used; store the
-- license(s) and citation actually backing each row so credit is real
-- ("Movebank study <id>" was a placeholder, not attribution).
-- Fix 3 (P0, location): record the actual per-event search radius used, so
-- a row's provenance is auditable.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.collar_pattern_library') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS local_tz text';
    EXECUTE 'ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS license_types text[]';
    EXECUTE 'ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS citation text';
    EXECUTE 'ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS event_radius_km int';
  END IF;
END $$;

-- ============================================================
-- Fix 8 (P2): salmon removed from this agent's scope — salmon are not
-- GPS-collared, and this agent's domain is elk_hunt, so carrying fish
-- taxonomy keys here risked cross-contaminating fishing-domain agent
-- filtering (see fix/strike-agent-filter, PR #249).
-- ============================================================

UPDATE agent_registry
SET taxonomy_keys = ARRAY['elk.bull','elk.cow','deer.mule','deer.whitetail','caribou','moose','pronghorn']
WHERE agent_code = 'OUTDOOR_MOVEBANK_COLLAR';

-- collar_events_raw was never written to (the fetch+extract pipeline holds
-- events in memory for one run rather than staging them), so it's dead
-- weight — drop it rather than keep an unused table with RLS to maintain.
DROP TABLE IF EXISTS collar_events_raw;
