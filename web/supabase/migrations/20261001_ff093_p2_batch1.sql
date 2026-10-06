-- FF-093 Phase 2, Batch 1 — migration, lease, catalog cache, job runner.
-- Per FF093_Phase2_Collar_Swarm_Spec_v2.md section 4 + AMENDMENTS v2 (A1,
-- A4, A5, A7, A8). Task 0 (compliance gate, collar_compliance_switch /
-- collar_display_testers) already shipped in a prior migration — not
-- repeated here. Idempotent, no CREATE POLICY, nothing granted to
-- anon/authenticated.

-- ============================================================
-- movebank_study_catalog — weekly-refreshed cache of the study list, so the
-- planner (Batch 2) never re-downloads the ~20k-row catalog on the hot path.
-- ============================================================
CREATE TABLE IF NOT EXISTS movebank_study_catalog (
  study_id bigint PRIMARY KEY,
  name text,
  main_lat numeric,
  main_lon numeric,
  number_of_individuals int,
  taxon_ids text,
  license_type text,
  citation text,
  has_download_access boolean,
  timestamp_first timestamptz,
  timestamp_last timestamptz,
  fetched_at timestamptz DEFAULT now()
);

ALTER TABLE movebank_study_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON movebank_study_catalog FROM anon, authenticated;

-- ============================================================
-- species_analogs — A8: elk <-> mule deer only. Whitetail removed (0
-- studies within 500km of Utah); moose/caribou/pronghorn have no analog.
-- Keys match MOVEBANK_TAXON_NAMES / resolveMovebankTaxon's speciesTaxonKey
-- convention ('elk.<sub>' stays per-sub, so the generic 'elk' prefix is used
-- here as the species family key the planner matches against).
-- ============================================================
CREATE TABLE IF NOT EXISTS species_analogs (
  species_taxon_key text NOT NULL,
  analog_taxon_key text NOT NULL,
  priority int NOT NULL DEFAULT 1,
  note text,
  PRIMARY KEY (species_taxon_key, analog_taxon_key)
);

ALTER TABLE species_analogs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON species_analogs FROM anon, authenticated;

INSERT INTO species_analogs (species_taxon_key, analog_taxon_key, priority, note) VALUES
  ('elk', 'deer.mule', 1, 'A8 — same UDWR multi-species studies often cover both; analog path may rarely trigger in Utah.'),
  ('deer.mule', 'elk', 1, 'A8 — reciprocal of the elk -> mule deer analog.')
ON CONFLICT (species_taxon_key, analog_taxon_key) DO NOTHING;

-- ============================================================
-- collar_jobs — one job = (objective, species, study, time window). A1: job
-- unit is (study, window), not (study) — a whole-study request timed out at
-- ~31s against a 2,695-individual / 4.89M-fix study.
-- ============================================================
CREATE TABLE IF NOT EXISTS collar_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid NOT NULL,
  species_taxon_key text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary', 'analog')),
  study_id bigint NOT NULL,
  geo_hash text NOT NULL,
  local_tz text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  split_depth int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE (objective_id, species_taxon_key, study_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_collar_jobs_status_run_after ON collar_jobs (status, run_after);

ALTER TABLE collar_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collar_jobs FROM anon, authenticated;

-- Atomic claim: the oldest queued, due job, skipping rows other workers
-- have locked. In practice the single global movebank_lease already
-- prevents more than one worker from reaching this point at a time, but
-- this is the real guard against any overlap (e.g. a slow invocation still
-- running when a new cron tick fires before the lease TTL catches it).
-- Returns a row of NULLs (not a true NULL) when nothing is claimable —
-- callers must check claimed.id IS NULL.
CREATE OR REPLACE FUNCTION claim_collar_job()
RETURNS collar_jobs
LANGUAGE plpgsql
AS $$
DECLARE
  claimed collar_jobs;
BEGIN
  UPDATE collar_jobs
  SET status = 'running',
      started_at = now(),
      locked_until = now() + interval '280 seconds',
      attempts = attempts + 1
  WHERE id = (
    SELECT id FROM collar_jobs
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY run_after
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING * INTO claimed;

  RETURN claimed;
END;
$$;

-- This function is reachable via PostgREST's /rpc/ endpoint by default —
-- revoke explicitly so only the service role (which bypasses grants
-- entirely) can call it. Never let anon/authenticated claim/run jobs.
REVOKE ALL ON FUNCTION claim_collar_job() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- collar_study_aggregates — compact per-(study, geo, window) aggregates.
-- Raw GPS fixes are never persisted; hourly_counts is the only per-fix
-- derived data kept. A7: years_present records which distinct years
-- actually have fixes for season-coverage honesty in the reducer (Batch 2).
-- ============================================================
CREATE TABLE IF NOT EXISTS collar_study_aggregates (
  study_id bigint NOT NULL,
  species_taxon_key text NOT NULL,
  geo_hash text NOT NULL,
  local_tz text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  hourly_counts jsonb NOT NULL,     -- {"1": [24 ints], ... "12": [24 ints]} — local hour-of-day by month
  years_present int[],
  n_fixes int,
  n_individuals int,
  event_radius_km int,
  elev_samples int[],
  first_ts timestamptz,
  last_ts timestamptz,
  license_type text,
  citation text,
  computed_at timestamptz DEFAULT now(),
  PRIMARY KEY (study_id, geo_hash, local_tz, window_start, window_end)
);

ALTER TABLE collar_study_aggregates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collar_study_aggregates FROM anon, authenticated;

-- ============================================================
-- movebank_lease — single global lock serializing every Movebank call
-- across all workers. A4: cooldown_until additionally blocks acquisition
-- after an abort/timeout/429/5xx, independent of whether the lease itself
-- is held.
-- ============================================================
CREATE TABLE IF NOT EXISTS movebank_lease (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  locked_until timestamptz,
  holder text,
  cooldown_until timestamptz
);

ALTER TABLE movebank_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON movebank_lease FROM anon, authenticated;

INSERT INTO movebank_lease (id, locked_until, holder, cooldown_until)
VALUES (1, NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- A5 — record which mechanism produced a license_acceptances row. Movebank
-- remembers acceptance per account, so the handshake stops reappearing
-- after the first real download; without this, studies accepted via a
-- metadata-only fetch (first job for a study, A5) would never get an
-- audit row at all.
-- ============================================================
ALTER TABLE movebank_license_acceptances ADD COLUMN IF NOT EXISTS source text DEFAULT 'handshake';

-- ============================================================
-- collar_pattern_library additions the Batch 2 reducer will populate.
-- ============================================================
ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS pattern_basis text DEFAULT 'direct';
ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS analog_of text;
ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS corroboration text;
ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS seasons_covered int;
ALTER TABLE collar_pattern_library ADD COLUMN IF NOT EXISTS years_present int[];

-- ============================================================
-- Monitoring view — counts by status and species.
-- ============================================================
CREATE OR REPLACE VIEW collar_job_status AS
SELECT species_taxon_key, status, count(*) AS job_count
FROM collar_jobs
GROUP BY species_taxon_key, status
ORDER BY species_taxon_key, status;

-- Views have their own grant semantics independent of the base table's RLS
-- (a view runs with its owner's privileges unless security_invoker is set) —
-- revoke explicitly rather than assume collar_jobs' RLS alone protects it.
REVOKE ALL ON collar_job_status FROM anon, authenticated;

-- Verification (not executed) — expected: zero rows.
-- SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'collar_%' OR tablename LIKE 'movebank_%';
