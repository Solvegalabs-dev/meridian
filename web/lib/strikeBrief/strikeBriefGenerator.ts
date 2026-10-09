import { createServiceClient } from '@/lib/supabase/server';
import { loadActiveSpotId, spotRunFilter } from '@/lib/spots/activeSpot';
import { hasLocation } from '@/lib/agents/geoLocation';
import { getAnthropicClient } from '@/lib/anthropic/client';
import { generateMovementWindows } from './movementPrediction';
import { getTerrainIntel } from './terrainIntelligence';
import { evaluatePivot } from './pivot-logic';
import { FISHING_PROMPT_ADDENDUM, FISHING_WINDOW_INSTRUCTIONS } from '@/lib/strike/config/fishing-synthesis-prompt';
import { loadObjectiveWindow, isEndedState } from '@/lib/objectives/objectiveWindow';
import type { WindowEvaluation } from '@/lib/objectives/windowState';
import { buildClosedBriefFields, formatBriefDate, type StrikeGoNoGo } from './closedBrief';
import { loadEvidence, ZERO_EVIDENCE_BANNER, EVIDENCE_WINDOW_DAYS, type Evidence } from './evidence';

// Values the model may return. CLOSED is written only by code (closedBrief.ts).
const MODEL_GO_NO_GO = ['GO', 'NO_GO', 'CONDITIONAL', 'MONITOR'] as const;

// Fishing/aquatic agent keys excluded from elk hunt briefs
const FISHING_AGENT_EXCLUDE = ['SALMON', 'AQUATIC', 'FISHING', 'BONNEVILLE', 'MCNARY', 'HATCH']

function isFishingTerm(s: string): boolean {
  const upper = s.toUpperCase()
  return FISHING_AGENT_EXCLUDE.some(term => upper.includes(term))
}

// --- Time window resolution (Mountain Time) ---

export function getTimeWindow(): '0600' | '1100' | '1700' {
  // MT = UTC-6 (MDT) or UTC-7 (MST). Using UTC-6 (summer/hunt season).
  const now = new Date();
  const mtHour = (now.getUTCHours() - 6 + 24) % 24;
  if (mtHour < 9) return '0600';
  if (mtHour < 14) return '1100';
  return '1700';
}

// --- Types ---

export type StrikeBriefContext = {
  objectiveId: string;
  objectiveTitle: string;
  domain: string;
  signalBrief: string;
  domainEvents: string;
  rawMacroEvents: object[];
  patternMatchYear: number | null;
  patternMatchScore: number | null;
  confidenceTier: string;
  agentHits: string[];
  // FF-098: what the model may state as confirmed, with units. Count 0 means a no-evidence brief.
  evidence?: Evidence;
  // FF-098: the only place names the model may use: the objective's own fields (title, water body, unit, region,
  // state, county, spot name). Nothing is inferred from coordinates.
  placeNames?: string[];
  geoProfile: { lat?: number; lng?: number } | null;
  domainProfile: object | null;
  locationProfile: {
    lat: number | null;
    lon: number | null;
    geo: { unit?: string; region?: string; state?: string } | null;
    nws_grid_office: string | null;
    nws_grid_x: number | null;
    nws_grid_y: number | null;
    elevation_ft: number | null;
  } | null;
  terrainCache: {
    slope_aspect: string | null;
    elevation_ft: number | null;
    thermal_belt_min_ft: number | null;
    thermal_belt_max_ft: number | null;
    water_proximity_m: number | null;
    bedding_probability: number | null;
    terrain_interpretation: object | null;
  } | null;
};

export type StrikeBriefRow = {
  id: string;
  objective_id: string;
  user_id: string;
  brief_date: string;
  time_window: string;
  domain: string;
  synthesis: string;
  lead_signal: string | null;
  go_no_go: StrikeGoNoGo | null;
  condition_delta: string | null;
  pattern_match_year: number | null;
  confidence_tier: string | null;
  agent_hits: string[];
  movement_windows: Array<{ time: string; probability: number; reason: string; confidence_tier: string }> | null;
  terrain_intel: { bedding: string[]; feeding: string[]; corridors: string[]; elevation_range: { min: number; max: number } | null } | null;
  terrain_source: '3DEP' | 'user_described' | null;
  created_at: string;
};

// --- Context assembly ---

export async function buildStrikeBriefContext(
  objectiveId: string,
  userId: string
): Promise<StrikeBriefContext> {
  const supabase = createServiceClient();
  const today = new Date().toISOString().split('T')[0];

  // Objective record
  const { data: obj } = await supabase
    .from('objectives')
    .select('id, title, notes, goal_description, goal_context, category')
    .eq('id', objectiveId)
    .eq('user_id', userId)
    .single();

  // Domain profile
  const { data: profile } = await supabase
    .from('domain_profiles')
    .select('domain, signal_taxonomy, named_entities, geographic_scope')
    .eq('objective_id', objectiveId)
    .maybeSingle();

  let domain = profile?.domain ?? 'elk_hunt';
  const geoScope = profile?.geographic_scope as { lat?: number; lng?: number } | null;

  // Recent macro events (ELK_HUNT + UNIVERSAL, last 10)
  const { data: macroEvents } = await supabase
    .from('enterprise_macro_events')
    .select('event_date, event_name, description, direction, magnitude, source_series_id')
    .or("source_series_id.like.ELK_HUNT:%,source_series_id.like.UNIVERSAL:%")
    .order('event_date', { ascending: false })
    .limit(10);

  // Best pattern match
  const { data: pattern } = await supabase
    .from('pattern_matches')
    .select('comparison_year, similarity_score, pattern_label, historical_outcome')
    .eq('objective_id', objectiveId)
    .order('similarity_score', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Bound agents for this objective
  const { data: boundAgents } = await supabase
    .from('agent_objective_context')
    .select('agent_key')
    .eq('objective_id', objectiveId);

  const agentKeys = (boundAgents ?? []).map(r => r.agent_key as string);

  // Today's agent hits for bound agents
  let agentHits: string[] = [];
  if (agentKeys.length > 0) {
    // FF-091: only hits from the active spot. After a switch, the old area's hits are not used.
    const activeSpotId = await loadActiveSpotId(supabase, objectiveId);
    let runQuery = supabase
      .from('agent_run_log')
      .select('agent_key, ran_at')
      .in('agent_key', agentKeys)
      .eq('result', 'hit')
      .gte('ran_at', today);
    if (activeSpotId) runQuery = runQuery.or(spotRunFilter(activeSpotId));
    const { data: runLogs } = await runQuery;
    agentHits = (runLogs ?? []).map(r => r.agent_key as string);
  }

  // Location profile from objective_profiles (lat/lon, NWS gridpoint, geo unit label, domain)
  const { data: locationProfile } = await supabase
    .from('objective_profiles')
    .select('lat, lon, geo, nws_grid_office, nws_grid_x, nws_grid_y, elevation_ft, domain, state, county')
    .eq('objective_id', objectiveId)
    .maybeSingle();

  // Use objective_profiles.domain as fallback when no domain_profile row exists
  if (domain === 'elk_hunt' && locationProfile) {
    domain = (locationProfile as { domain?: string }).domain ?? domain;
  }

  // FF-098: evidence for the last 14 days, and the spot name for the allowed place names.
  const evidence = await loadEvidence(supabase, { objectiveId, userId, domain });
  const { data: spotRow } = await supabase
    .from('objective_spots')
    .select('name')
    .eq('objective_id', objectiveId)
    .eq('is_active', true)
    .maybeSingle();
  const profileGeo = (locationProfile?.geo ?? {}) as { unit?: string; region?: string; state?: string; water_body?: string };
  const placeNames = Array.from(new Set(
    [
      obj?.title,
      profileGeo.water_body,
      profileGeo.unit,
      profileGeo.region,
      profileGeo.state,
      (locationProfile as { state?: string | null } | null)?.state,
      (locationProfile as { county?: string | null } | null)?.county,
      (spotRow as { name?: string | null } | null)?.name,
    ].filter((v): v is string => typeof v === 'string' && v.trim() !== '').map(v => v.trim())
  ));

  // Terrain cache — most recent entry for this objective (non-fatal if absent)
  const { data: terrainCacheRow } = await supabase
    .from('terrain_cache')
    .select('slope_aspect, elevation_ft, thermal_belt_min_ft, thermal_belt_max_ft, water_proximity_m, bedding_probability, terrain_interpretation')
    .eq('objective_id', objectiveId)
    .order('computed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Format domain events summary — exclude fishing/aquatic events
  const domainEvents = (macroEvents ?? [])
    .filter(e => !isFishingTerm(e.event_name ?? '') && !isFishingTerm(e.source_series_id ?? ''))
    .map(e => `[${e.event_date}] ${e.event_name}: ${e.description ?? ''} (${e.direction ?? 'neutral'}, magnitude ${e.magnitude ?? '?'})`)
    .join('\n') || 'No recent domain events';

  // Signal brief from domain profile taxonomy — strip fishing/aquatic keys
  const taxonomy = profile?.signal_taxonomy as Record<string, unknown> | null;
  const huntingTaxonomy = taxonomy
    ? Object.fromEntries(Object.entries(taxonomy).filter(([key]) => !isFishingTerm(key)))
    : null;
  const signalBrief = huntingTaxonomy && Object.keys(huntingTaxonomy).length > 0
    ? JSON.stringify(huntingTaxonomy, null, 2)
    : 'No signal taxonomy available — domain profile not yet built for this objective.';

  // Confidence tier from pattern match
  const confidenceTier = pattern
    ? pattern.similarity_score >= 80 ? 'T1'
    : pattern.similarity_score >= 60 ? 'T2'
    : pattern.similarity_score >= 40 ? 'T3'
    : 'T4'
    : 'T4';

  return {
    objectiveId,
    objectiveTitle: obj?.title ?? 'Unknown objective',
    domain,
    signalBrief,
    domainEvents,
    rawMacroEvents: (macroEvents ?? []) as object[],
    patternMatchYear: pattern?.comparison_year ?? null,
    patternMatchScore: pattern ? Number(pattern.similarity_score) : null,
    confidenceTier,
    agentHits,
    evidence,
    placeNames,
    geoProfile: geoScope ?? null,
    domainProfile: profile ?? null,
    locationProfile: locationProfile ? {
      lat: locationProfile.lat as number | null,
      lon: locationProfile.lon as number | null,
      geo: locationProfile.geo as { unit?: string; region?: string; state?: string } | null,
      nws_grid_office: locationProfile.nws_grid_office as string | null,
      nws_grid_x: locationProfile.nws_grid_x as number | null,
      nws_grid_y: locationProfile.nws_grid_y as number | null,
      elevation_ft: locationProfile.elevation_ft as number | null,
    } : null,
    terrainCache: terrainCacheRow ? {
      slope_aspect: terrainCacheRow.slope_aspect as string | null,
      elevation_ft: terrainCacheRow.elevation_ft as number | null,
      thermal_belt_min_ft: terrainCacheRow.thermal_belt_min_ft as number | null,
      thermal_belt_max_ft: terrainCacheRow.thermal_belt_max_ft as number | null,
      water_proximity_m: terrainCacheRow.water_proximity_m as number | null,
      bedding_probability: terrainCacheRow.bedding_probability as number | null,
      terrain_interpretation: terrainCacheRow.terrain_interpretation as object | null,
    } : null,
  };
}

// --- Prompt builder ---

// windowFact: a deterministic date fact from the window evaluator (season or trip
// not yet open). The model is told it is a hard fact; post-processing enforces it too.
export function buildStrikeBriefPrompt(context: StrikeBriefContext, timeWindow: string, windowFact?: string): string {
  const isFishing = context.domain === 'fishing';

  const huntingWindowInstructions: Record<string, string> = {
    '0600': `MORNING BRIEF — 0600. Synthesize for a hunter leaving camp within 90 minutes.
      Lead with: where to be and why. Include thermal direction, wind, water source proximity given current drought.
      End with one sentence: the single most important thing to act on this morning.`,
    '1100': `MIDDAY CHECK — 1100. Synthesize condition delta since morning.
      Has anything changed that alters the plan? Go/No-Go on afternoon move.
      If conditions unchanged, say so in one sentence and stand down. Do not generate noise.`,
    '1700': `EVENING BRIEF — 1700. Synthesize afternoon thermal shift and feeding corridor probability.
      Seed tomorrow's morning plan from today's conditions.
      One paragraph. End with tomorrow's first action.`,
  };

  const windowInstructions = isFishing ? FISHING_WINDOW_INSTRUCTIONS : huntingWindowInstructions;

  // Filter agent hits by domain: fishing gets all OUTDOOR_ agents; hunting excludes fishing terms
  const activeAgentHits = isFishing
    ? context.agentHits.filter(hit => hit.startsWith('OUTDOOR_'))
    : context.agentHits.filter(hit => hit.startsWith('OUTDOOR_') && !isFishingTerm(hit));

  // Step 1: build LOCATION CONTEXT block
  const loc = context.locationProfile;
  let locationBlock = '';
  if (loc) {
    const geo = loc.geo ?? {};
    const unitLabel = [geo.unit, geo.region, geo.state].filter(Boolean).join(' — ');
    const nws = (loc.nws_grid_office && loc.nws_grid_x != null && loc.nws_grid_y != null)
      ? `NWS gridpoint: ${loc.nws_grid_office} ${loc.nws_grid_x}/${loc.nws_grid_y}`
      : '';
    const elev = loc.elevation_ft ? `Elevation: ${loc.elevation_ft}ft` : '';

    // Step 3: append terrain cache if available
    const tc = context.terrainCache;
    let terrainLine = '';
    if (tc) {
      const parts: string[] = [];
      if (tc.slope_aspect) parts.push(`Aspect: ${tc.slope_aspect}`);
      if (tc.thermal_belt_min_ft != null && tc.thermal_belt_max_ft != null)
        parts.push(`Thermal belt: ${tc.thermal_belt_min_ft}–${tc.thermal_belt_max_ft}ft`);
      if (tc.water_proximity_m != null) parts.push(`Nearest water: ~${tc.water_proximity_m}m`);
      if (tc.bedding_probability != null) parts.push(`Bedding probability: ${(Number(tc.bedding_probability) * 100).toFixed(0)}%`);
      if (parts.length) terrainLine = `Terrain data: ${parts.join(' | ')}`;
    }

    locationBlock = `
LOCATION CONTEXT (terrain facts for this spot, not a list of places):
${unitLabel ? `Unit: ${unitLabel}` : ''}
${nws}
${elev}
${terrainLine}

Use elevation, aspect and the terrain data above for wind, thermal and approach references.
Do not name a place from them: see the PLACE NAMES rule below.
`.replace(/\n{3,}/g, '\n\n').trim();
  }

  const domainConstraintBlock = isFishing
    ? FISHING_PROMPT_ADDENDUM
    : `DOMAIN CONSTRAINT: This is an elk hunting brief. Discard any aquatic insect, hatch window, salmon, or fish ladder data — these are cross-domain noise. Do not reference water temperature in the context of fish or insect activity. Water temperature is only relevant as an elk hydration signal.

WATER TEMPERATURE NOTE: USGS water temperature data is included as an ELK HYDRATION signal only. A 10°C creek temperature crossing indicates elk will prioritize this water source. Do not interpret water temperature as a fish or aquatic insect signal. Do not mention fish, aquatic insects, or hatch windows in this brief.`;

  const evidence = context.evidence;
  const noEvidence = evidence !== undefined && evidence.count === 0;
  const evidenceBlock = noEvidence
    ? `EVIDENCE (last ${EVIDENCE_WINDOW_DAYS} days): NONE. No readings and no signals exist for this objective.
There is nothing to confirm. Write only general seasonal context, every sentence worded as typical for the time of year.
Do not cite any reading, value, trend, closure or condition as current.`
    : `EVIDENCE (last ${EVIDENCE_WINDOW_DAYS} days; the only things you may state as confirmed):
${evidence && evidence.lines.length > 0 ? evidence.lines.map(l => `- ${l}`).join('\n') : '- Signals were tagged to this objective, but no reading with a known unit is available.'}
${evidence && evidence.missing.length > 0 ? `MISSING DATA: ${evidence.missing.map(m => `no ${m} yet`).join('; ')}.` : ''}`.trim();

  const placeNames = context.placeNames && context.placeNames.length > 0
    ? context.placeNames.join('; ')
    : '(none: say "your spot")';

  const evidenceRules = `EVIDENCE RULES (these override everything else below):
1. Two kinds of statements, kept apart in the synthesis and the windows.
   CONFIRMED: only what the EVIDENCE block shows. Cite the reading and its value with its unit.
   TYPICAL: general knowledge of the season. Allowed and encouraged, because a hedged seasonal note is useful.
   Always introduce it with "Typical for this time of year, not confirmed:" and never word it as a fact about today.
2. PLACE NAMES: never name a river, creek, road, trailhead, closure, forest, land agency, drainage, corridor or region
   unless the name is in the EVIDENCE block or in this list of the objective's own fields: ${placeNames}.
   Do not infer a watershed, drainage or "corridor" from the terrain data. Say "your spot", or use the water body name above.
3. UNITS: never give a number without its unit. Use the units and conversions exactly as written in the EVIDENCE block.
4. MISSING DATA: if a data category is missing, say so in one clause (for example "no water temperature reading yet").
5. A reference-gauge, distant-gauge or state-level reading must never be described as the condition at this spot.
   Readings labeled "(reference gauge, not this water)", "(distant gauge ... may not match this water)" or "State-level ... (not this water)" are background only.
6. A reading labeled with a USGS gauge name and its distance may be stated as "the nearest USGS gauge, <name>, <n> miles from your spot, reads ...", never as the condition at the spot itself.
   A reading labeled "NWS forecast ... (not a measurement)" is a forecast and must be worded as one.`;

  return `You are Meridian's Strike Brief engine for the outdoor / ${isFishing ? 'fishing' : 'hunting'} domain.

TIME WINDOW: ${windowInstructions[timeWindow] ?? windowInstructions['0600']}

OBJECTIVE: ${context.objectiveTitle}
DOMAIN: ${context.domain}
PATTERN MATCH: ${context.patternMatchYear ? `Current conditions match ${context.patternMatchYear} at ${context.patternMatchScore}% similarity` : 'No pattern match'}
CONFIDENCE TIER: ${context.confidenceTier}
${windowFact ? `HUNT WINDOW (hard fact, overrides any inference): ${windowFact}\n` : ''}
${locationBlock ? locationBlock + '\n\n' : ''}${evidenceBlock}

BACKGROUND, NOT EVIDENCE (a general profile of this kind of objective; do not state it as confirmed for this spot):
${context.signalBrief}

BACKGROUND EVENTS (general enrichment events, not confirmed for this spot):
${context.domainEvents}

AGENTS THAT FIRED TODAY (names only, no values; do not describe what they read):
${activeAgentHits.length > 0 ? activeAgentHits.join('\n') : 'No new agent hits today'}

${domainConstraintBlock}

${evidenceRules}

INTELLIGENCE INTEGRITY STANDARD:
- T1: Government/agency structured data — state as fact
- T2: Verified field observation — state as reported
- T3: Reported/anecdotal — qualify explicitly
- T4: Modeled/inferred — flag as projection

RULES:
- Never state as fact what has not been confirmed by a named, timestamped, verifiable source
- If objective notes contain "condition-gated" do NOT generate date urgency
- One paragraph maximum per time window
- Tell the user something they could not have known without Meridian
- If there is nothing new to say at 1100, say so in one sentence. Do not pad.

OUTPUT FORMAT (JSON only, no markdown):
{
  "synthesis": "one paragraph brief",
  "lead_signal": "single most actionable signal in one sentence",
  "go_no_go": "GO | NO_GO | CONDITIONAL | MONITOR",
  "condition_delta": "what changed since last brief, or null if first brief of day",
  "confidence_tier": "T1 | T2 | T3 | T4"
}`;
}

// --- Main generator ---

// --- Window notices (FF-089 P0) ---

type WindowNotice = { fact?: string; prefix: string; capGo: boolean }

// Deterministic text for objectives whose window is not open. Applied in code, so
// the stored brief says it even if the model did not.
function windowNoticeFor(evaluation: WindowEvaluation): WindowNotice | null {
  const { state, detail } = evaluation;
  if (state === 'season_not_open' && detail.season_start) {
    const date = formatBriefDate(detail.season_start);
    return {
      fact: `the season opens ${date} and has not started. Do not tell the hunter to go today.`,
      prefix: `Season opens ${date}.`,
      capGo: true,
    };
  }
  if (state === 'upcoming' && detail.trip_start) {
    const date = formatBriefDate(detail.trip_start);
    return {
      fact: `the hunting trip starts ${date}. Do not tell the hunter to go today.`,
      prefix: `Trip opens ${date}.`,
      capGo: true,
    };
  }
  if (state === 'no_dates') {
    return {
      prefix: detail.code === 'unparseable_dates'
        ? 'Hunt dates could not be read; briefs assume you are hunting now.'
        : 'No hunt dates set; briefs assume you are hunting now.',
      capGo: false,
    };
  }
  return null;
}

// Closed hunts: the row is written by code, never by the model. Returns an existing
// CLOSED row for today if there is one, whatever window it was written under.
async function writeClosedBrief(
  supabase: ReturnType<typeof createServiceClient>,
  objectiveId: string,
  userId: string,
  domain: string,
  today: string,
  evaluation: WindowEvaluation
): Promise<StrikeBriefRow> {
  const { data: existing } = await supabase
    .from('strike_briefs')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('brief_date', today)
    .eq('go_no_go', 'CLOSED')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing as StrikeBriefRow;

  const fields = buildClosedBriefFields(evaluation);
  const spotId = await loadActiveSpotId(supabase, objectiveId);
  const { data: brief, error } = await supabase
    .from('strike_briefs')
    .insert({
      objective_id: objectiveId,
      user_id: userId,
      spot_id: spotId,
      brief_date: today,
      domain,
      pattern_match_year: null,
      agent_hits: [],
      ...fields,
    })
    .select()
    .single();

  if (error?.code === '23505') {
    // A non-closed row already holds today's neutral window. CLOSED replaces it.
    const { data: replaced, error: updErr } = await supabase
      .from('strike_briefs')
      .update(fields)
      .eq('objective_id', objectiveId)
      .eq('brief_date', today)
      .eq('time_window', fields.time_window)
      .select()
      .single();
    if (updErr || !replaced) throw new Error(`[StrikeBrief] closed replace failed: ${updErr?.message}`);
    return replaced as StrikeBriefRow;
  }

  if (error || !brief) throw new Error(`[StrikeBrief] closed DB write failed: ${error?.message}`);
  return brief as StrikeBriefRow;
}

// FF-091: an objective without a location gets no brief. Nothing is generated that would look local.
export class LocationNotSetError extends Error {
  constructor() {
    super('Location not set. Add a hunt spot to get local intel.');
    this.name = 'LocationNotSetError';
  }
}

// The cheapest model, for a brief that has nothing to confirm.
const NO_EVIDENCE_MODEL = 'claude-haiku-4-5-20251001';
// The lowest confidence tier the code uses (see TIER_PCT).
const LOWEST_CONFIDENCE_TIER = 'T4';

// True when the stored brief is a no-evidence brief and evidence has since arrived.
async function isStaleNoEvidenceBrief(
  supabase: ReturnType<typeof createServiceClient>,
  brief: StrikeBriefRow,
  objectiveId: string,
  userId: string,
): Promise<boolean> {
  if (!brief.synthesis?.includes(ZERO_EVIDENCE_BANNER)) return false;
  const evidence = await loadEvidence(supabase, { objectiveId, userId });
  return evidence.count > 0;
}

export async function generateStrikeBrief(
  objectiveId: string,
  userId: string
): Promise<StrikeBriefRow> {
  const supabase = createServiceClient();
  const timeWindow = getTimeWindow();
  const today = new Date().toISOString().split('T')[0];

  // FF-089 P0: the code decides whether the hunt is over. Closed hunts never reach the model.
  const windowCheck = await loadObjectiveWindow(supabase, objectiveId);
  if (windowCheck && isEndedState(windowCheck.evaluation.state)) {
    return writeClosedBrief(
      supabase,
      objectiveId,
      userId,
      windowCheck.profile.domain ?? 'elk_hunt',
      today,
      windowCheck.evaluation
    );
  }
  const { data: locationRow } = await supabase
    .from('objective_profiles')
    .select('lat, lon, nws_grid_office, nws_grid_x, nws_grid_y')
    .eq('objective_id', objectiveId)
    .maybeSingle();
  if (!hasLocation(locationRow)) throw new LocationNotSetError();
  const activeSpotId = await loadActiveSpotId(supabase, objectiveId);

  const windowNotice = windowCheck ? windowNoticeFor(windowCheck.evaluation) : null;

  // Return cached brief if one exists for this window today.
  // A CLOSED row is not a cache hit: the hunt has reactivated, so a real brief is due.
  const { data: existing } = await supabase
    .from('strike_briefs')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('brief_date', today)
    .eq('time_window', timeWindow)
    .or('go_no_go.is.null,go_no_go.neq.CLOSED')
    .maybeSingle();

  // A no-evidence brief is replaced once evidence exists (for example after Run Sweep), so the banner does not outlive
  // the data that makes it untrue.
  if (existing && !(await isStaleNoEvidenceBrief(supabase, existing as StrikeBriefRow, objectiveId, userId))) {
    return existing as StrikeBriefRow;
  }

  // Build context
  const context = await buildStrikeBriefContext(objectiveId, userId);
  const prompt = buildStrikeBriefPrompt(context, timeWindow, windowNotice?.fact);

  // FF-098: with no evidence the brief is still written, on the cheap model, as typical-for-the-season only.
  const noEvidence = context.evidence !== undefined && context.evidence.count === 0;
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: noEvidence ? NO_EVIDENCE_MODEL : 'claude-sonnet-4-6',
    max_tokens: noEvidence ? 500 : 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('[StrikeBrief] Failed to parse Sonnet response as JSON');

  let parsed: {
    synthesis?: string;
    lead_signal?: string;
    go_no_go?: string;
    condition_delta?: string;
    confidence_tier?: string;
  } = {};
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('[StrikeBrief] JSON parse failed');
  }

  // Unknown model values are coerced to MONITOR (never GO), so the CHECK constraint holds.
  let goNoGo: string | null = null;
  if (parsed.go_no_go) {
    const normalized = parsed.go_no_go.trim().toUpperCase().replace(/[\s-]+/g, '_');
    goNoGo = (MODEL_GO_NO_GO as readonly string[]).includes(normalized) ? normalized : 'MONITOR';
  }
  let synthesis = parsed.synthesis ?? raw;
  if (windowNotice) {
    if (windowNotice.capGo && (goNoGo === 'GO' || goNoGo === 'CONDITIONAL')) goNoGo = 'MONITOR';
    synthesis = `${windowNotice.prefix} ${synthesis}`;
  }

  // No evidence: the code fixes the banner, the verdict and the tier. The model cannot raise them.
  let tierToStore: string = parsed.confidence_tier ?? context.confidenceTier;
  if (noEvidence) {
    synthesis = `${ZERO_EVIDENCE_BANNER}\n\n${synthesis}`;
    goNoGo = 'MONITOR';
    tierToStore = LOWEST_CONFIDENCE_TIER;
  }

  // Upsert on the unique (objective, date, window) key: the only row it can replace is a
  // CLOSED row from before the hunt reactivated (the cache check above skips other rows).
  const { data: brief, error } = await supabase
    .from('strike_briefs')
    .upsert({
      objective_id: objectiveId,
      user_id: userId,
      spot_id: activeSpotId,
      brief_date: today,
      time_window: timeWindow,
      domain: context.domain,
      synthesis,
      // No evidence means no lead signal and no agent hits, so no chips are built from this brief.
      lead_signal: noEvidence ? null : (parsed.lead_signal ?? null),
      go_no_go: goNoGo,
      condition_delta: noEvidence ? null : (parsed.condition_delta ?? null),
      pattern_match_year: context.patternMatchYear,
      confidence_tier: tierToStore,
      agent_hits: noEvidence
        ? []
        : context.domain === 'fishing'
          ? context.agentHits
          : context.agentHits.filter(h => !isFishingTerm(h)),
    }, { onConflict: 'objective_id,brief_date,time_window' })
    .select()
    .single();

  if (error || !brief) throw new Error(`[StrikeBrief] DB write failed: ${error?.message}`);

  const briefId = (brief as { id: string }).id;

  // FF-076: Movement windows (Haiku, non-fatal)
  try {
    const movementWindows = await generateMovementWindows(
      context.domain,
      context.patternMatchYear,
      context.signalBrief,
      context.rawMacroEvents
    );
    await supabase.from('strike_briefs').update({ movement_windows: movementWindows }).eq('id', briefId);
    (brief as Record<string, unknown>).movement_windows = movementWindows;
  } catch (err) {
    console.error('[StrikeBrief] Movement windows failed:', err);
  }

  // FF-076: Terrain intelligence (Sonnet, non-fatal, only when lat/lng available)
  try {
    if (context.geoProfile?.lat !== undefined && context.geoProfile?.lng !== undefined) {
      const terrainResult = await getTerrainIntel(
        context.geoProfile.lat,
        context.geoProfile.lng,
        context.domain,
        context.domainProfile ?? {}
      );
      await supabase.from('strike_briefs').update({
        terrain_intel: terrainResult.intel,
        terrain_source: terrainResult.source,
      }).eq('id', briefId);
      (brief as Record<string, unknown>).terrain_intel = terrainResult.intel;
      (brief as Record<string, unknown>).terrain_source = terrainResult.source;
    }
  } catch (err) {
    console.error('[StrikeBrief] Terrain intel failed:', err);
  }

  // FF-087: Append confidence snapshot to any active campaign_unit for this objective
  const TIER_PCT: Record<string, number> = { T1: 90, T2: 74, T3: 55, T4: 35 }
  const finalTier = (brief as { confidence_tier?: string }).confidence_tier ?? context.confidenceTier
  const finalGoNoGo = (brief as { go_no_go?: string }).go_no_go ?? null

  try {
    const campaignServiceClient = createServiceClient()
    const { data: campaignUnit } = await campaignServiceClient
      .from('campaign_units')
      .select('id, campaign_id, confidence_trajectory')
      .eq('objective_id', objectiveId)
      .eq('status', 'active')
      .limit(1)
      .single()

    if (campaignUnit) {
      const existingTrajectory = Array.isArray(campaignUnit.confidence_trajectory)
        ? campaignUnit.confidence_trajectory
        : []

      const snapshot = {
        date: today,
        confidence_pct: TIER_PCT[finalTier] ?? 50,
        tier: finalTier,
        go_no_go: finalGoNoGo ?? 'MONITOR',
      }

      await campaignServiceClient
        .from('campaign_units')
        .update({
          confidence_trajectory: [...existingTrajectory, snapshot],
          updated_at: new Date().toISOString(),
        })
        .eq('id', campaignUnit.id)

      console.log('[ff087] confidence snapshot appended for objective:', objectiveId)

      // FF-087: Pivot check — evaluate against all campaign units
      const { data: allUnits } = await campaignServiceClient
        .from('campaign_units')
        .select('id, objective_id, role, rank, status, confidence_trajectory')
        .eq('campaign_id', campaignUnit.campaign_id)
        .eq('status', 'active')

      if (allUnits && allUnits.length > 1) {
        const primary   = allUnits.find(u => u.role === 'primary')
        const fallbacks = allUnits.filter(u => u.role !== 'primary')

        if (primary && fallbacks.length) {
          const pivot = evaluatePivot(
            primary as unknown as Parameters<typeof evaluatePivot>[0],
            fallbacks as unknown as Parameters<typeof evaluatePivot>[1]
          )

          if (pivot?.should_pivot) {
            await campaignServiceClient
              .from('campaign_units')
              .update({
                pivot_recommended: true,
                pivot_reason: pivot.reason,
                pivot_recommended_at: new Date().toISOString(),
              })
              .eq('objective_id', pivot.from_objective_id)

            console.log('[ff087] pivot recommended:', pivot.reason)
          }
        }
      }
    }
  } catch (err) {
    console.error('[ff087] campaign snapshot/pivot failed:', err)
  }

  return brief as StrikeBriefRow;
}
