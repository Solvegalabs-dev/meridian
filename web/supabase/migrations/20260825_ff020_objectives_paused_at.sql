-- FF-020: Pause Goal — add paused_at timestamp to objectives
-- status column is plain text; no enum change required.
ALTER TABLE public.objectives ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ;
