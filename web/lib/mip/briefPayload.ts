// Shared MIP brief payload builder — partner-agnostic (GoHunt/FishBrain/Strike UI consume the same shape).
// Extracted from app/api/mip/brief/route.ts so server components can call it directly
// instead of self-fetching the API route.
import { createServiceClient } from '@/lib/supabase/server'
import { getCollarBriefAugmentation, parseTempF } from '@/lib/swarm/agents/outdoor/collarCalibration'
import { loadObjectiveWindow, isEndedState } from '@/lib/objectives/objectiveWindow'
import { closedSynthesis } from '@/lib/strikeBrief/closedBrief'
import { briefGeneratedAt } from '@/lib/strike/briefFreshness'

export type SignalChip = { label: string; value: string; status: 'ok' | 'warn' | 'critical' }
export type TimeWindow = { window: string; action: string; priority: 'high' | 'medium' | 'low' }
export type MapPin = { type: string; lat: number; lon: number; confidence: string; label: string }

export type MipBriefPayload = {
  objective_id: string
  brief_generated_at: string
  confidence_tier: number
  confidence_pct: number
  summary: string
  signal_chips: SignalChip[]
  time_windows: TimeWindow[]
  map_pins: MapPin[]
  sources: string[]
  attribution: 'Powered by Meridian Arc'
  // Additive (FF-089 P0). Window state: active | upcoming | season_not_open | season_closed | trip_ended | no_dates
  objective_state?: string
}

export function pendingBriefPayload(objectiveId: string): MipBriefPayload {
  return {
    objective_id: objectiveId,
    brief_generated_at: new Date().toISOString(),
    confidence_tier: 4,
    confidence_pct: 0,
    summary: 'Intelligence sweep pending — check back after next scheduled run.',
    signal_chips: [],
    time_windows: [],
    map_pins: [],
    sources: [],
    attribution: 'Powered by Meridian Arc',
  }
}

function confidenceTier(pct: number): number {
  if (pct >= 75) return 1
  if (pct >= 50) return 2
  if (pct >= 25) return 3
  return 4
}

// strike_briefs.confidence_tier stores 'T1'/'T2'/'T3'/'T4' text
function briefTierToInt(tier: string | null): number {
  if (!tier) return 4
  const n = parseInt(tier.replace(/\D/g, ''), 10)
  return isNaN(n) ? 4 : Math.min(Math.max(n, 1), 4)
}

function agentKeyToLabel(key: string): string {
  // OUTDOOR_NOAA_TEMP → "NOAA Temp" · UNIV_FRED_CPI → "FRED CPI"
  const parts = key.split('_').slice(1)
  return parts.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ')
}

function chipStatus(result: string | null): 'ok' | 'warn' | 'critical' {
  if (result === 'hit') return 'ok'
  if (result === 'error') return 'critical'
  return 'warn'
}

function windowPriority(probability: number | null): 'high' | 'medium' | 'low' {
  if (probability == null) return 'low'
  if (probability >= 0.7) return 'high'
  if (probability >= 0.4) return 'medium'
  return 'low'
}

function pinConfidence(bedding: number | null): string {
  if (bedding == null) return 'low'
  if (bedding >= 0.7) return 'high'
  if (bedding >= 0.4) return 'moderate'
  return 'low'
}

// objectiveId may be an objective_profiles PK or an arc objective_id (objectives.id) —
// both forms are resolved here so callers don't need to know which one they have.
export async function getMipBriefPayload(
  supabase: ReturnType<typeof createServiceClient>,
  objectiveId: string,
): Promise<{ payload: MipBriefPayload; notFound: boolean }> {
  let assignedAgents: string[] = []
  let nativeObjectiveId: string | null = null
  let confidencePct = 0

  let { data: profile } = await supabase
    .from('objective_profiles')
    .select('id, objective_id, user_id, assigned_agents, taxonomy_key, lat, lon, domain, state')
    .eq('id', objectiveId)
    .maybeSingle()

  if (!profile) {
    const { data: byArcId } = await supabase
      .from('objective_profiles')
      .select('id, objective_id, user_id, assigned_agents, taxonomy_key, lat, lon, domain, state')
      .eq('objective_id', objectiveId)
      .maybeSingle()
    profile = byArcId
  }

  if (profile) {
    assignedAgents = (profile.assigned_agents as string[]) ?? []
    nativeObjectiveId = (profile.objective_id as string | null) ?? null
  } else {
    // Treat objectiveId as a native objectives.id
    const { data: obj } = await supabase
      .from('objectives')
      .select('id, confidence')
      .eq('id', objectiveId)
      .maybeSingle()
    if (obj) {
      nativeObjectiveId = obj.id as string
      confidencePct = (obj.confidence as number) ?? 0
    }
  }

  if (!profile && !nativeObjectiveId) {
    return { payload: pendingBriefPayload(objectiveId), notFound: true }
  }

  if (!nativeObjectiveId) {
    return { payload: pendingBriefPayload(objectiveId), notFound: false }
  }

  const { data: sweep } = await supabase
    .from('sweeps')
    .select('summary, completed_at')
    .contains('objectives_swept', [nativeObjectiveId])
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (confidencePct === 0) {
    const { data: obj } = await supabase
      .from('objectives')
      .select('confidence')
      .eq('id', nativeObjectiveId)
      .maybeSingle()
    confidencePct = (obj?.confidence as number) ?? 0
  }

  const signalChips: SignalChip[] = []
  if (assignedAgents.length > 0) {
    const { data: runs } = await supabase
      .from('agent_run_log')
      .select('agent_key, result, threshold_value_observed, ran_at')
      .in('agent_key', assignedAgents)
      .order('ran_at', { ascending: false })

    const seen = new Set<string>()
    for (const run of (runs ?? [])) {
      if (seen.has(run.agent_key as string)) continue
      seen.add(run.agent_key as string)
      signalChips.push({
        label: agentKeyToLabel(run.agent_key as string),
        value: run.threshold_value_observed != null
          ? String(run.threshold_value_observed)
          : (run.result as string) ?? '—',
        status: chipStatus(run.result as string | null),
      })
    }
  }

  const { data: brief } = await supabase
    .from('strike_briefs')
    .select('movement_windows, time_window, go_no_go, synthesis, confidence_tier, created_at')
    .eq('objective_id', nativeObjectiveId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // FF-089 P0: an ended hunt (season closed / trip ended) returns its closed state,
  // no time windows, and no collar windows. objective_state is additive (partner API).
  const windowCheck = await loadObjectiveWindow(supabase, nativeObjectiveId)
  const ended = windowCheck && isEndedState(windowCheck.evaluation.state) ? windowCheck.evaluation : null
  const briefClosed = (brief?.go_no_go as string | null | undefined) === 'CLOSED'
  const closed = ended !== null || briefClosed

  const timeWindows: TimeWindow[] = []
  if (brief && !closed) {
    type MovementWindow = { time?: string; reason?: string; probability?: number }
    const mw = brief.movement_windows as MovementWindow[] | null
    if (Array.isArray(mw) && mw.length > 0) {
      for (const w of mw) {
        if (!w.time) continue
        timeWindows.push({
          window: w.time,
          action: w.reason ?? (brief.go_no_go as string) ?? '—',
          priority: windowPriority(w.probability ?? null),
        })
      }
    } else if (brief.time_window) {
      timeWindows.push({
        window: brief.time_window as string,
        action: (brief.go_no_go as string) ?? '—',
        priority: (brief.go_no_go as string) === 'GO' ? 'high' : 'low',
      })
    }
  }

  if (!sweep && !brief && !ended) {
    return { payload: pendingBriefPayload(objectiveId), notFound: false }
  }

  const { data: terrainRows } = await supabase
    .from('terrain_cache')
    .select('lat, lon, slope_aspect, bedding_probability, terrain_interpretation, elevation_ft')
    .eq('objective_id', nativeObjectiveId)
    .not('lat', 'is', null)
    .limit(10)

  const mapPins: MapPin[] = (terrainRows ?? []).map(t => {
    const interp = t.terrain_interpretation as Record<string, unknown> | null
    return {
      type: (t.slope_aspect as string) ?? 'terrain',
      lat: Number(t.lat),
      lon: Number(t.lon),
      confidence: pinConfidence(t.bedding_probability as number | null),
      label: (interp?.label as string) ?? (t.elevation_ft ? `${t.elevation_ft}ft` : 'Terrain point'),
    }
  })

  const sources: string[] = []
  if (sweep) sources.push('Meridian Arc Swarm')
  if ((terrainRows ?? []).length > 0) sources.push('USGS 3DEP Terrain')
  if (brief) sources.push('Strike Brief Engine')

  // FF-093 — Movebank collar calibration (fail-open; see getCollarBriefAugmentation).
  const tempChip = signalChips.find(c => /temp/i.test(c.label))
  const collarAugmentation = await getCollarBriefAugmentation(
    profile?.taxonomy_key as string | undefined,
    profile?.lat,
    profile?.lon,
    profile?.domain as string | undefined,
    profile?.state as string | undefined,
    profile?.user_id as string | undefined,
    parseTempF(tempChip?.value)
  )
  if (!closed) {
    for (const w of collarAugmentation.windows) {
      timeWindows.push(w)
    }
  }
  // CC-BY requires attribution — de-duplicated so it doesn't double up if
  // another source string already happens to match (Fix 4).
  if (!closed && collarAugmentation.credit && !sources.includes(collarAugmentation.credit)) {
    sources.push(collarAugmentation.credit)
  }

  const derivedTier = confidencePct > 0
    ? confidenceTier(confidencePct)
    : briefTierToInt((brief?.confidence_tier as string | null) ?? null)

  // A closed hunt states that it is closed. The sweep summary is not shown for it.
  const summary = ended
    ? closedSynthesis(ended)
    : briefClosed
    ? (brief?.synthesis as string)
    : (sweep?.summary as string) ?? (brief?.synthesis as string) ?? 'Intelligence sweep pending — check back after next scheduled run.'

  const payload: MipBriefPayload = {
    objective_id: objectiveId,
    // The stored brief's time when a row exists; now only for the no-brief payload.
    brief_generated_at: briefGeneratedAt(brief?.created_at as string | null | undefined),
    confidence_tier: derivedTier,
    confidence_pct: confidencePct,
    summary,
    signal_chips: signalChips,
    time_windows: timeWindows,
    map_pins: mapPins,
    sources,
    attribution: 'Powered by Meridian Arc',
    ...(windowCheck ? { objective_state: windowCheck.evaluation.state } : {}),
  }

  return { payload, notFound: false }
}
