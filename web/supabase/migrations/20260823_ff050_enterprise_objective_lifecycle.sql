-- FF-050: Enterprise Objective Lifecycle Management
-- Migration: 20260823_ff050_enterprise_objective_lifecycle.sql
-- Adds lifecycle state machine columns to enterprise_objectives.
-- Safe: all IF NOT EXISTS — idempotent on re-run.

ALTER TABLE enterprise_objectives
  ADD COLUMN IF NOT EXISTS lifecycle_state text DEFAULT 'active'
    CHECK (lifecycle_state IN ('active', 'retired', 'dropped')),
  ADD COLUMN IF NOT EXISTS lifecycle_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS lifecycle_reason text,
  ADD COLUMN IF NOT EXISTS lifecycle_notes text;

-- Back-fill existing rows: anything without a lifecycle_state gets 'active'.
-- (The DEFAULT handles new rows; this handles rows inserted before the migration.)
UPDATE enterprise_objectives
  SET lifecycle_state = 'active'
  WHERE lifecycle_state IS NULL;

-- RLS: enterprise_objectives inherits whatever policy exists.
-- Verify zero anon exposure after apply:
-- SELECT tablename, policyname, roles
-- FROM pg_policies
-- WHERE tablename = 'enterprise_objectives'
--   AND 'anon' = ANY(roles);

-- Verify columns exist (run after apply):
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'enterprise_objectives'
--   AND column_name IN (
--     'lifecycle_state', 'lifecycle_changed_at',
--     'lifecycle_reason', 'lifecycle_notes'
--   )
-- ORDER BY column_name;
