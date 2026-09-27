-- FF-046: Add closure_type column to objectives
-- Routes (abandon/complete) already write this; column was missing from schema.
ALTER TABLE public.objectives ADD COLUMN IF NOT EXISTS closure_type text;
