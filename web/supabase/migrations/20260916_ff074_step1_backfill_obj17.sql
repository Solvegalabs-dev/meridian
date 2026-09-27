-- FF-074 Step 1: Backfill OBJ-17 (Elizabeth Pass) with NWS gridpoint
UPDATE objective_profiles
SET lat = 40.948,
    lon = -110.668,
    nws_grid_office = 'GJT',
    nws_grid_x = 69,
    nws_grid_y = 170
WHERE objective_id = '29d41c7a-22e8-4c05-ad8b-f391aed1d06c';
