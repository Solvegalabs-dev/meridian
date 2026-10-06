-- FF-092 Part 3 (schema): partners and partner API keys.
--
-- Idempotent. RLS on with NO policies, and anon/authenticated revoked for every new table:
-- only the service role reads or writes. A partner key is hashed (SHA-256 hex); the raw key
-- is shown once by scripts/issue-partner-key.mjs and never stored.
--
-- No key is seeded here. Keys are issued by Meridian (see docs/partner-integration.md).

-- 1. Partners -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partners (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               text NOT NULL UNIQUE,
  name               text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  rate_limit_per_min int  NOT NULL DEFAULT 60,
  -- Service owner: the one profile that holds this partner's objectives (objectives.user_id is
  -- NOT NULL). It is never a customer and never a person who signs in as a customer.
  -- Set by hand after the profile exists. NULL means the partner create path returns 503.
  owner_user_id      uuid REFERENCES profiles(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partners FROM anon, authenticated;

INSERT INTO partners (slug, name)
VALUES ('basemaps', 'BaseMaps')
ON CONFLICT (slug) DO NOTHING;

-- 2. Keys -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  key_hash     text NOT NULL UNIQUE,
  key_prefix   text,              -- first 8 characters of the key, for identifying it in a list
  label        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS partner_api_keys_partner_idx ON partner_api_keys (partner_id);

ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON partner_api_keys FROM anon, authenticated;

-- 3. Partner ownership on objective profiles ------------------------------------

ALTER TABLE objective_profiles
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id),
  ADD COLUMN IF NOT EXISTS partner_user_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'objective_profiles_partner_user_ref_length'
  ) THEN
    ALTER TABLE objective_profiles
      ADD CONSTRAINT objective_profiles_partner_user_ref_length
      CHECK (partner_user_ref IS NULL OR char_length(partner_user_ref) <= 128);
  END IF;
END
$$;

-- partner_user_ref is the partner's opaque id for its customer. Never an email or a name.
CREATE INDEX IF NOT EXISTS objective_profiles_partner_ref_idx
  ON objective_profiles (partner_id, partner_user_ref);
