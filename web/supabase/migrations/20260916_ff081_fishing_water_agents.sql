-- FF-081: Fishing Water Condition Agents
-- 4 agent_configs rows — USGS water quality gauges + NOAA barometric pressure
-- USGS site 15266300 = Kenai River near Soldotna, AK (placeholder; FF-074 parameterizes)

INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_USGS_WATER_TEMP',
    'outdoor', 'elk_hunt',
    'USGS Water Temperature',
    'Stream water temperature in °C — trout optimal ceiling 18.3°C (65°F); USGS always returns Celsius',
    'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=15266300&parameterCd=00010&siteStatus=active',
    'value_below', 18.3, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_USGS_DISSOLVED_O2',
    'outdoor', 'elk_hunt',
    'USGS Dissolved Oxygen',
    'Dissolved oxygen mg/L — below 7 indicates hypoxic stress for trout',
    'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=15266300&parameterCd=00300&siteStatus=active',
    'value_below', 7.0, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_NOAA_BAROMETRIC',
    'outdoor', 'elk_hunt',
    'NOAA Barometric Pressure Trend',
    'Barometric pressure change — 5% delta triggers fish feeding behavior window',
    'https://api.weather.gov/gridpoints/GJT/69,170/observations',
    'delta_pct', 5.0, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_USGS_TURBIDITY',
    'outdoor', 'elk_hunt',
    'USGS Turbidity Monitor',
    'Stream turbidity NTU — above 50 NTU renders water unfishable',
    'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=15266300&parameterCd=63680&siteStatus=active',
    'value_above', 50.0, NULL,
    1440, 'climate_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;
