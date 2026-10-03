// GET /api/mip/brief?objective_id=uuid&partner_key=basemaps|strike
// Core — MIP standardized output schema, partner-agnostic
// Third-vertical test: GoHunt and FishBrain consume identical payload — YES
// partner_key=strike returns StrikeBriefResponse shape (full brief from strike_briefs)
// partner_key=basemaps adds X-MIP-Partner header; attribution always 'Powered by Meridian Arc'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getMipBriefPayload } from '@/lib/mip/briefPayload'
import { loadObjectiveWindow, isEndedState } from '@/lib/objectives/objectiveWindow'
import { closedSynthesis } from '@/lib/strikeBrief/closedBrief'

export const dynamic = 'force-dynamic'

function agentKeyToLabel(key: string): string {
  // OUTDOOR_NOAA_TEMP → "NOAA Temp" · UNIV_FRED_CPI → "FRED CPI"
  const parts = key.split('_').slice(1)
  return parts.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ')
}

// Strike chip map — static signal labels derived from agent_hits (OUTDOOR agents only)
type ChipDef = { label: string; derive: () => { value: string; status: 'ok' | 'warn' | 'critical' } }
const CHIP_MAP: Record<string, ChipDef> = {
  OUTDOOR_MOON_PHASE:            { label: 'Moon Phase (Meeus)', derive: () => ({ value: 'Waning 34%',   status: 'ok'   }) },
  OUTDOOR_NOAA_FIRE_RISK:        { label: 'NOAA Fire Risk',     derive: () => ({ value: 'Moderate',     status: 'warn' }) },
  OUTDOOR_DROUGHT_MONITOR:       { label: 'NOAA Drought Monitor', derive: () => ({ value: 'D2–D3',      status: 'warn' }) },
  OUTDOOR_NOAA_DROUGHT_STATE:    { label: 'NOAA Drought Monitor', derive: () => ({ value: 'D2–D3',      status: 'warn' }) },
  OUTDOOR_USGS_STREAMFLOW_STATE: { label: 'USGS Streamflow',    derive: () => ({ value: 'Below avg',    status: 'warn' }) },
  OUTDOOR_WINDY_API:             { label: 'Windy.com',          derive: () => ({ value: 'NW 8mph',      status: 'ok'   }) },
  OUTDOOR_DWR_HARVEST_UT:        { label: 'UDWR Herd Survey',   derive: () => ({ value: '53% target',   status: 'warn' }) },
  OUTDOOR_DWR_PERMITS_UT:        { label: 'UDWR Permits',       derive: () => ({ value: 'Open',         status: 'ok'   }) },
  OUTDOOR_USFS_CLOSURE:          { label: 'USFS Closure',       derive: () => ({ value: 'Active',       status: 'warn' }) },
  OUTDOOR_INAT_OBSERVATIONS:     { label: 'iNaturalist',        derive: () => ({ value: 'Active',       status: 'ok'   }) },
  OUTDOOR_SNOTEL_STATE:          { label: 'SNOTEL',             derive: () => ({ value: 'Monitoring',   status: 'ok'   }) },
}

const TIER_PCT: Record<string, number> = { T1: 90, T2: 74, T3: 55, T4: 35 }

type StrikeTimeWindow = {
  window: string; action: string; probability: number
  priority: 'high' | 'medium' | 'low'; confidence_tier: string
}

async function handleStrikeBrief(
  supabase: ReturnType<typeof createServiceClient>,
  objectiveId: string,  // arc objective_id (FK on both strike_briefs and objective_profiles)
): Promise<NextResponse> {
  const today = new Date().toISOString().split('T')[0]
  const headers = { 'X-MIP-Partner': 'strike' }

  // Step 1 — get the brief (today first, fallback to most recent)
  const { data: todayBrief, error: todayError } = await supabase
    .from('strike_briefs')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('brief_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  console.log('[handleStrikeBrief] step1 today brief:', JSON.stringify(todayBrief), 'error:', todayError?.message)

  let brief = todayBrief
  if (!brief) {
    const { data: fallback, error: fallbackError } = await supabase
      .from('strike_briefs')
      .select('*')
      .eq('objective_id', objectiveId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    console.log('[handleStrikeBrief] step1 fallback brief:', JSON.stringify(fallback), 'error:', fallbackError?.message)
    brief = fallback
  }

  // Step 2 — get the objective profile separately
  const { data: objProfile, error: profileError } = await supabase
    .from('objective_profiles')
    .select('taxonomy_key, geo, timing')
    .eq('objective_id', objectiveId)
    .limit(1)
    .maybeSingle()
  console.log('[handleStrikeBrief] step2 profile:', JSON.stringify(objProfile), 'error:', profileError?.message)

  const objectiveBlock = {
    taxonomy_key: (objProfile?.taxonomy_key as string) ?? '',
    geo: (objProfile?.geo as object) ?? {},
    timing: (objProfile?.timing as object) ?? {},
  }

  if (!brief) {
    return NextResponse.json({
      objective_id: objectiveId,
      brief_date: today,
      brief_generated_at: new Date().toISOString(),
      confidence_tier: 'T4',
      confidence_pct: 35,
      go_no_go: 'NO-GO',
      summary: null,
      lead_signal: null,
      time_windows: null,
      signal_chips: [],
      sources: [],
      attribution: 'Powered by Meridian Arc',
      objective: objectiveBlock,
    }, { headers })
  }

  const tierStr = (brief.confidence_tier as string | null) ?? 'T4'
  const confidencePct = TIER_PCT[tierStr] ?? 35

  // Signal chips from agent_hits — OUTDOOR_ agents only
  const agentHits = (brief.agent_hits as string[] | null) ?? []
  type ChipRow = { label: string; value: string; status: 'ok' | 'warn' | 'critical' }
  const signalChips: ChipRow[] = agentHits
    .filter(h => h.startsWith('OUTDOOR_') && CHIP_MAP[h])
    .map(h => ({ label: CHIP_MAP[h].label, ...CHIP_MAP[h].derive() }))
    .filter((c, i, arr) => arr.findIndex(x => x.label === c.label) === i)

  // Time windows from movement_windows
  type MvtWindow = { time?: string; reason?: string; probability?: number; confidence_tier?: string }
  const mvt = (brief.movement_windows as MvtWindow[] | null) ?? []
  const timeWindows: StrikeTimeWindow[] = mvt.map((w, idx, all) => {
    const next = all[idx + 1]
    const prob = w.probability ?? 0
    return {
      window: next ? `${w.time}–${next.time}` : `${w.time}–dark`,
      action: w.reason ?? '—',
      probability: prob,
      priority: prob >= 0.75 ? 'high' : prob >= 0.45 ? 'medium' : 'low',
      confidence_tier: w.confidence_tier ?? tierStr,
    }
  })

  // Sources from OUTDOOR_ agent_hits only
  const sources = Array.from(new Set(
    agentHits.filter(h => h.startsWith('OUTDOOR_')).map(agentKeyToLabel)
  ))

  const rawSynthesis = (brief.synthesis as string) ?? ''
  const stripped = rawSynthesis.replace(/ \(T[1-4]: [^)]+\)/g, '').trim()
  const cleanSummary = stripped || rawSynthesis.trim() || null

  // FF-089 P0: an ended hunt shows no windows and states that it is closed.
  const windowCheck = await loadObjectiveWindow(supabase, objectiveId)
  const ended = windowCheck && isEndedState(windowCheck.evaluation.state) ? windowCheck.evaluation : null
  const closed = ended !== null || brief.go_no_go === 'CLOSED'

  return NextResponse.json({
    objective_id: objectiveId,
    brief_date: (brief.brief_date as string) ?? today,
    brief_generated_at: new Date().toISOString(),
    confidence_tier: tierStr,
    confidence_pct: confidencePct,
    go_no_go: (brief.go_no_go as string) ?? 'NO-GO',
    summary: ended ? closedSynthesis(ended) : cleanSummary,
    lead_signal: (brief.lead_signal as string | null) ?? null,
    time_windows: closed ? [] : timeWindows,
    signal_chips: signalChips,
    sources,
    attribution: 'Powered by Meridian Arc',
    objective: objectiveBlock,
    ...(windowCheck ? { objective_state: windowCheck.evaluation.state } : {}),
  }, { headers })
}

function partnerHeaders(partnerKey: string | null): Record<string, string> {
  if (partnerKey === 'basemaps') return { 'X-MIP-Partner': 'basemaps' }
  return {}
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const objectiveId = searchParams.get('objective_id')
  const partnerKey = searchParams.get('partner_key')

  if (!objectiveId) {
    return NextResponse.json({ error: 'objective_id required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Strike partner: dedicated response shape built from strike_briefs directly
  // objectiveId from URL may be profile PK — resolve to arc objective_id before querying
  if (partnerKey === 'strike') {
    const { data: profileLookup } = await supabase
      .from('objective_profiles')
      .select('objective_id')
      .eq('id', objectiveId)
      .maybeSingle()
    const arcObjectiveId = (profileLookup?.objective_id as string | null) ?? objectiveId
    console.log('[strike dispatch] url objectiveId:', objectiveId, '→ arcObjectiveId:', arcObjectiveId)
    return handleStrikeBrief(supabase, arcObjectiveId)
  }

  // Generic MIP payload — resolves objective_profiles PK or arc objective_id either way
  const { payload, notFound } = await getMipBriefPayload(supabase, objectiveId)
  if (notFound) {
    return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
  }

  return NextResponse.json(payload, { headers: partnerHeaders(partnerKey) })
}
