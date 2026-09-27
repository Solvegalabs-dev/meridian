-- Engine 4 Step 11 — Prediction Closure Synthesis
-- Adds closure_synthesis (Claude-generated arc narrative) to prediction_scores
-- and resolved_at (when the prediction was definitively closed) to predictions.

ALTER TABLE prediction_scores ADD COLUMN IF NOT EXISTS closure_synthesis jsonb;
ALTER TABLE predictions ADD COLUMN IF NOT EXISTS resolved_at timestamptz;
