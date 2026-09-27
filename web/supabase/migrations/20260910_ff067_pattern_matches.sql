-- FF-067 Pattern Deviation Engine — pattern_matches table
-- Stores computed year-by-year similarity scores per objective per domain.
-- Applied via Supabase MCP on 2026-09-10.

CREATE TABLE IF NOT EXISTS public.pattern_matches (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  objective_id uuid REFERENCES public.objectives(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  domain text NOT NULL,
  comparison_year int NOT NULL,
  similarity_score numeric(5,2) NOT NULL,
  matching_dimensions jsonb DEFAULT '[]'::jsonb,
  deviating_dimensions jsonb DEFAULT '[]'::jsonb,
  historical_outcome text,
  outcome_confidence int DEFAULT 0,
  pattern_label text,
  computed_at timestamptz DEFAULT now(),
  UNIQUE(objective_id, comparison_year, domain)
);

ALTER TABLE public.pattern_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY pattern_matches_select ON public.pattern_matches
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY pattern_matches_insert ON public.pattern_matches
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY pattern_matches_update ON public.pattern_matches
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
