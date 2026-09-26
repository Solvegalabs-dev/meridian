# FF-089 + FF-090 — Geographic Intelligence Engine + Swarm Evolution Engine
**Filed: Session 35 · September 25, 2026**
**Solvega Labs LLC · CONFIDENTIAL**

---

## FF-089 — Geographic Intelligence Engine

### Vision
When a user drops a pin or enters coordinates, Meridian resolves the full geographic context of that location and instantiates a complete, location-calibrated agent swarm. Every agent knows exactly where it is, what regulations apply, what data sources exist for that unit, and what the annual intelligence arc looks like for that geography. This is the capability that makes BaseMaps and OnX partnerships technically credible — Meridian doesn't just work for OBJ-17 in Utah, it works for any hunter anywhere in North America.

**"Drop a pin. Get a targeting solution."**

### What exists today
- `objective_profiles` — stores `lat`, `lon`, `nws_grid_office`, `nws_grid_x`, `nws_grid_y` ✅
- `resolveNWSGridpoint()` — calls `api.weather.gov/points/{lat},{lon}` ✅
- `resolveAgentBundle()` — assigns agents from registry by `taxonomy_key` ✅
- Agent runner — substitutes `{nws_grid_office}`, `{nws_grid_x}`, `{nws_grid_y}` at fetch time ✅
- Location entry UI — lat/lon input on objective edit page ✅ (FF-074, just shipped)

### What's missing

**Gap 1 — Unit boundary resolution**
The system knows coordinates but not what hunt unit those coordinates fall in. State wildlife agencies publish GIS boundary files (shapefiles or GeoJSON) for every hunt unit. Meridian needs to cross-reference coordinates against unit boundaries to identify:
- State (UT, MT, CO, WY, ID, AK, etc.)
- Hunt unit ID (EA1301, HD-316, Unit 10, etc.)
- Land ownership (BLM, USFS, State, Private)
- Elevation band (derived from coordinates)
- Adjacent units (for FAC expansion)

**Gap 2 — Regulatory intelligence as first-class agents**
Season dates, legal methods, tag requirements, permit availability are just data sources — they should be agents like any other. `OUTDOOR_REGS_UT_ELK_EA1301` watches the Utah DWR page for Unit EA1301. If the page changes (new closure, permit release, season adjustment), the agent fires a hit. Maestro monitors it. The swarm constructor includes it automatically when `geo.state = 'UT'` and `taxonomy_key` starts with `elk`.

**Gap 3 — Geographic parameter injection**
The swarm constructor assigns agents but doesn't inject all location-specific parameters. Needs to resolve and store:
- Nearest USGS streamflow gauges (within 25 miles of coordinates)
- Nearest NRCS SNOTEL stations (within 50 miles, elevation-matched)
- Land ownership boundaries (BLM/USFS/State/Private percentage in unit)
- Elevation band (average, min, max within unit)
- Adjacent unit IDs (for FAC expansion)
- NWS zone ID (for alert monitoring)

**Gap 4 — Annual arc initialization**
When an objective is created, Meridian should initialize the annual intelligence arc for that unit:
- Historical draw odds (from state agency data)
- Historical harvest success rates
- Historical population trend (5-year herd survey data)
- Season window for current year
- Permit/tag availability status

### Architecture

```
User drops pin (lat/lon) or enters coordinates
         ↓
Location Resolver (new — lib/geo/locationResolver.ts)
  → api.weather.gov/points/{lat},{lon} → NWS gridpoint (exists)
  → Reverse geocode → state + county
  → Hunt unit boundary cross-reference → unit ID
  → Nearest USGS gauges → site IDs
  → Nearest SNOTEL stations → station IDs
  → Elevation lookup → USGS 3DEP
  → Land ownership → BLM MapService API
         ↓
objective_profiles updated with full geographic metadata
  lat, lon, nws_grid_office, nws_grid_x, nws_grid_y (exists)
  + state, county, hunt_unit_id, land_ownership_pct
  + usgs_gauge_ids (array), snotel_station_ids (array)
  + elevation_ft_avg, elevation_ft_min, elevation_ft_max
  + adjacent_unit_ids (array)
         ↓
Swarm Constructor (extends existing resolveAgentBundle())
  → Selects agents by taxonomy_key (exists)
  → Injects ALL geographic parameters into agent templates
  → Adds regulatory agents for state + taxonomy_key combination
  → Adds unit-specific agents if they exist in registry
  → Returns full agent bundle with geo parameters baked in
         ↓
Regulatory Intelligence Layer (new agent type)
  → OUTDOOR_REGS_{STATE}_{SPECIES}_{UNIT} agents
  → Watch state DWR/FWP pages for unit-specific regulation changes
  → keyword_match threshold — fires on any page change
  → Cadence: 720h (weekly) — regs don't change daily
         ↓
Annual Arc Initialization
  → Query state agency historical data
  → Store in objective_profiles.annual_arc_data (JSONB)
  → Surfaces in Strike Brief annual arc timeline
```

### Schema additions

```sql
ALTER TABLE objective_profiles
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS county TEXT,
  ADD COLUMN IF NOT EXISTS hunt_unit_id TEXT,
  ADD COLUMN IF NOT EXISTS land_ownership_pct JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS usgs_gauge_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS snotel_station_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS elevation_ft_avg INTEGER,
  ADD COLUMN IF NOT EXISTS elevation_ft_min INTEGER,
  ADD COLUMN IF NOT EXISTS elevation_ft_max INTEGER,
  ADD COLUMN IF NOT EXISTS adjacent_unit_ids TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS annual_arc_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS regulatory_agents TEXT[] DEFAULT '{}';
```

### New tables

```sql
-- Hunt unit boundary registry
CREATE TABLE hunt_unit_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  unit_id TEXT NOT NULL,
  species TEXT NOT NULL,
  unit_name TEXT,
  boundary_geojson JSONB,
  centroid_lat DECIMAL(9,6),
  centroid_lon DECIMAL(9,6),
  elevation_ft_avg INTEGER,
  area_sq_miles DECIMAL,
  land_ownership_pct JSONB DEFAULT '{}',
  adjacent_unit_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(state, unit_id, species)
);

-- Regulatory intelligence registry
CREATE TABLE regulatory_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL,
  species TEXT NOT NULL,
  unit_id TEXT,
  regulation_type TEXT NOT NULL, -- 'season_dates' | 'legal_methods' | 'tag_requirements' | 'permit_availability'
  source_url TEXT NOT NULL,
  agent_key TEXT NOT NULL,
  current_value JSONB,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### MIP Two-Question Gate
- **Core or config?** Location resolver, swarm constructor, geo injection = CORE. Unit boundary data, regulatory URLs, state-specific agent templates = CONFIG.
- **Third-vertical test?** A real estate broker creating an objective with a property address needs the same location resolver (geocode → NWS gridpoint → regulatory context for that jurisdiction). Yes — this is core.

### Priority
**P0 — Build after Strike Brief UI is stable.** This is the BaseMaps integration prerequisite. Without geographic intelligence, Meridian only works for pre-configured geographies. With it, Meridian works for any pin anywhere in North America.

### Gates
- FF-074 ✅ (location entry UI)
- FF-078 ✅ (Maestro — monitors regulatory agents)
- FF-085 ✅ (swarm constructor — extends, doesn't replace)

---

## FF-090 — Swarm Evolution Engine

### Vision
The swarm gets smarter with every user. When Maestro detects signal gaps — agents with low coverage, dead sources, or missing data for a geography — Haiku investigates, discovers new data sources, and proposes new agents. Human approves. The agent enters the registry permanently and serves every future objective in that geography. Six months of BaseMaps users dropping pins = the most comprehensive outdoor intelligence agent registry ever built. This cannot be purchased or replicated without running the swarm.

### What exists today
- Maestro health monitor (FF-078) — detects agent failures, runs Haiku investigation at 5-strike ✅
- `agent_credential_requests` — Haiku-as-judge proposes credential needs ✅
- `agent_health_log` — tracks consecutive errors, investigation summaries ✅
- FF-086 Auto-Source Recovery — proposes replacement URLs for dead sources (specced, not built) ⬜

### The evolution beyond FF-086

FF-086 replaces dead sources. FF-090 discovers new ones that don't exist yet in the registry.

**Three evolution triggers:**

**Trigger 1 — Signal gap detection**
Maestro scans `agent_health_log` and `agent_signal_history` for objectives with low signal density — fewer than 3 agents returning hits per week. Flags as "coverage gap" for that geography + taxonomy combination.

**Trigger 2 — Source discovery**
Haiku receives the coverage gap report and a description of the objective's geography and taxonomy. It searches for new authoritative data sources — state agency APIs, USGS gauge IDs, university research datasets, conservation organization monitoring programs. Returns structured proposals.

**Trigger 3 — Geographic expansion**
When a new state or unit appears in `objective_profiles` that has no agents in `agent_registry` with matching `geo_scope`, Maestro flags it as an "uncharted territory" and triggers source discovery for that state + taxonomy combination.

### Architecture

```
Maestro Evolution Cron (every 24h — new cron job)
         ↓
Signal Gap Detector
  → Query agent_signal_history: objectives with < 3 hits/week
  → Query agent_registry: agents with geo_scope not matching any active objective
  → Flag coverage gaps by geography + taxonomy
         ↓
Haiku Evolution Investigation
  → Receives: geography (state, unit, coordinates), taxonomy_key, current agent list, gap description
  → Prompt: "Find 2-3 authoritative public data sources for {taxonomy} in {state} {unit} that are not already in this agent list. For each, provide: source name, URL template, data type, update frequency, and what signal it provides."
  → Returns structured JSON proposals
         ↓
agent_evolution_proposals table
  → Stores Haiku's proposals with status 'pending'
  → Surfaces in Maestro dashboard for human review
  → Human approves → agent_configs row created → joins registry
  → Human rejects → proposal archived, not re-proposed for 90 days
         ↓
Registry Growth
  → Approved agents enter agent_registry with correct taxonomy_keys + geo_scope
  → Swarm constructor picks them up for all future objectives in that geography
  → agent_signal_history begins accumulating for new agents
  → Pattern library grows
```

### New table

```sql
CREATE TABLE agent_evolution_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL, -- 'signal_gap' | 'source_discovery' | 'geographic_expansion'
  objective_id UUID REFERENCES objectives(id),
  geography JSONB NOT NULL, -- {state, unit_id, lat, lon}
  taxonomy_key TEXT NOT NULL,
  proposed_agent_key TEXT NOT NULL,
  proposed_display_name TEXT NOT NULL,
  proposed_source_url TEXT NOT NULL,
  proposed_threshold_type TEXT NOT NULL,
  proposed_threshold_value DECIMAL,
  proposed_cadence_minutes INTEGER,
  haiku_rationale TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### The compounding moat

Every approved agent proposal makes the registry more comprehensive. The registry is a dataset that accumulates with usage — it cannot be purchased or instantiated from scratch. A competitor launching today would need years of real objective data flowing through a real swarm to generate meaningful proposals. Meridian's head start compounds daily.

**The OnX conversation:**
> "We have 18 months of scored prediction history and a self-evolving agent registry that has discovered 340 data sources across 12 states. That registry is the intelligence layer. It took 18 months of real users to build it. You can buy the technology stack. You can't buy the registry."

### MIP Two-Question Gate
- **Core or config?** Gap detection logic, Haiku investigation prompt, proposal queue = CORE. State-specific gap thresholds, approved agent templates = CONFIG.
- **Third-vertical test?** A real estate broker's swarm with coverage gaps in a new metro area triggers the same evolution engine. Yes — this is core.

### Priority
**P1 — Build after FF-089 Geographic Intelligence Engine is stable.** FF-090 needs FF-089's unit boundary data to identify geographic gaps meaningfully.

### Gates
- FF-078 ✅ (Maestro — evolution cron extends the health cron)
- FF-086 ⬜ (Auto-Source Recovery — coordinate with FF-090 to avoid duplication)
- FF-089 ⬜ (Geographic Intelligence Engine — unit boundary data needed for gap detection)

---

## Claude Code Tasker — FF-089 Part 1

**Branch: `feature/ff-089-geographic-intelligence`**
**Target repo: `Solvegalabs-dev/meridian`**

> "Begin FF-089 — Geographic Intelligence Engine Part 1. This extends the existing location resolver and swarm constructor — do not replace them.
>
> **Step 0 — Column discovery first**
> ```sql
> SELECT column_name, data_type
> FROM information_schema.columns
> WHERE table_name = 'objective_profiles'
> ORDER BY ordinal_position;
> ```
> Report all columns before writing any queries.
>
> **Step 1 — Schema additions (apply_migration)**
> ```sql
> ALTER TABLE objective_profiles
>   ADD COLUMN IF NOT EXISTS state TEXT,
>   ADD COLUMN IF NOT EXISTS county TEXT,
>   ADD COLUMN IF NOT EXISTS hunt_unit_id TEXT,
>   ADD COLUMN IF NOT EXISTS land_ownership_pct JSONB DEFAULT '{}',
>   ADD COLUMN IF NOT EXISTS usgs_gauge_ids TEXT[] DEFAULT '{}',
>   ADD COLUMN IF NOT EXISTS snotel_station_ids TEXT[] DEFAULT '{}',
>   ADD COLUMN IF NOT EXISTS elevation_ft_avg INTEGER,
>   ADD COLUMN IF NOT EXISTS elevation_ft_min INTEGER,
>   ADD COLUMN IF NOT EXISTS elevation_ft_max INTEGER,
>   ADD COLUMN IF NOT EXISTS adjacent_unit_ids TEXT[] DEFAULT '{}',
>   ADD COLUMN IF NOT EXISTS annual_arc_data JSONB DEFAULT '{}',
>   ADD COLUMN IF NOT EXISTS regulatory_agents TEXT[] DEFAULT '{}';
>
> CREATE TABLE IF NOT EXISTS hunt_unit_registry (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   state TEXT NOT NULL,
>   unit_id TEXT NOT NULL,
>   species TEXT NOT NULL,
>   unit_name TEXT,
>   centroid_lat DECIMAL(9,6),
>   centroid_lon DECIMAL(9,6),
>   elevation_ft_avg INTEGER,
>   area_sq_miles DECIMAL,
>   land_ownership_pct JSONB DEFAULT '{}',
>   adjacent_unit_ids TEXT[] DEFAULT '{}',
>   created_at TIMESTAMPTZ DEFAULT NOW(),
>   updated_at TIMESTAMPTZ DEFAULT NOW(),
>   UNIQUE(state, unit_id, species)
> );
>
> CREATE TABLE IF NOT EXISTS regulatory_registry (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   state TEXT NOT NULL,
>   species TEXT NOT NULL,
>   unit_id TEXT,
>   regulation_type TEXT NOT NULL,
>   source_url TEXT NOT NULL,
>   agent_key TEXT NOT NULL,
>   current_value JSONB,
>   last_checked TIMESTAMPTZ,
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
>
> CREATE TABLE IF NOT EXISTS agent_evolution_proposals (
>   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
>   trigger_type TEXT NOT NULL,
>   objective_id UUID REFERENCES objectives(id),
>   geography JSONB NOT NULL,
>   taxonomy_key TEXT NOT NULL,
>   proposed_agent_key TEXT NOT NULL,
>   proposed_display_name TEXT NOT NULL,
>   proposed_source_url TEXT NOT NULL,
>   proposed_threshold_type TEXT NOT NULL,
>   proposed_threshold_value DECIMAL,
>   proposed_cadence_minutes INTEGER,
>   haiku_rationale TEXT NOT NULL,
>   status TEXT DEFAULT 'pending',
>   reviewed_at TIMESTAMPTZ,
>   review_notes TEXT,
>   created_at TIMESTAMPTZ DEFAULT NOW()
> );
> ```
>
> **Step 2 — Extended location resolver**
> File: `lib/geo/locationResolver.ts`
>
> Extend the existing `resolveNWSGridpoint()` with a new function:
> ```typescript
> export async function resolveFullGeography(lat: number, lon: number): Promise<{
>   nws_grid_office: string
>   nws_grid_x: number
>   nws_grid_y: number
>   nws_zone_id: string
>   state: string           // 2-letter state code from NWS response
>   county: string          // county from NWS response
>   usgs_gauge_ids: string[] // nearest gauges from USGS site service
>   snotel_station_ids: string[] // nearest SNOTEL stations
>   elevation_ft_avg: number  // from USGS 3DEP EPQS
> } | null>
> ```
>
> Data sources:
> - NWS points API: `https://api.weather.gov/points/{lat},{lon}` — returns gridpoint + state + county + zone
> - USGS site service: `https://waterservices.usgs.gov/nwis/site/?format=rdb&lat={lat}&lng={lon}&siteType=ST&siteStatus=active&radiusMi=25` — nearest active stream gauges within 25 miles
> - USGS 3DEP EPQS: `https://epqs.nationalmap.gov/v1/json?x={lon}&y={lat}&units=Feet` — elevation
> - NRCS SNOTEL: `https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?activeOnly=true&maxLatitude={lat+1}&minLatitude={lat-1}&maxLongitude={lon+1}&minLongitude={lon-1}&networkCds=SNTL` — nearby SNOTEL stations
>
> All calls non-fatal — if any fail, return what succeeded and null for the rest. Never block objective creation.
>
> **Step 3 — Wire into PATCH /api/objectives/[id]/location**
> The existing location save route already calls `resolveNWSGridpoint()`. Replace that call with `resolveFullGeography()` and save all returned fields to `objective_profiles`.
>
> **Step 4 — Wire into POST /api/objectives/create**
> Same replacement — when an objective is created with coordinates, call `resolveFullGeography()` instead of `resolveNWSGridpoint()`.
>
> **Step 5 — Regulatory agent seeding for Utah elk**
> Seed the first regulatory agents into `agent_configs` and `regulatory_registry`:
> ```sql
> -- Utah elk regulations
> INSERT INTO agent_configs (agent_key, display_name, vertical, domain, source_url_template, threshold_type, threshold_keywords, cadence_minutes, is_active)
> VALUES
> ('OUTDOOR_REGS_UT_ELK_SEASON', 'Utah Elk Season Dates', 'outdoor', 'elk_hunt',
>  'https://wildlife.utah.gov/hunting/big-game/elk', 'keyword_match',
>  ARRAY['season', 'archery', 'rifle', 'open', 'closes', 'September', 'October'],
>  720, true),
> ('OUTDOOR_REGS_UT_ELK_PERMITS', 'Utah Elk Permit Availability', 'outdoor', 'elk_hunt',
>  'https://wildlife.utah.gov/remainingpermits', 'keyword_match',
>  ARRAY['elk', 'permit', 'available', 'remaining', 'antlerless', 'bull'],
>  720, true),
> ('OUTDOOR_REGS_UT_ELK_CLOSURES', 'Utah Elk Area Closures', 'outdoor', 'elk_hunt',
>  'https://wildlife.utah.gov/hunting/closures', 'keyword_match',
>  ARRAY['closure', 'closed', 'restricted', 'elk', 'emergency'],
>  360, true)
> ON CONFLICT (agent_key) DO NOTHING;
> ```
>
> **Step 6 — Agent runner geographic substitution extension**
> In `lib/agents/agentRunner.ts`, extend the existing `.replace()` chain to include new geographic variables:
> ```typescript
> url = url
>   .replace('{usgs_gauge_id}', profile?.usgs_gauge_ids?.[0] ?? '')
>   .replace('{usgs_gauge_ids}', profile?.usgs_gauge_ids?.join(',') ?? '')
>   .replace('{snotel_station_id}', profile?.snotel_station_ids?.[0] ?? '')
>   .replace('{state}', profile?.state ?? 'UT')
>   .replace('{hunt_unit_id}', profile?.hunt_unit_id ?? '')
> ```
>
> **Verification after each step:**
> ```sql
> SELECT column_name FROM information_schema.columns
> WHERE table_name IN ('objective_profiles', 'hunt_unit_registry', 'regulatory_registry', 'agent_evolution_proposals')
> ORDER BY table_name, ordinal_position;
> ```
>
> **PR sequence:**
> - PR 1: Steps 1-3 — schema + extended resolver + location route wire
> - PR 2: Steps 4-6 — create route + regulatory seeding + runner extension
>
> Branch: `feature/ff-089-geographic-intelligence`
> Target: `Solvegalabs-dev/meridian`
> Never self-merge. Open PR, report URL, stop after each PR."

---

*FF-089 + FF-090 Specs + Claude Code Tasker · Session 35 · September 25, 2026 · Solvega Labs LLC · CONFIDENTIAL*
