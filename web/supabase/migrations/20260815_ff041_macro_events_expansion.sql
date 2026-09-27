-- FF-041 Phase 1 — Macro Event Template Expansion
-- Solvega Labs LLC · Meridian Fusion · August 15, 2026
-- All INSERTs use ON CONFLICT DO NOTHING — safe to re-run.

-- Natural Disasters
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified,
   event_duration_days, fema_declaration_id)
VALUES
  ('2022-09-28', 'natural_disaster', 'Hurricane Ian — Florida landfall',
   'Category 4 hurricane. Major vehicle total losses in Southwest Florida. Insurance surge.',
   5, 'negative', ARRAY['auto_finance','auto_insurance','consumer_lending'],
   ARRAY['Southeast'], false, true, 21, 'DR-4673'),
  ('2023-08-10', 'natural_disaster', 'Maui wildfires — Lahaina destruction',
   'Deadliest US wildfire in over a century. Total vehicle losses. Community displacement.',
   5, 'negative', ARRAY['auto_finance','auto_insurance'],
   ARRAY['Pacific'], false, true, 30, 'DR-4724'),
  ('2024-09-26', 'natural_disaster', 'Hurricane Helene — Southeast flooding',
   'Catastrophic inland flooding in Appalachian region. Widespread vehicle losses.',
   5, 'negative', ARRAY['auto_finance','auto_insurance','consumer_lending'],
   ARRAY['Southeast'], false, true, 45, 'DR-4830'),
  ('2021-02-10', 'natural_disaster', 'Texas winter storm Uri — grid failure',
   'Statewide power outage. Supply chain disruption. Significant vehicle damage.',
   4, 'negative', ARRAY['auto_finance','consumer_lending'],
   ARRAY['Southwest'], false, true, 14, 'DR-4586')
ON CONFLICT DO NOTHING;

-- Major Employer Events
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified,
   employer_size_est)
VALUES
  ('2023-01-18', 'major_employer_event', 'Microsoft layoffs — 10,000 jobs',
   'Tech sector wave begins. Consumer confidence impact in tech-concentrated metros.',
   3, 'negative', ARRAY['consumer_lending','auto_finance'],
   ARRAY['Pacific','Northeast'], false, true, 10000),
  ('2023-03-20', 'major_employer_event', 'Amazon facility expansion — rural markets',
   'Amazon announces 50+ new fulfillment centers. W2 job creation in rural and Midwest regions.',
   3, 'positive', ARRAY['auto_finance','consumer_lending'],
   ARRAY['Midwest','Southeast','Southwest'], false, true, 15000),
  ('2024-02-01', 'major_employer_event', 'Ford EV restructuring — Dearborn cuts',
   '3,800 layoffs in EV division. Michigan/Midwest employment impact.',
   3, 'negative', ARRAY['auto_finance','consumer_lending'],
   ARRAY['Midwest'], false, true, 3800)
ON CONFLICT DO NOTHING;

-- Energy / Commodity
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description,
   metric_name, metric_value, metric_unit, prior_value, delta_value,
   magnitude, direction, relevant_industries, affected_regions,
   is_recession_period, is_verified)
VALUES
  ('2022-06-13', 'energy_commodity', 'US average gas price — $5.00/gallon peak',
   'Record fuel prices. DTI pressure on commuter-dependent borrowers. Truck/SUV demand suppressed.',
   'us_avg_gas_price_usd', 5.01, 'USD/gallon', 3.15, 1.86,
   4, 'negative', ARRAY['auto_finance','consumer_lending'],
   ARRAY['Midwest','Southeast','Southwest','Mountain West'], false, true),
  ('2024-04-15', 'energy_commodity', 'Iran strait tensions — Brent crude +8%',
   'Heightened strait of Hormuz tensions. Crude oil spike. Fuel price pass-through expected.',
   'brent_crude_usd', 91.50, 'USD/barrel', 84.70, 6.80,
   3, 'negative', ARRAY['auto_finance','logistics','consumer_lending'],
   ARRAY['Midwest','Southeast','Southwest'], false, true)
ON CONFLICT DO NOTHING;

-- Election / Political
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified)
VALUES
  ('2024-11-05', 'election_political', 'US Presidential Election — Trump wins',
   'Republican sweep. Consumer confidence bifurcated. Tariff policy expectations rise.',
   3, 'neutral', ARRAY['auto_finance','consumer_lending','auto_manufacturing'],
   ARRAY['Midwest','Southeast','Southwest','Mountain West'], false, true),
  ('2024-11-06', 'election_political', 'Post-election auto tariff expectations',
   'Markets price in 25%+ tariff on imported vehicles. New vehicle price expectations rise.',
   3, 'negative', ARRAY['auto_finance','auto_manufacturing'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true)
ON CONFLICT DO NOTHING;

-- Judicial / Regulatory
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified)
VALUES
  ('2024-05-16', 'judicial_regulatory', 'CFPB auto lending fair lending guidance',
   'CFPB issues guidance on dealer markup and disparate impact in auto lending.',
   2, 'negative', ARRAY['auto_finance'],
   NULL, false, true),
  ('2022-06-30', 'judicial_regulatory', 'Supreme Court — West Virginia v. EPA',
   'Major reduction in federal agency regulatory authority. Downstream lending rule uncertainty.',
   2, 'neutral', ARRAY['consumer_lending','auto_finance'],
   NULL, false, true)
ON CONFLICT DO NOTHING;

-- Social Confidence
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified)
VALUES
  ('2020-03-11', 'social_confidence', 'WHO COVID-19 pandemic declaration',
   'Global pandemic declared. Consumer mobility collapse. Vehicle purchase deferral.',
   5, 'negative', ARRAY['auto_finance','consumer_lending'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific','Mountain West'], true, true),
  ('2023-03-10', 'social_confidence', 'SVB bank run — depositor confidence shock',
   'Silicon Valley Bank failure. Regional bank confidence shock. Credit tightening expectations.',
   3, 'negative', ARRAY['consumer_lending','auto_finance'],
   ARRAY['Pacific','Northeast'], false, true)
ON CONFLICT DO NOTHING;

-- Supply Chain
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified)
VALUES
  ('2021-03-01', 'supply_chain', 'Global semiconductor shortage — auto production cuts',
   'Chip shortage forces major automakers to cut production. New vehicle supply constrained.',
   4, 'negative', ARRAY['auto_finance','auto_manufacturing'],
   ARRAY['Midwest','Southeast'], false, true),
  ('2021-03-23', 'supply_chain', 'Suez Canal — Ever Given blockage',
   '6-day Suez blockage. Global supply chain shock. Parts delays to US auto plants.',
   3, 'negative', ARRAY['auto_manufacturing','auto_finance'],
   ARRAY['Midwest','Southeast','Northeast'], false, true)
ON CONFLICT DO NOTHING;

-- Global Conflict
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified,
   event_duration_days)
VALUES
  ('2022-02-24', 'global_conflict', 'Russia invades Ukraine — commodity shock',
   'Full-scale invasion. Energy and commodity price surge. Supply chain disruption.',
   5, 'negative', ARRAY['auto_finance','consumer_lending','energy'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true, 730),
  ('2026-04-12', 'global_conflict', 'Iran — Strait of Hormuz partial closure',
   'Iranian forces impose shipping restrictions. Energy price spike. Logistics disruption.',
   4, 'negative', ARRAY['auto_finance','logistics','consumer_lending'],
   ARRAY['Southwest','Southeast','Midwest'], false, true, 45)
ON CONFLICT DO NOTHING;

-- Climate Regulatory
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description, magnitude, direction,
   relevant_industries, affected_regions, is_recession_period, is_verified)
VALUES
  ('2023-04-12', 'climate_regulatory', 'EPA 2032 vehicle emission standards finalized',
   'Most stringent auto emissions rules in US history. EV adoption mandate effectively 67% by 2032.',
   3, 'negative', ARRAY['auto_finance','auto_manufacturing'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true),
  ('2022-08-16', 'climate_regulatory', 'Inflation Reduction Act — EV tax credits',
   '$7,500 EV tax credit restructured. Income and MSRP limits. Domestic sourcing requirements.',
   3, 'positive', ARRAY['auto_finance','auto_manufacturing'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true)
ON CONFLICT DO NOTHING;

-- Housing / Real Estate
INSERT INTO public.enterprise_macro_events
  (event_date, event_category, event_name, description,
   metric_name, metric_value, metric_unit, prior_value, delta_value,
   magnitude, direction, relevant_industries, affected_regions,
   is_recession_period, is_verified)
VALUES
  ('2023-10-19', 'housing_real_estate', 'US 30-year mortgage rate hits 8% — 23-year high',
   'Mortgage affordability crisis. Home equity extraction suppressed. Renter DTI pressure elevated.',
   'us_30yr_mortgage_rate_pct', 8.01, 'percent', 6.81, 1.20,
   4, 'negative', ARRAY['consumer_lending','auto_finance'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true),
  ('2021-06-01', 'housing_real_estate', 'US median home price — record appreciation',
   'Home prices +24% YoY in some markets. Wealth effect for owners. Renter cost squeeze.',
   'us_median_home_price_usd', 363300, 'USD', 293100, 70200,
   3, 'positive', ARRAY['consumer_lending','auto_finance'],
   ARRAY['Midwest','Southeast','Southwest','Northeast','Pacific'], false, true)
ON CONFLICT DO NOTHING;
