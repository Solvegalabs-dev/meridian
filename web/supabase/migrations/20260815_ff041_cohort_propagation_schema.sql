-- FF-041 Phase 1 — Cohort Propagation Engine: Schema
-- Solvega Labs LLC · Meridian Fusion · August 15, 2026

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1: Add three columns to enterprise_macro_events
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.enterprise_macro_events
  ADD COLUMN IF NOT EXISTS event_duration_days integer,
  ADD COLUMN IF NOT EXISTS fema_declaration_id  text,
  ADD COLUMN IF NOT EXISTS employer_size_est    integer;

COMMENT ON COLUMN public.enterprise_macro_events.event_duration_days IS
  'For events spanning time (hurricanes, strikes, conflicts). Used to close signal window.';
COMMENT ON COLUMN public.enterprise_macro_events.fema_declaration_id IS
  'Natural disaster events only. FEMA declaration number for verifiable sourcing.';
COMMENT ON COLUMN public.enterprise_macro_events.employer_size_est IS
  'Major employer events. Estimated jobs affected. Auto-feeds magnitude scoring.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2: enterprise_cohort_definitions
-- Defines approved signal propagation cohorts per institution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enterprise_cohort_definitions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        uuid NOT NULL REFERENCES public.enterprise_institutions(id) ON DELETE CASCADE,
  cohort_name           text NOT NULL,
  -- field_combination is an array of {field, bucket_value} objects.
  -- Example: [{"field":"region","bucket_value":"Southeast"},
  --           {"field":"fico_band","bucket_value":"620-659"},
  --           {"field":"vintage_bucket","bucket_value":"2019-2021"}]
  field_combination     jsonb NOT NULL,
  signal_types          text[] NOT NULL DEFAULT '{}',
  propagation_strength  text NOT NULL DEFAULT 'medium'
                          CHECK (propagation_strength IN ('high','medium','low')),
  is_active             boolean NOT NULL DEFAULT true,
  approved_by           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (institution_id, cohort_name)
);

CREATE INDEX IF NOT EXISTS idx_cohort_defs_institution
  ON public.enterprise_cohort_definitions (institution_id)
  WHERE is_active = true;

ALTER TABLE public.enterprise_cohort_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_cohort_defs"
  ON public.enterprise_cohort_definitions
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "institution_members_read_cohort_defs"
  ON public.enterprise_cohort_definitions
  FOR SELECT
  USING (institution_id = get_user_institution_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3: enterprise_cohort_candidates
-- Auto-discovered candidate cohorts awaiting admin review.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enterprise_cohort_candidates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        uuid NOT NULL REFERENCES public.enterprise_institutions(id) ON DELETE CASCADE,
  proposed_name         text,
  field_combination     jsonb NOT NULL,
  trigger_count         integer NOT NULL DEFAULT 1,
  confidence_delta_avg  numeric(5,2),
  confidence_delta_std  numeric(5,2),
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  reviewed_by           text,
  reviewed_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cohort_candidates_institution_status
  ON public.enterprise_cohort_candidates (institution_id, status);

ALTER TABLE public.enterprise_cohort_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_cohort_candidates"
  ON public.enterprise_cohort_candidates
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "institution_members_read_cohort_candidates"
  ON public.enterprise_cohort_candidates
  FOR SELECT
  USING (institution_id = get_user_institution_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4: enterprise_field_candidates
-- Uncaptured field concepts found in sweep signals.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enterprise_field_candidates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id          uuid NOT NULL REFERENCES public.enterprise_institutions(id) ON DELETE CASCADE,
  concept_name            text NOT NULL,
  occurrence_count        integer NOT NULL DEFAULT 1,
  example_signal_text     text,
  macro_event_categories  text[] NOT NULL DEFAULT '{}',
  is_in_macro_events      boolean NOT NULL DEFAULT false,
  schema_change_required  boolean NOT NULL DEFAULT false,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','linked','schema_added','dismissed')),
  first_seen_at           timestamptz NOT NULL DEFAULT now(),
  last_seen_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_field_candidates_institution_status
  ON public.enterprise_field_candidates (institution_id, status);

ALTER TABLE public.enterprise_field_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_field_candidates"
  ON public.enterprise_field_candidates
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "institution_members_read_field_candidates"
  ON public.enterprise_field_candidates
  FOR SELECT
  USING (institution_id = get_user_institution_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5: enterprise_sweep_signals
-- Signal cache from completed sweeps. Powers propagation lookup.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enterprise_sweep_signals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id        uuid NOT NULL REFERENCES public.enterprise_institutions(id) ON DELETE CASCADE,
  sweep_id              uuid REFERENCES public.enterprise_sweeps(id) ON DELETE SET NULL,
  signal_type           text NOT NULL,
  -- cohort_key is the field combination this signal applies to.
  -- Example: {"region":"Southeast","fico_band":"620-659"}
  -- NULL means signal applies to entire institution portfolio.
  cohort_key            jsonb,
  signal_body           text NOT NULL,
  magnitude             integer NOT NULL DEFAULT 3 CHECK (magnitude BETWEEN 1 AND 5),
  direction             text NOT NULL CHECK (direction IN ('positive','negative','neutral')),
  applies_to_case_count integer,
  -- expires_at defaults to 48 hours. Override for persistent events
  -- (natural disasters, conflicts) by setting event_duration_days.
  expires_at            timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sweep_signals_institution_active
  ON public.enterprise_sweep_signals (institution_id, expires_at)
  WHERE expires_at > now();

CREATE INDEX IF NOT EXISTS idx_sweep_signals_cohort
  ON public.enterprise_sweep_signals USING gin (cohort_key);

ALTER TABLE public.enterprise_sweep_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_sweep_signals"
  ON public.enterprise_sweep_signals
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "institution_members_read_sweep_signals"
  ON public.enterprise_sweep_signals
  FOR SELECT
  USING (institution_id = get_user_institution_id());

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 6: enterprise_case_cohort_membership
-- Pre-computed cohort membership. Rebuilt on ingest and when definitions change.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enterprise_case_cohort_membership (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid NOT NULL REFERENCES public.enterprise_institutions(id) ON DELETE CASCADE,
  case_id        uuid NOT NULL REFERENCES public.enterprise_cases(id) ON DELETE CASCADE,
  cohort_id      uuid NOT NULL REFERENCES public.enterprise_cohort_definitions(id) ON DELETE CASCADE,
  computed_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, cohort_id)
);

CREATE INDEX IF NOT EXISTS idx_case_cohort_membership_institution
  ON public.enterprise_case_cohort_membership (institution_id, cohort_id);

CREATE INDEX IF NOT EXISTS idx_case_cohort_membership_case
  ON public.enterprise_case_cohort_membership (case_id);

ALTER TABLE public.enterprise_case_cohort_membership ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_case_cohort"
  ON public.enterprise_case_cohort_membership
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "institution_members_read_case_cohort"
  ON public.enterprise_case_cohort_membership
  FOR SELECT
  USING (institution_id = get_user_institution_id());
