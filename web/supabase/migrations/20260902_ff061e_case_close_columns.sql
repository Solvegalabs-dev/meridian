-- FF-061E: Case close columns on enterprise_cases
ALTER TABLE enterprise_cases
ADD COLUMN IF NOT EXISTS closed_at     timestamptz,
ADD COLUMN IF NOT EXISTS close_outcome text CHECK (close_outcome IN ('sold','off_market','relist','other')),
ADD COLUMN IF NOT EXISTS close_note    text;
