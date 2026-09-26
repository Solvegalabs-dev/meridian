-- FF-089 Step 5: Regulatory agent seeding — Utah elk
-- event_category / event_source_prefix are NOT NULL with no default; values match
-- the existing elk regulatory agents (OUTDOOR_USFS_CLOSURE, OUTDOOR_UDWR_STOCKING).
-- Spec URLs /hunting/big-game/elk and /hunting/closures return 404 (checked 2026-09-26);
-- replaced with /biggame (big game hub, links elk season/permit pages) and /guidebooks
-- (hosts DWR emergency changes / closures).
INSERT INTO agent_configs (agent_key, display_name, vertical, domain, source_url_template, threshold_type, threshold_keywords, cadence_minutes, event_category, event_source_prefix, is_active, requires_ai)
VALUES
('OUTDOOR_REGS_UT_ELK_SEASON', 'Utah Elk Season Dates', 'outdoor', 'elk_hunt',
 'https://wildlife.utah.gov/biggame', 'keyword_match',
 ARRAY['season', 'archery', 'rifle', 'open', 'closes', 'September', 'October'],
 720, 'policy_regulatory', 'ELK_HUNT:', true, false),
('OUTDOOR_REGS_UT_ELK_PERMITS', 'Utah Elk Permit Availability', 'outdoor', 'elk_hunt',
 'https://wildlife.utah.gov/remainingpermits', 'keyword_match',
 ARRAY['elk', 'permit', 'available', 'remaining', 'antlerless', 'bull'],
 720, 'policy_regulatory', 'ELK_HUNT:', true, false),
('OUTDOOR_REGS_UT_ELK_CLOSURES', 'Utah Elk Area Closures', 'outdoor', 'elk_hunt',
 'https://wildlife.utah.gov/guidebooks', 'keyword_match',
 ARRAY['closure', 'closed', 'restricted', 'elk', 'emergency'],
 360, 'policy_regulatory', 'ELK_HUNT:', true, false)
ON CONFLICT (agent_key) DO NOTHING;

-- regulatory_registry has no unique constraint — guard each row with NOT EXISTS
INSERT INTO regulatory_registry (state, species, unit_id, regulation_type, source_url, agent_key)
SELECT v.state, v.species, NULL, v.regulation_type, v.source_url, v.agent_key
FROM (VALUES
  ('UT', 'elk', 'season_dates',        'https://wildlife.utah.gov/biggame',          'OUTDOOR_REGS_UT_ELK_SEASON'),
  ('UT', 'elk', 'permit_availability', 'https://wildlife.utah.gov/remainingpermits', 'OUTDOOR_REGS_UT_ELK_PERMITS'),
  ('UT', 'elk', 'closures',            'https://wildlife.utah.gov/guidebooks',       'OUTDOOR_REGS_UT_ELK_CLOSURES')
) AS v(state, species, regulation_type, source_url, agent_key)
WHERE NOT EXISTS (
  SELECT 1 FROM regulatory_registry r WHERE r.agent_key = v.agent_key
);
