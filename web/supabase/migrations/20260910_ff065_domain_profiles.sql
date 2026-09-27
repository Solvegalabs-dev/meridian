-- FF-065: domain_profiles — persistent domain knowledge per objective/domain pair.
-- Applied via Supabase MCP apply_migration on 2026-09-10.

CREATE TABLE IF NOT EXISTS public.domain_profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  objective_id uuid REFERENCES public.objectives(id) ON DELETE CASCADE NOT NULL,
  domain text NOT NULL,
  profile_version int DEFAULT 1,
  named_entities jsonb DEFAULT '[]'::jsonb,
  key_data_sources jsonb DEFAULT '[]'::jsonb,
  signal_taxonomy jsonb DEFAULT '[]'::jsonb,
  geographic_scope jsonb DEFAULT '{}'::jsonb,
  expansion_rules jsonb DEFAULT '{}'::jsonb,
  last_enriched_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(objective_id, domain)
);

ALTER TABLE public.domain_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY domain_profiles_select ON public.domain_profiles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY domain_profiles_insert ON public.domain_profiles
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY domain_profiles_update ON public.domain_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
