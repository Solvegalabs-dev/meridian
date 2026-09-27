-- FF-082: Fishing Run Timing & Regulatory Intelligence
-- 3 agent_configs rows — USACE ladder counts, ADF&G sonar passage, Utah DWR stocking

INSERT INTO agent_configs (
  agent_key, vertical, domain, display_name, description,
  source_url_template, threshold_type, threshold_value, threshold_keywords,
  cadence_minutes, event_category, event_source_prefix, is_active, requires_ai
)
VALUES
  (
    'OUTDOOR_USACE_BONNEVILLE',
    'outdoor', 'elk_hunt',
    'USACE Bonneville Ladder Count',
    'Columbia River adult salmon passage at Bonneville Dam — daily count above 1000 signals active run',
    'https://www.cbr.washington.edu/dart/cs/php/rpt/adult_annual.php?sc=1&outputFormat=csv&year=2026&proj=BON&species=1&run=1&span=no&startdate=1%2F1&enddate=12%2F31',
    'value_above', 1000.0, NULL,
    1440, 'policy_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_ADFG_SONAR',
    'outdoor', 'elk_hunt',
    'ADF&G Sonar Passage Counts',
    'Alaska DFG sonar fish passage counts — keyword match on species and count data',
    'https://www.adfg.alaska.gov/sf/FishCounts/index.cfm?ADFG=fishdatainput.countlist',
    'keyword_match', NULL,
    ARRAY['sockeye', 'chinook', 'coho', 'passage', 'count', 'escapement'],
    1440, 'policy_regulatory', 'ELK_HUNT:', true, false
  ),

  (
    'OUTDOOR_UDWR_STOCKING',
    'outdoor', 'elk_hunt',
    'Utah DWR Stocking Report',
    'Utah Division of Wildlife Resources stocking report — keyword match on stocking events',
    'https://wildlife.utah.gov/fishing/stocking-report',
    'keyword_match', NULL,
    ARRAY['stocked', 'stocking', 'planted', 'rainbow', 'brown trout', 'cutthroat', 'brook trout'],
    10080, 'policy_regulatory', 'ELK_HUNT:', true, false
  )

ON CONFLICT (agent_key) DO NOTHING;
