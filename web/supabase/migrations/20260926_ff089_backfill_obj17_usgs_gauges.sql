-- FF-089 Fix 4: backfill OBJ-17 (Elizabeth Pass) USGS gauges.
-- Values from resolveFullGeography(40.948, -110.668), nearest first:
-- 09217900 Blacks Fork nr Robertson WY, 09218500 Blacks Fork nr Millburne WY,
-- 10011500 Bear River nr Utah-Wyoming state line, 09220000 East Fork Smiths Fork nr Robertson WY,
-- 09218850 Blacks Fork bl Blacks Fork Canal nr Robertson WY.
UPDATE objective_profiles
SET usgs_gauge_ids = ARRAY['09217900', '09218500', '10011500', '09220000', '09218850']
WHERE objective_id = '29d41c7a-22e8-4c05-ad8b-f391aed1d06c';
