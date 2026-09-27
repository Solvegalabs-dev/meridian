ALTER TABLE objectives
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS archive_date date,
  ADD COLUMN IF NOT EXISTS estimated_reactivate_date date;
