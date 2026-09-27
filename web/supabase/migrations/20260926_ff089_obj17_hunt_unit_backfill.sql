-- FF-089: backfill OBJ-17 (Elizabeth Pass, 40.948, -110.668) hunt unit.
-- findHuntUnit(40.948, -110.668, 'UT') → 'north-slope-summit' (general_bull layer; the point is
-- in no limited_entry or spike_only unit). Confirmed by the DWR ArcGIS spatial query.
-- Apply after 20260926_ff089_utah_elk_hunt_units.sql.
UPDATE objective_profiles
SET hunt_unit_id = 'north-slope-summit'
WHERE objective_id = '29d41c7a-22e8-4c05-ad8b-f391aed1d06c';
