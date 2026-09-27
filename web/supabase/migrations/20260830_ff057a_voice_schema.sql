ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS voice_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_addon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voice_addon_activated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.voice_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sweep_id uuid REFERENCES sweeps(id),
  tasker_type text NOT NULL,
  objective_id uuid REFERENCES objectives(id),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE public.voice_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_tasks_owner" ON public.voice_tasks
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- Grant founder full voice access
UPDATE public.profiles
  SET voice_addon = true, voice_mode = true
  WHERE id = '817b615a-c2c5-4285-8763-bdea3e171e2d';
