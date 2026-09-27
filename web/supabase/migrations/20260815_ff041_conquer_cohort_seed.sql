-- FF-041 Phase 1 — Conquer Group Initial Cohort Seed
-- Solvega Labs LLC · Meridian Fusion · August 15, 2026
-- institution_id = 'a1b2c3d4-0000-0000-0000-000000000001' (Conquer Group)
-- ON CONFLICT DO NOTHING — safe to re-run.

INSERT INTO public.enterprise_cohort_definitions
  (institution_id, cohort_name, field_combination, signal_types,
   propagation_strength, approved_by)
VALUES
  (
    'a1b2c3d4-0000-0000-0000-000000000001',
    'Southeast Subprime 2019-2021 Vintage',
    '[
      {"field": "region",         "bucket_value": "Southeast"},
      {"field": "fico_band",      "bucket_value": "620-659"},
      {"field": "vintage_bucket", "bucket_value": "2019-2021"}
    ]'::jsonb,
    ARRAY['credit_conditions','labor_market','natural_disaster','energy_commodity'],
    'high',
    'Jason Moffat — proven from cold-ingest discovery Aug 2026'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000001',
    'High Stress Exposure — High DTI + Underwater LTV + Contract',
    '[
      {"field": "dti_bucket",      "bucket_value": "40-49%"},
      {"field": "ltv_bucket",      "bucket_value": "100-110%"},
      {"field": "employment_type", "bucket_value": "Contract"}
    ]'::jsonb,
    ARRAY['monetary_policy','labor_market','energy_commodity'],
    'high',
    'Jason Moffat — designed FF-041'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000001',
    'Used Truck Market Cohort',
    '[
      {"field": "vehicle_model_class", "bucket_value": "Truck"},
      {"field": "vehicle_condition",   "bucket_value": "Used"},
      {"field": "vintage_bucket",      "bucket_value": "2019-2021"}
    ]'::jsonb,
    ARRAY['vehicle_market','energy_commodity','supply_chain'],
    'high',
    'Jason Moffat — designed FF-041'
  ),
  (
    'a1b2c3d4-0000-0000-0000-000000000001',
    'Early Warning — Streak 0 + Prior 30DPD + Subprime',
    '[
      {"field": "payment_streak_bucket", "bucket_value": "0"},
      {"field": "times_30_dpd_bucket",   "bucket_value": "1+"},
      {"field": "fico_band",             "bucket_value": "620-659"}
    ]'::jsonb,
    ARRAY['labor_market','social_confidence','credit_conditions'],
    'medium',
    'Jason Moffat — designed FF-041'
  )
ON CONFLICT (institution_id, cohort_name) DO NOTHING;
