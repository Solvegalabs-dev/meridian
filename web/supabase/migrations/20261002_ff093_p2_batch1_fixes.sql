-- FF-093 Phase 2, Batch 1 fix round — adds stats to collar_jobs so a job's
-- outcome carries a diagnostic summary (counts only — never raw rows,
-- license text, or credentials). RLS/grants on collar_jobs are unchanged;
-- this is purely an additive column. Idempotent.

ALTER TABLE collar_jobs ADD COLUMN IF NOT EXISTS stats jsonb;

-- Expected shape (written by the job runner, see jobRunner.ts):
-- {
--   "rows_fetched": 1234,
--   "rows_species_match": 600,
--   "rows_in_radius": 580,
--   "top_taxon_names": [{"name": "Cervus elaphus", "count": 600}, ...],
--   "truncated": false,
--   "handshake": "not_required",
--   "elapsed_ms": 842
-- }
