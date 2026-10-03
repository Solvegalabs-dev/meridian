-- FF-089 P0 (season lifecycle) — schema for closed hunts.
--
-- Idempotent. Safe to re-run.
--
-- 1. strike_briefs.go_no_go accepts 'CLOSED' (written only by code, never the model).
-- 2. strike_briefs.time_window is UNCHANGED: still NOT NULL, still
--    ('0600','1100','1700'). Closed rows write the neutral '0600'.
--    No UI or API path shows time_window when go_no_go = 'CLOSED'.
-- 3. strike_briefs.confidence_tier is UNCHANGED. Closed rows write NULL.
-- 4. objective_profiles gets ended_at / ended_reason. Rows are never deleted.
--
-- campaign_units.status and hunt_campaigns.status have no CHECK constraints
-- (verified live), so 'expired' and 'closed' need no migration.
--
-- Self-check after applying. A closed row (go_no_go 'CLOSED', time_window '0600',
-- confidence_tier NULL) passes all three constraints if these show the expected
-- definitions:
--   SELECT conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--   WHERE conrelid = 'strike_briefs'::regclass AND contype = 'c';
-- Expect strike_briefs_go_no_go_check to include 'CLOSED', and
-- strike_briefs_time_window_check to stay ('0600','1100','1700').

-- 1. go_no_go: add CLOSED. DROP IF EXISTS makes this re-runnable.
ALTER TABLE strike_briefs DROP CONSTRAINT IF EXISTS strike_briefs_go_no_go_check;
ALTER TABLE strike_briefs ADD CONSTRAINT strike_briefs_go_no_go_check
  CHECK (go_no_go IN ('GO', 'NO_GO', 'CONDITIONAL', 'MONITOR', 'CLOSED'));

-- 4. Lifecycle columns on objective_profiles.
ALTER TABLE objective_profiles ADD COLUMN IF NOT EXISTS ended_at timestamptz;
ALTER TABLE objective_profiles ADD COLUMN IF NOT EXISTS ended_reason text;

ALTER TABLE objective_profiles DROP CONSTRAINT IF EXISTS objective_profiles_ended_reason_check;
ALTER TABLE objective_profiles ADD CONSTRAINT objective_profiles_ended_reason_check
  CHECK (ended_reason IS NULL OR ended_reason IN ('trip_ended', 'season_closed'));
