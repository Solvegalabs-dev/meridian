-- FF-074 Step 5: Parameterize NOAA agent URLs with NWS grid placeholders
UPDATE agent_configs
SET source_url_template = 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/observations'
WHERE agent_key IN ('OUTDOOR_NOAA_TEMP', 'OUTDOOR_NOAA_PRECIP');

UPDATE agent_configs
SET source_url_template = 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast'
WHERE agent_key = 'OUTDOOR_WINDY_API';
