-- FF-093 Phase 2 Task 0 (A9) — collar display compliance gate.
-- Utah Admin. Code R657-5-7(4)(c)(v) prohibits using "protected" GPS/radio-
-- collar data to locate, track, take, or retrieve big game; "protected"
-- means a record classified protected under GRAMA 63G-2-305. Whether the
-- UDWR dataset backing FF-093 is "protected" is UNVERIFIED. Until answered,
-- ingest/aggregation (collarPatternExtractor.ts) may run regardless, but
-- every read/display path must check this switch before showing any
-- collar-derived window. This migration lands before any other Phase 2
-- work — see app code in collarCalibration.ts (isCollarDisplayAllowed) and
-- its callers in briefPayload.ts / the Strike page.
--
-- Idempotent, no CREATE POLICY. Service role bypasses RLS and needs none.

CREATE TABLE IF NOT EXISTS collar_compliance_switch (
  state_code text NOT NULL,
  use_type text NOT NULL CHECK (use_type IN ('live_positions', 'individual_tracks', 'aggregated_patterns')),
  display_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('prohibited', 'unknown', 'permitted')),
  basis text,
  reviewed_by text,
  reviewed_at timestamptz,
  PRIMARY KEY (state_code, use_type)
);

ALTER TABLE collar_compliance_switch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collar_compliance_switch FROM anon, authenticated;
-- No policies. Service role bypasses RLS. Do NOT add a USING (true) policy.

-- Seed: Utah. live_positions/individual_tracks are never stored or shown by
-- this app in this phase regardless of this switch (the app simply doesn't
-- have that data), but the rows are seeded prohibited/disabled for an
-- honest record. aggregated_patterns (what collar_pattern_library actually
-- holds) is the only use_type the app ever checks — status 'unknown',
-- display OFF, pending DWR records officer / counsel review. This is
-- Jason's explicit decision (2026-09-30): keep aggregated display OFF in
-- Utah until that review comes back.
INSERT INTO collar_compliance_switch (state_code, use_type, display_enabled, status, basis) VALUES
  ('UT', 'live_positions', false, 'prohibited', 'Utah Admin. Code R657-5-7(4)(c)(v) prohibits using protected GPS/radio-collar data to locate, track, take, or retrieve big game.'),
  ('UT', 'individual_tracks', false, 'prohibited', 'Utah Admin. Code R657-5-7(4)(c)(v); individual animal tracks carry the same locate/track risk as live positions for this purpose.'),
  ('UT', 'aggregated_patterns', false, 'unknown', 'Whether UDWR collar data is a "protected" record under GRAMA 63G-2-305 is unverified. Display held off pending DWR records officer / counsel review (Jason decision, 2026-09-30).')
ON CONFLICT (state_code, use_type) DO NOTHING;

-- Per-user override so Jason's own test accounts can preview the feature
-- without enabling display for everyone.
CREATE TABLE IF NOT EXISTS collar_display_testers (
  user_id uuid PRIMARY KEY
);

ALTER TABLE collar_display_testers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collar_display_testers FROM anon, authenticated;
-- No policies. Service role bypasses RLS.

-- Verification (not executed) — expected: zero rows.
-- SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'collar_%' OR tablename LIKE 'movebank_%';
