ALTER TABLE public.sweeps
  ADD COLUMN IF NOT EXISTS voice_brief jsonb;
