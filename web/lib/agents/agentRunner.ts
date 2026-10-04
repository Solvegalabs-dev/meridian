import { createServiceClient } from '@/lib/supabase/server';
import { buildUrl, evaluateThreshold, writeEvent, logRun } from './agentHelpers';
import { getMoonPhase } from '@/lib/swarm/agents/outdoor/moonPhase';
import { updateAgentHealth } from './agentHealth';
import { recordAndCheckSignal, recordEstimatedSignal } from './agentSignalHistory';
import { computeTerrainIntelligence } from '@/lib/swarm/agents/outdoor/terrain';
import { computeHatchWindow } from '@/lib/swarm/agents/outdoor/fishingPhenology';
import { computeSalmonRunProgression } from '@/lib/swarm/agents/outdoor/salmonRunProgression';
import { computeCollarPatterns } from '@/lib/swarm/agents/outdoor/collarPatternExtractor';
import { loadActiveSpotId } from '@/lib/spots/activeSpot';
import { LOCATION_NOT_SET, shouldSkipForLocation, type LocationFields } from './geoLocation';

// Returns: number = value, null = known calculator but no data (→ miss), undefined = unknown key (→ error)
async function runCalculated(calculatorKey: string, objectiveId?: string): Promise<number | null | undefined> {
  switch (calculatorKey) {
    case 'moon_phase_meeus':
      return getMoonPhase(new Date()).illumination;
    case 'terrain_composite':
      return computeTerrainIntelligence(objectiveId);
    case 'hatch_window_meeus':
      return computeHatchWindow();
    case 'salmon_run_progression':
      return computeSalmonRunProgression();
    case 'movebank_collar_patterns':
      return computeCollarPatterns(objectiveId);
    default:
      return undefined;
  }
}

export type AgentResult = {
  agentKey: string;
  result: 'hit' | 'miss' | 'error' | 'skip';
  eventId?: string;
  durationMs: number;
  thresholdValueObserved?: number;
  errorMessage?: string;
};

export async function runAgent(
  agentKey: string,
  geoContext: {
    state?: string;
    county?: string;
    domain?: string;
    objectiveId?: string;
    spotId?: string;
  }
): Promise<AgentResult> {
  const start = Date.now();
  const supabase = createServiceClient();
  // FF-091: tag every run with the active spot, so the brief can use only this area's hits.
  if (geoContext.objectiveId) {
    geoContext = { ...geoContext, spotId: (await loadActiveSpotId(supabase, geoContext.objectiveId)) ?? undefined };
  }

  // 1. Load agent config
  const { data: agent, error } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('agent_key', agentKey)
    .eq('is_active', true)
    .single();

  if (error || !agent) {
    return {
      agentKey,
      result: 'error',
      durationMs: Date.now() - start,
      errorMessage: 'Agent config not found',
    };
  }

  // 2. Check cadence — skip if last hit was within cadence window.
  // Scoped per objective: the swarm runs one agent once per assigned objective (FF-089).
  let lastRunQuery = supabase
    .from('agent_run_log')
    .select('ran_at')
    .eq('agent_key', agentKey)
    .eq('result', 'hit');
  if (geoContext.objectiveId) {
    lastRunQuery = lastRunQuery.eq('geo_context->>objectiveId', geoContext.objectiveId);
  }
  const { data: lastRun } = await lastRunQuery
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastRun) {
    const minutesSinceLastRun = (Date.now() - new Date(lastRun.ran_at as string).getTime()) / 60000;
    if (minutesSinceLastRun < agent.cadence_minutes) {
      await logRun(supabase, agentKey, 'skip', Date.now() - start, undefined, undefined, geoContext);
      return { agentKey, result: 'skip', durationMs: Date.now() - start };
    }
  }

  // 3a. CALCULATED: prefix — run local function, skip fetch entirely
  if ((agent.source_url_template as string).startsWith('CALCULATED:')) {
    const calculatorKey = (agent.source_url_template as string).slice('CALCULATED:'.length);
    const calculatedBody = await runCalculated(calculatorKey, geoContext.objectiveId);

    if (calculatedBody === undefined) {
      const errMsg = `Unknown calculator: ${calculatorKey}`;
      await logRun(supabase, agentKey, 'error', Date.now() - start, undefined, undefined, geoContext, errMsg);
      await updateAgentHealth(supabase, agentKey, 'error', errMsg).catch(e => console.error('[agentHealth] update failed:', e));
      return { agentKey, result: 'error', durationMs: Date.now() - start, errorMessage: errMsg };
    }

    // null = known calculator with no data available yet (e.g. empty terrain_cache) → miss
    if (calculatedBody === null) {
      await logRun(supabase, agentKey, 'miss', Date.now() - start, undefined, undefined, geoContext);
      await updateAgentHealth(supabase, agentKey, 'miss').catch(e => console.error('[agentHealth] update failed:', e));
      return { agentKey, result: 'miss', durationMs: Date.now() - start };
    }

    const { crossed } = evaluateThreshold(
      calculatedBody,
      agent.threshold_type as string,
      agent.threshold_value as number | null,
      agent.threshold_keywords as string[] | null
    );
    // For CALCULATED: agents the computed value is always the observation,
    // regardless of whether evaluateThreshold echoes it back.
    const observedValue = calculatedBody;

    if (!crossed) {
      await logRun(supabase, agentKey, 'miss', Date.now() - start, undefined, observedValue, geoContext);
      await updateAgentHealth(supabase, agentKey, 'miss').catch(e => console.error('[agentHealth] update failed:', e));
      await recordAndCheckSignal(supabase, agentKey, geoContext.objectiveId, observedValue).catch(e => console.error('[signalHistory] record failed:', e));
      return { agentKey, result: 'miss', durationMs: Date.now() - start, thresholdValueObserved: observedValue };
    }

    const eventId = await writeEvent(
      supabase,
      agent as Parameters<typeof writeEvent>[1],
      geoContext,
      observedValue,
      `CALCULATED:${calculatorKey}`
    );
    await logRun(supabase, agentKey, 'hit', Date.now() - start, eventId, observedValue, geoContext);
    await updateAgentHealth(supabase, agentKey, 'hit').catch(e => console.error('[agentHealth] update failed:', e));
    void recordAndCheckSignal(supabase, agentKey, geoContext.objectiveId, observedValue).catch(e => console.error('[signalHistory] record failed:', e));
    return { agentKey, result: 'hit', eventId, durationMs: Date.now() - start, thresholdValueObserved: observedValue };
  }

  // 3b. Load objective geo profile for URL substitution (best-effort)
  let geoProfile: (LocationFields & {
    hunt_unit_id?: string | null
    usgs_gauge_ids?: string[] | null
    snotel_station_ids?: string[] | null
  }) | null = null;
  if (geoContext.objectiveId) {
    const { data: gp } = await supabase
      .from('objective_profiles')
      .select('lat, lon, nws_grid_office, nws_grid_x, nws_grid_y, state, hunt_unit_id, usgs_gauge_ids, snotel_station_ids')
      .eq('objective_id', geoContext.objectiveId)
      .maybeSingle();
    geoProfile = gp;
  }

  // 3c. FF-091 Part C: no location means no geo-templated run. There are no fallback
  // coordinates, grid or state, so an objective never gets another area's weather.
  const rawTemplate = agent.source_url_template as string;
  if (shouldSkipForLocation(rawTemplate, geoProfile, geoContext.state)) {
    await logRun(supabase, agentKey, 'skip', Date.now() - start, undefined, undefined, geoContext, LOCATION_NOT_SET);
    return { agentKey, result: 'skip', durationMs: Date.now() - start };
  }

  // Build URL with geo substitution. FF-089 geo vars are substituted before buildUrl(),
  // which would otherwise fill {state} from geoContext.state and ignore the resolved profile state.
  const template = (agent.source_url_template as string)
    .replace(/\{usgs_gauge_ids\}/g,    geoProfile?.usgs_gauge_ids?.join(',') ?? '')
    .replace(/\{usgs_gauge_id\}/g,     geoProfile?.usgs_gauge_ids?.[0] ?? '')
    .replace(/\{snotel_station_id\}/g, geoProfile?.snotel_station_ids?.[0] ?? '')
    .replace(/\{state\}/g,             geoProfile?.state ?? geoContext.state ?? '')
    .replace(/\{hunt_unit_id\}/g,      geoProfile?.hunt_unit_id ?? '');
  const url = buildUrl(template, geoContext)
    .replace('{nws_grid_office}', geoProfile?.nws_grid_office ?? '')
    .replace('{nws_grid_x}',     String(geoProfile?.nws_grid_x ?? ''))
    .replace('{nws_grid_y}',     String(geoProfile?.nws_grid_y ?? ''))
    .replace('{lat}',            String(geoProfile?.lat ?? ''))
    .replace('{lon}',            String(geoProfile?.lon ?? ''));

  try {
    // 4. Fetch — Accept header excludes application/json so HTML pages respond correctly
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { Accept: 'text/html, application/xhtml+xml, */*' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') ?? '';
    // HTML responses are always read as plain text — never JSON.parse
    const body = (!contentType.includes('text/html') && contentType.includes('json'))
      ? await response.json()
      : await response.text();

    // 5. Threshold evaluation
    // For OUTDOOR_WINDY_API: forecast windSpeed is a string ("15 mph", "15 to 25 mph").
    // Parse the first integer and evaluate against it directly so threshold value_above:30 (mph) works.
    let evalBody: unknown = body;
    if (agentKey === 'OUTDOOR_WINDY_API' && typeof body === 'object' && body !== null) {
      const b = body as Record<string, unknown>;
      const periods = (b.properties as Record<string, unknown> | undefined)?.periods;
      if (Array.isArray(periods) && periods.length > 0) {
        const ws = (periods[0] as Record<string, unknown>).windSpeed;
        if (typeof ws === 'string') {
          const m = ws.match(/\d+/);
          if (m) evalBody = parseFloat(m[0]);
        }
      }
    }
    const { crossed, observedValue } = evaluateThreshold(
      evalBody,
      agent.threshold_type as string,
      agent.threshold_value as number | null,
      agent.threshold_keywords as string[] | null
    );

    if (!crossed) {
      await logRun(supabase, agentKey, 'miss', Date.now() - start, undefined, observedValue, geoContext);
      await updateAgentHealth(supabase, agentKey, 'miss').catch(e => console.error('[agentHealth] update failed:', e));
      if (observedValue !== undefined) {
        await recordAndCheckSignal(supabase, agentKey, geoContext.objectiveId, observedValue).catch(e => console.error('[signalHistory] record failed:', e));
      }
      return { agentKey, result: 'miss', durationMs: Date.now() - start, thresholdValueObserved: observedValue };
    }

    // 6. Write event to enterprise_macro_events
    const eventId = await writeEvent(supabase, agent as Parameters<typeof writeEvent>[1], geoContext, observedValue, url);

    // 7. Log run
    await logRun(supabase, agentKey, 'hit', Date.now() - start, eventId, observedValue, geoContext);
    await updateAgentHealth(supabase, agentKey, 'hit').catch(e => console.error('[agentHealth] update failed:', e));
    if (observedValue !== undefined) {
      await recordAndCheckSignal(supabase, agentKey, geoContext.objectiveId, observedValue).catch(e => console.error('[signalHistory] record failed:', e));
    }

    return { agentKey, result: 'hit', eventId, durationMs: Date.now() - start, thresholdValueObserved: observedValue };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    await logRun(supabase, agentKey, 'error', Date.now() - start, undefined, undefined, geoContext, msg);
    await updateAgentHealth(supabase, agentKey, 'error', msg).catch(e => console.error('[agentHealth] update failed:', e));
    await recordEstimatedSignal(supabase, agentKey, geoContext.objectiveId).catch(e => console.error('[signalHistory] estimation failed:', e));
    return { agentKey, result: 'error', durationMs: Date.now() - start, errorMessage: msg };
  }
}
