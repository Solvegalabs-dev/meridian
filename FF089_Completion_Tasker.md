# FF-089 Completion Tasker
# Branch: feature/ff-089-geographic-intelligence-part3
# Target: Solvegalabs-dev/meridian
# Never self-merge. Open PR, report URL, stop.

## Fix 1 — Swarm cron must pass objective to agent runner (P0)

The swarm cron runs all active agents but never passes the associated objective profile to the runner. This means {nws_grid_office}, {nws_grid_x}, {nws_grid_y}, {state}, {usgs_gauge_ids} etc always fall back to hardcoded defaults. Geographic targeting is completely non-functional until this is fixed.

Find where the swarm cron fires agents. The runner needs to:

1. For each agent, look up which objective_profiles rows have this agent_key in their assigned_agents array
2. For each associated objective_profile, fetch the full row including all geo columns
3. Pass the profile geographic fields into the URL template substitution for that run
4. If an agent serves multiple objectives (e.g. OUTDOOR_MOON_PHASE assigned to 5 objectives), run it once per objective with that objective's geographic parameters — not once globally

The existing substitution chain in agentRunner.ts already has slots for these variables. The fix is ensuring the objective_profiles row is fetched and passed in, not that the substitution logic itself needs changing.

Use createServiceClient() for all reads — not createClient().

## Fix 2 — USGS gauge IDs returning empty (P1)

In lib/geo/locationResolver.ts, the USGS bounding box query returns no results. Replace the current query with the USGS site service radius endpoint:

URL: https://waterservices.usgs.gov/nwis/site/?format=rdb&lat={LAT}&lng={LON}&siteType=ST&siteStatus=active&siteOutput=expanded&radius=50&units=miles

Replace {LAT} and {LON} with the actual coordinates at call time.

The response is tab-delimited RDB format. Parse it as follows:
- Skip lines starting with # (comments)
- The header row contains column names separated by tabs
- Find the column index for site_no
- Each subsequent data row (skip the format row that contains strings like 15s, 8d) contains the site number in that column
- Return up to 5 site numbers as strings

Test with Elizabeth Pass coordinates: lat=40.948, lon=-110.668
Expected: should return 3-5 active USGS stream gauge site numbers for the Uinta Mountains area

## Fix 3 — Regulatory agent cadence correction (P2)

Apply this migration via apply_migration with name ff089_fix_regulatory_cadence:

UPDATE agent_configs
SET cadence_minutes = 10080
WHERE agent_key IN (
  'OUTDOOR_REGS_UT_ELK_SEASON',
  'OUTDOOR_REGS_UT_ELK_PERMITS',
  'OUTDOOR_REGS_UT_ELK_CLOSURES'
);

Verify after applying:
SELECT agent_key, cadence_minutes FROM agent_configs
WHERE agent_key LIKE 'OUTDOOR_REGS%';

Expected: all three rows show cadence_minutes = 10080

## Fix 4 — OBJ-17 backfill USGS gauge IDs (P2)

After Fix 2 is working, call resolveFullGeography(40.948, -110.668) and update OBJ-17 objective_profiles row with the returned usgs_gauge_ids. Apply via apply_migration with name ff089_backfill_obj17_usgs_gauges using the actual gauge IDs returned by the fixed resolver.

## Verification queries (run after all fixes, report results)

SELECT agent_key, cadence_minutes, is_active
FROM agent_configs
WHERE agent_key LIKE 'OUTDOOR_REGS%'
ORDER BY agent_key;

SELECT lat, lon, nws_grid_office, nws_grid_x, nws_grid_y,
       state, county, usgs_gauge_ids, snotel_station_ids, elevation_ft_avg
FROM objective_profiles
WHERE objective_id = '29d41c7a-22e8-4c05-ad8b-f391aed1d06c';

## PR instructions
Branch: feature/ff-089-geographic-intelligence-part3
Target repo: Solvegalabs-dev/meridian
Do not self-merge.
Open PR when all fixes complete and verification queries pass.
Report PR URL and stop.
