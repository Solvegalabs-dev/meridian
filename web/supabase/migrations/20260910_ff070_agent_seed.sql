-- Universal Agents (10) — vertical='universal', domain='universal'
INSERT INTO agent_configs (agent_key, vertical, domain, display_name, source_url_template, threshold_type, threshold_value, cadence_minutes, event_category, event_source_prefix, is_active, requires_ai)
VALUES
  ('UNIV_FRED_UNEMPLOYMENT', 'universal', 'universal', 'National Unemployment Rate',
   'https://api.stlouisfed.org/fred/series/observations?series_id=UNRATE&api_key=FRED_API_KEY&sort_order=desc&limit=2&file_type=json',
   'delta_pct', 0.5, 10080, 'labor_market', 'UNIVERSAL:', true, false),

  ('UNIV_FRED_CPI', 'universal', 'universal', 'CPI Inflation Rate',
   'https://api.stlouisfed.org/fred/series/observations?series_id=CPIAUCSL&api_key=FRED_API_KEY&sort_order=desc&limit=2&file_type=json',
   'delta_pct', 0.3, 10080, 'inflation', 'UNIVERSAL:', true, false),

  ('UNIV_FRED_FEDRATE', 'universal', 'universal', 'Federal Funds Rate',
   'https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=FRED_API_KEY&sort_order=desc&limit=2&file_type=json',
   'delta_pct', 1.0, 10080, 'monetary_policy', 'UNIVERSAL:', true, false),

  ('UNIV_NOAA_DROUGHT_NATIONAL', 'universal', 'universal', 'National Drought Monitor',
   'https://usdmdataservices.unl.edu/api/USStatistics/GetDroughtSeverityStatisticsByArea?aoi=national&startdate={date_minus_7}&enddate={date_today}&statisticsType=1',
   'value_above', 20.0, 1440, 'natural_disaster', 'UNIVERSAL:', true, false),

  ('UNIV_BLS_JOBSREPORT', 'universal', 'universal', 'BLS Jobs Report',
   'https://api.bls.gov/publicAPI/v2/timeseries/data/CES0000000001',
   'new_record', NULL, 10080, 'labor_market', 'UNIVERSAL:', true, false),

  ('UNIV_EIA_GASPRICES', 'universal', 'universal', 'EIA Weekly Gas Prices',
   'https://api.eia.gov/v2/petroleum/pri/gnd/data/?api_key=EIA_API_KEY&frequency=weekly&data[0]=value&sort[0][column]=period&sort[0][direction]=desc&length=2',
   'delta_pct', 2.0, 10080, 'energy_commodity', 'UNIVERSAL:', true, false),

  ('UNIV_GDELT_DOMAIN', 'universal', 'universal', 'GDELT Domain Event Monitor',
   'https://api.gdeltproject.org/api/v2/doc/doc?query={domain_keyword}&mode=artlist&maxrecords=5&format=json',
   'new_record', NULL, 1440, 'geopolitical', 'UNIVERSAL:', true, false),

  ('UNIV_FRED_CONSUMER_SENTIMENT', 'universal', 'universal', 'Consumer Sentiment Index',
   'https://api.stlouisfed.org/fred/series/observations?series_id=UMCSENT&api_key=FRED_API_KEY&sort_order=desc&limit=2&file_type=json',
   'delta_pct', 2.0, 10080, 'social_confidence', 'UNIVERSAL:', true, false),

  ('UNIV_USGS_STREAMFLOW', 'universal', 'universal', 'USGS Streamflow Monitor',
   'https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd={state}&parameterCd=00060&siteStatus=active',
   'value_below', 100.0, 1440, 'natural_disaster', 'UNIVERSAL:', true, false),

  ('UNIV_FRED_HOUSING_STARTS', 'universal', 'universal', 'Housing Starts',
   'https://api.stlouisfed.org/fred/series/observations?series_id=HOUST&api_key=FRED_API_KEY&sort_order=desc&limit=2&file_type=json',
   'delta_pct', 5.0, 10080, 'housing_real_estate', 'UNIVERSAL:', true, false)

ON CONFLICT (agent_key) DO NOTHING;

-- Outdoor / Elk Hunt Agents (15) — vertical='outdoor', domain='elk_hunt'
INSERT INTO agent_configs (agent_key, vertical, domain, display_name, source_url_template, threshold_type, threshold_value, threshold_keywords, cadence_minutes, event_category, event_source_prefix, is_active, requires_ai)
VALUES
  ('OUTDOOR_NOAA_DROUGHT_STATE', 'outdoor', 'elk_hunt', 'State Drought Monitor',
   'https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByArea?aoi={state}&startdate={date_minus_7}&enddate={date_today}&statisticsType=1',
   'value_above', 20.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_NOAA_DROUGHT_COUNTY', 'outdoor', 'elk_hunt', 'County Drought Monitor',
   'https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByArea?aoi={state}&startdate={date_minus_7}&enddate={date_today}&statisticsType=1',
   'value_above', 20.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_NOAA_PRECIP', 'outdoor', 'elk_hunt', 'NOAA Precipitation Anomaly',
   'https://www.ncei.noaa.gov/cdo-web/api/v2/data?datasetid=GHCND&stationid=GHCND:{station_id}&datatypeid=PRCP&startdate={date_minus_30}&enddate={date_today}&limit=30',
   'delta_pct', 25.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_NOAA_TEMP', 'outdoor', 'elk_hunt', 'NOAA Temperature Anomaly',
   'https://www.ncei.noaa.gov/cdo-web/api/v2/data?datasetid=GHCND&stationid=GHCND:{station_id}&datatypeid=TMAX&startdate={date_minus_30}&enddate={date_today}&limit=30',
   'delta_pct', 10.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_USGS_SNOWPACK', 'outdoor', 'elk_hunt', 'USGS Snowpack / SWE Monitor',
   'https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd={state}&parameterCd=01350&siteStatus=active',
   'delta_pct', 15.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_USGS_STREAMFLOW_STATE', 'outdoor', 'elk_hunt', 'State Streamflow (Water Source Proxy)',
   'https://waterservices.usgs.gov/nwis/iv/?format=json&stateCd={state}&parameterCd=00060&siteStatus=active',
   'value_below', 100.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_DWR_HARVEST_UT', 'outdoor', 'elk_hunt', 'Utah DWR Elk Harvest Report',
   'https://wildlife.utah.gov/dwr/hunting/permits-draws/harvest-reports.html',
   'new_record', NULL, NULL, 10080, 'policy_regulatory', 'ELK_HUNT:', true, false),

  ('OUTDOOR_DWR_PERMITS_UT', 'outdoor', 'elk_hunt', 'Utah DWR Antlerless Permits',
   'https://wildlife.utah.gov/dwr/hunting/permits-draws/elk.html',
   'new_record', NULL, NULL, 10080, 'policy_regulatory', 'ELK_HUNT:', true, false),

  ('OUTDOOR_NRCS_SNOTEL', 'outdoor', 'elk_hunt', 'NRCS SNOTEL Snowpack',
   'https://wcc.sc.egov.usda.gov/reportGenerator/view_csv/customSingleStationReport/daily/{station_id}:-1:SNTL|name,WTEQ::value,PREC::value',
   'delta_pct', 15.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_NOAA_FIRE_RISK', 'outdoor', 'elk_hunt', 'NOAA Fire Weather Outlook',
   'https://www.spc.noaa.gov/products/fire_wx/fwdy1.html',
   'keyword_match', NULL, ARRAY['CRITICAL', 'EXTREME', 'HIGH', 'elevated fire'], 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_USFS_CLOSURE', 'outdoor', 'elk_hunt', 'USFS Road/Area Closure Monitor',
   'https://www.fs.usda.gov/alerts/ashley/alerts-notices',
   'keyword_match', NULL, ARRAY['closure', 'closed', 'restricted', 'road closed', 'area closed'], 1440, 'policy_regulatory', 'ELK_HUNT:', true, false),

  ('OUTDOOR_WINDY_API', 'outdoor', 'elk_hunt', 'Wind Pattern Monitor',
   'https://api.windy.com/api/point-forecast/v2',
   'value_above', 30.0, NULL, 1440, 'natural_disaster', 'ELK_HUNT:', true, false),

  ('OUTDOOR_MOON_PHASE', 'outdoor', 'elk_hunt', 'Moon Phase Calculator',
   'https://api.farmsense.net/v1/moonphases/?d={unix_timestamp}',
   'new_record', NULL, NULL, 1440, 'climate_regulatory', 'ELK_HUNT:', true, false),

  ('OUTDOOR_CATTLE_GRAZING', 'outdoor', 'elk_hunt', 'Grazing Allotment Pull-off Monitor',
   'https://www.fs.usda.gov/detail/ashley/landmanagement/resourcemanagement/?cid=stelprdb5200672',
   'keyword_match', NULL, ARRAY['removal', 'pull-off', 'cattle removed', 'grazing ended', 'allotment closed'], 10080, 'climate_regulatory', 'ELK_HUNT:', true, false),

  ('OUTDOOR_INAT_OBSERVATIONS', 'outdoor', 'elk_hunt', 'iNaturalist Species Observations',
   'https://api.inaturalist.org/v1/observations?taxon_name=Cervus+canadensis&place_id={place_id}&d1={date_minus_30}&d2={date_today}&per_page=10',
   'new_record', NULL, NULL, 1440, 'climate_regulatory', 'ELK_HUNT:', true, false)

ON CONFLICT (agent_key) DO NOTHING;
