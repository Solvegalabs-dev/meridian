-- FF-093 addendum (2026-09-30): audit trail for Movebank license terms
-- accepted on Jason's account on behalf of this product. Idempotent, no
-- CREATE POLICY — service role bypasses RLS and needs none; anon/authenticated
-- get nothing.

CREATE TABLE IF NOT EXISTS movebank_license_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id bigint NOT NULL,
  license_type text,
  license_md5 text NOT NULL,
  license_text text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, license_md5)
);

ALTER TABLE movebank_license_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON movebank_license_acceptances FROM anon, authenticated;
-- No policies. Service role bypasses RLS. Do NOT add a USING (true) policy.
