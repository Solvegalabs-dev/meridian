import { createServiceClient } from '@/lib/supabase/server';
import { getAnthropicClient } from '@/lib/anthropic/client';
import { generateMovementWindows } from './movementPrediction';
import { getTerrainIntel } from './terrainIntelligence';
import { evaluatePivot } from './pivot-logic';
import { FISHING_PROMPT_ADDENDUM, FISHING_WINDOW_INSTRUCTIONS } from '@/lib/strike/config/fishing-synthesis-prompt';

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
  go_no_go: string | null;
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
    const { data: runLogs } = await supabase
      .from('agent_run_log')
      .select('agent_key, ran_at')
      .in('agent_key', agentKeys)
      .eq('result', 'hit')
      .gte('ran_at', today);
    agentHits = (runLogs ?? []).map(r => r.agent_key as string);
  }

  // Location profile from objective_profiles (lat/lon, NWS gridpoint, geo unit label, domain)
  const { data: locationProfile } = await supabase
    .from('objective_profiles')
    .select('lat, lon, geo, nws_grid_office, nws_grid_x, nws_grid_y, elevation_ft, domain')
    .eq('objective_id', objectiveId)
    .maybeSingle();

  // Use objective_profiles.domain as fallback when no domain_profile row exists
  if (domain === 'elk_hunt' && locationProfile) {
    domain = (locationProfile as { domain?: string }).domain ?? domain;
  }

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

export function buildStrikeBriefPrompt(context: StrikeBriefContext, timeWindow: string): string {
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
    const coords = (loc.lat != null && loc.lon != null)
      ? `Coordinates: ${loc.lat}°N, ${Math.abs(loc.lon)}°W`
      : '';
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
LOCATION CONTEXT (make every directional and terrain reference specific to this location):
${unitLabel ? `Unit: ${unitLabel}` : ''}
${coords}
${nws}
${elev}
${terrainLine}

Derive all wind, thermal, approach, and terrain references from this specific location.
Do not use generic directional language. Name specific terrain features where derivable
from elevation and aspect data. Reference water sources by drainage position relative
to these coordinates, not generic corridor language.
`.replace(/\n{3,}/g, '\n\n').trim();
  }

  const domainConstraintBlock = isFishing
    ? FISHING_PROMPT_ADDENDUM
    : `DOMAIN CONSTRAINT: This is an elk hunting brief. Discard any aquatic insect, hatch window, salmon, or fish ladder data — these are cross-domain noise. Do not reference water temperature in the context of fish or insect activity. Water temperature is only relevant as an elk hydration signal.

WATER TEMPERATURE NOTE: USGS water temperature data is included as an ELK HYDRATION signal only. A 10°C creek temperature crossing indicates elk will prioritize this water source. Do not interpret water temperature as a fish or aquatic insect signal. Do not mention fish, aquatic insects, or hatch windows in this brief.`;

  return `You are Meridian's Strike Brief engine for the outdoor / ${isFishing ? 'fishing' : 'hunting'} domain.

TIME WINDOW: ${windowInstructions[timeWindow] ?? windowInstructions['0600']}

OBJECTIVE: ${context.objectiveTitle}
DOMAIN: ${context.domain}
PATTERN MATCH: ${context.patternMatchYear ? `Current conditions match ${context.patternMatchYear} at ${context.patternMatchScore}% similarity` : 'No pattern match'}
CONFIDENCE TIER: ${context.confidenceTier}

${locationBlock ? locationBlock + '\n\n' : ''}SIGNAL BRIEF (from sub-agents):
${context.signalBrief}

DOMAIN EVENTS (from enrichment engine):
${context.domainEvents}

AGENT HITS TODAY:
${activeAgentHits.length > 0 ? activeAgentHits.join('\n') : 'No new agent hits today'}

${domainConstraintBlock}

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

export async function generateStrikeBrief(
  objectiveId: string,
  userId: string
): Promise<StrikeBriefRow> {
  const supabase = createServiceClient();
  const timeWindow = getTimeWindow();
  const today = new Date().toISOString().split('T')[0];

  // Return cached brief if one exists for this window today
  const { data: existing } = await supabase
    .from('strike_briefs')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('brief_date', today)
    .eq('time_window', timeWindow)
    .maybeSingle();

  if (existing) return existing as StrikeBriefRow;

  // Build context
  const context = await buildStrikeBriefContext(objectiveId, userId);
  const prompt = buildStrikeBriefPrompt(context, timeWindow);

  // Call Sonnet
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 800,
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

  const { data: brief, error } = await supabase
    .from('strike_briefs')
    .insert({
      objective_id: objectiveId,
      user_id: userId,
      brief_date: today,
      time_window: timeWindow,
      domain: context.domain,
      synthesis: parsed.synthesis ?? raw,
      lead_signal: parsed.lead_signal ?? null,
      go_no_go: parsed.go_no_go ?? null,
      condition_delta: parsed.condition_delta ?? null,
      pattern_match_year: context.patternMatchYear,
      confidence_tier: parsed.confidence_tier ?? context.confidenceTier,
      agent_hits: context.domain === 'fishing'
        ? context.agentHits
        : context.agentHits.filter(h => !isFishingTerm(h)),
    })
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
