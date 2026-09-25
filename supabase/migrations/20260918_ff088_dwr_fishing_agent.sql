-- FF-088 PR 2: Add Utah DWR fishing forecast agent to agent_configs + agent_registry

INSERT INTO agent_configs (
  agent_key,
  vertical,
  domain,
  display_name,
  source_url_template,
  threshold_type,
  threshold_value,
  threshold_keywords,
  cadence_minutes,
  geo_scope,
  event_category,
  event_source_prefix,
  is_active,
  requires_ai
) VALUES (
  'OUTDOOR_DWR_FISHING_FORECAST_UT',
  'outdoor',
  'fishing',
  'Utah DWR Fishing Reports',
  'https://wildlife.utah.gov/fishing-reports/',
  'keyword_match',
  NULL,
  ARRAY['open', 'fishing', 'report', 'conditions', 'access'],
  1440,
  ARRAY['UT'],
  'policy_regulatory',
  'ELK_HUNT:',
  true,
  false
) ON CONFLICT (agent_key) DO NOTHING;

INSERT INTO agent_registry (
  agent_code,
  taxonomy_keys,
  geo_scope,
  data_source_url,
  requires_key,
  status
) VALUES (
  'OUTDOOR_DWR_FISHING_FORECAST_UT',
  ARRAY['trout.rainbow.fly_fishing', 'trout.brown.fly_fishing'],
  'UT',
  'https://wildlife.utah.gov/fishing-reports/',
  false,
  'active'
) ON CONFLICT (agent_code) DO NOTHING;
