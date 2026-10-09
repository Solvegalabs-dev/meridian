-- FF-100: agents read the spot's own gauge and weather, and say where each reading came from.
-- Idempotent: safe to run twice. Written, NOT applied here: apply to the live project AND the new project.
-- Existing readings are not touched (no DELETE, no UPDATE on agent_signal_history).

-- 1. Where a reading came from. Old rows keep NULL.
--    gauge:    {"kind":"gauge","site_no":"...","site_name":"...","distance_mi":12.3}
--    forecast: {"kind":"forecast","provider":"NWS"}   (wind adds "gust_mph")
--    station:  {"kind":"station","station_id":"...","distance_mi":..,"change_inhg":..,"change_hours":..}
ALTER TABLE agent_signal_history ADD COLUMN IF NOT EXISTS source_detail jsonb;

-- 2. Water agents read the pin's own gauges (nearest first, up to five) instead of the Kenai River placeholder
--    (15266300). The runner picks the nearest gauge that reports the parameter. Thresholds are unchanged.
UPDATE agent_configs
SET source_url_template = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=00010&siteStatus=active'
WHERE agent_key = 'OUTDOOR_USGS_WATER_TEMP';

UPDATE agent_configs
SET source_url_template = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=00300&siteStatus=active'
WHERE agent_key = 'OUTDOOR_USGS_DISSOLVED_O2';

UPDATE agent_configs
SET source_url_template = 'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=63680&siteStatus=active'
WHERE agent_key = 'OUTDOOR_USGS_TURBIDITY';

-- 3. Streamflow from the pin's gauge. OUTDOOR_USGS_STREAMFLOW_STATE stays active for hunting objectives.
INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES (
  'OUTDOOR_USGS_STREAMFLOW_NEAR',
  'outdoor', 'elk_hunt',
  'USGS Streamflow (nearest gauge to the spot)',
  'Streamflow in cfs from the nearest USGS gauge to the active pin that reports it; records the gauge name and distance',
  'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=00060&siteStatus=active',
  'value_below', 100.0, NULL,
  1440, 'natural_disaster', 'ELK_HUNT:', true, false
)
ON CONFLICT (agent_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  source_url_template = EXCLUDED.source_url_template,
  is_active = true;

-- 4. NWS weather agents use the gridpoint hourly forecast, which exists (the old /observations path did not).
--    The runner records periods[0].temperature (F) and probabilityOfPrecipitation (percent). Thresholds are unchanged
--    and were designed for the old endpoints (percent change); they need a separate redesign.
UPDATE agent_configs
SET source_url_template = 'https://api.weather.gov/gridpoints/{nws_grid_office}/{nws_grid_x},{nws_grid_y}/forecast/hourly'
WHERE agent_key IN ('OUTDOOR_NOAA_TEMP', 'OUTDOOR_NOAA_PRECIP');

-- 5. Barometric pressure comes from the nearest NWS station's observations (lib/agents/nwsStationPressure.ts),
--    not the Grand Junction gridpoint URL.
UPDATE agent_configs
SET source_url_template = 'CALCULATED:nws_station_pressure',
    description = 'Barometric pressure in inHg from the nearest NWS station that reports it, with the change over the last few hours'
WHERE agent_key = 'OUTDOOR_NOAA_BAROMETRIC';

-- 6. Registry: new fishing objectives get the nearby-gauge streamflow agent and wind, not the state-level agent.
--    The registry stores FULL taxonomy keys and objectiveRouter matches the most specific key first, so short keys
--    like 'trout.rainbow' would never match. These are the keys in lib/strike/config/fishing-taxonomy.ts.
INSERT INTO agent_registry (agent_code, taxonomy_keys, geo_scope, data_source_url, requires_key, status)
VALUES (
  'OUTDOOR_USGS_STREAMFLOW_NEAR',
  ARRAY['salmon.king.river_migration', 'salmon.sockeye.river_migration', 'trout.rainbow.fly_fishing', 'trout.brown.fly_fishing'],
  'national',
  'https://waterservices.usgs.gov/nwis/iv/?format=json&sites={usgs_gauge_ids}&parameterCd=00060&siteStatus=active',
  false, 'live'
)
ON CONFLICT (agent_code) DO UPDATE SET taxonomy_keys = EXCLUDED.taxonomy_keys;

UPDATE agent_registry
SET taxonomy_keys = ARRAY(
  SELECT k FROM unnest(taxonomy_keys) AS k
  WHERE k NOT LIKE 'salmon%' AND k NOT LIKE 'trout%'
)
WHERE agent_code = 'OUTDOOR_USGS_STREAMFLOW_STATE';

UPDATE agent_registry
SET taxonomy_keys = ARRAY(
  SELECT DISTINCT k FROM unnest(taxonomy_keys || ARRAY['salmon.king.river_migration', 'salmon.sockeye.river_migration', 'trout.rainbow.fly_fishing', 'trout.brown.fly_fishing']) AS k
)
WHERE agent_code = 'OUTDOOR_WINDY_API';

-- 7. Existing fishing profiles. A fishing profile is objective_profiles.domain = 'fishing' (or a salmon.* / trout.*
--    taxonomy_key, the same test the app uses in lib/strike/objectiveKind.ts). Hunting profiles are not touched.
UPDATE objective_profiles
SET assigned_agents = array_replace(assigned_agents, 'OUTDOOR_USGS_STREAMFLOW_STATE', 'OUTDOOR_USGS_STREAMFLOW_NEAR')
WHERE (domain = 'fishing' OR taxonomy_key LIKE 'salmon.%' OR taxonomy_key LIKE 'trout.%')
  AND 'OUTDOOR_USGS_STREAMFLOW_STATE' = ANY(assigned_agents);

UPDATE objective_profiles
SET assigned_agents = array_append(assigned_agents, 'OUTDOOR_WINDY_API')
WHERE (domain = 'fishing' OR taxonomy_key LIKE 'salmon.%' OR taxonomy_key LIKE 'trout.%')
  AND assigned_agents IS NOT NULL
  AND NOT ('OUTDOOR_WINDY_API' = ANY(assigned_agents));
