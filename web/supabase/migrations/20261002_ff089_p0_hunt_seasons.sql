-- FF-089 P0 (season lifecycle) — hunt season data table.
--
-- Config data, not code. Season dates are never hard-coded in the app. This
-- migration ships the table EMPTY. Verified season rows (UDWR proclamation, with
-- source_url and source_checked_at) arrive as a separate data migration.
--
-- With no rows, an objective's season is "unknown" (not closed). The window
-- evaluator then relies on the trip window alone.
--
-- Idempotent. RLS on with NO policies, and anon/authenticated revoked, so only
-- the service role can read or write. Never USING (true).

CREATE TABLE IF NOT EXISTS hunt_seasons (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state              text NOT NULL,
  species            text NOT NULL,
  hunt_type          text NOT NULL,      -- 'archery' | 'any_weapon' | 'muzzleloader' | ...
  sex_class          text,               -- 'bull' | 'antlerless' | NULL = all sexes
  hunt_unit_id       text,               -- NULL = statewide / all units
  hunt_code          text,               -- e.g. 'EB1005' when the proclamation uses codes
  season_year        int  NOT NULL,
  season_start       date NOT NULL,
  season_end         date NOT NULL,
  source_url         text NOT NULL,
  source_checked_at  date NOT NULL,
  notes              text,
  CONSTRAINT hunt_seasons_dates_ordered CHECK (season_start <= season_end),
  CONSTRAINT hunt_seasons_identity UNIQUE (state, species, hunt_type, sex_class, hunt_unit_id, hunt_code, season_year, season_start)
);

ALTER TABLE hunt_seasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hunt_seasons FROM anon, authenticated;
