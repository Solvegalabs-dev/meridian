// GET /api/mip/brief?objective_id=uuid&partner_key=basemaps|strike
// Core — MIP standardized output schema, partner-agnostic
// Third-vertical test: GoHunt and FishBrain consume identical payload — YES
// partner_key=strike returns StrikeBriefResponse shape (full brief from strike_briefs)
// partner_key=basemaps adds X-MIP-Partner header; attribution always 'Powered by Meridian Arc'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getMipBriefPayload } from '@/lib/mip/briefPayload'
import { authenticatePartner, isPartnerRequest } from '@/lib/auth/partnerAuth'
import { partnerRateLimitResponse } from '@/lib/auth/rateLimit'
import { ObjectiveAccessError, requireObjectiveAccess, requirePartnerObjective } from '@/lib/auth/ownership'
import { loadObjectiveWindow, isEndedState } from '@/lib/objectives/objectiveWindow'
import { closedSynthesis } from '@/lib/strikeBrief/closedBrief'
import { briefGeneratedAt } from '@/lib/strike/briefFreshness'
import { loadSignalChips } from '@/lib/strike/signalChips'

export const dynamic = 'force-dynamic'

function agentKeyToLabel(key: string): string {
  // OUTDOOR_NOAA_TEMP → "NOAA Temp" · UNIV_FRED_CPI → "FRED CPI"
  const parts = key.split('_').slice(1)
  return parts.map(p => p.charAt(0) + p.slice(1).toLowerCase()).join(' ')
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

  const signalChips = await loadSignalChips(supabase, objectiveId)

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
      signal_chips: signalChips,
      sources: [],
      attribution: 'Powered by Meridian Arc',
      objective: objectiveBlock,
    }, { headers })
  }

  const tierStr = (brief.confidence_tier as string | null) ?? 'T4'
  const confidencePct = TIER_PCT[tierStr] ?? 35

  // Signal chips are the latest real readings (FF-099), not placeholder text for the agents that fired.
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
  const agentHits = (brief.agent_hits as string[] | null) ?? []
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
    // The stored row's time, so a refresh does not reset "Updated" to the request time.
    brief_generated_at: briefGeneratedAt(brief.created_at as string | null),
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

function partnerHeaders(partnerSlug: string | null): Record<string, string> {
  if (partnerSlug === 'basemaps') return { 'X-MIP-Partner': 'basemaps' }
  return {}
}

// Two doors (FF-092 Part 3.4). The request decides which one applies.
//   Partner: an Authorization header. The key decides the partner. The objective's partner_id must
//            match the key's partner, else 404. partner_key, if sent, must repeat the key's slug.
//   Session: no Authorization header. The signed-in user must own the objective, else 404.
//            partner_key may be absent, 'strike' or 'arc' (the Strike screens send 'strike' or 'arc').
// Neither door applies (no key and no session): 401.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const objectiveId = searchParams.get('objective_id')
  const partnerKey = searchParams.get('partner_key')
  const supabase = createServiceClient()

  if (isPartnerRequest(request)) {
    const partner = await authenticatePartner(request)
    if (!partner) {
      return NextResponse.json({ error: 'Invalid or revoked partner key' }, { status: 401 })
    }
    const limited = partnerRateLimitResponse(partner)
    if (limited) return limited

    if (!objectiveId) {
      return NextResponse.json({ error: 'objective_id required' }, { status: 400 })
    }
    if (partnerKey && partnerKey !== partner.slug) {
      return NextResponse.json({ error: 'partner_key does not match the partner key' }, { status: 403 })
    }

    let profile
    try {
      profile = await requirePartnerObjective(supabase, partner.partnerId, objectiveId)
    } catch (err) {
      if (err instanceof ObjectiveAccessError) return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
      throw err
    }

    const { payload, notFound } = await getMipBriefPayload(supabase, profile.id)
    if (notFound) return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
    return NextResponse.json(payload, { headers: partnerHeaders(partner.slug) })
  }

  // A partner_key other than the session values can only be used with a key.
  if (partnerKey && partnerKey !== 'strike' && partnerKey !== 'arc') {
    return NextResponse.json({ error: 'Partner requests need an Authorization header' }, { status: 401 })
  }

  const { data: { user } } = await createClient().auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!objectiveId) {
    return NextResponse.json({ error: 'objective_id required' }, { status: 400 })
  }

  let profile
  try {
    profile = await requireObjectiveAccess(supabase, user.id, objectiveId, ['objective_id'])
  } catch (err) {
    if (err instanceof ObjectiveAccessError) return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
    throw err
  }

  // Strike screen: dedicated response shape built from strike_briefs directly.
  // Resolve to the arc objective_id, which is the FK on strike_briefs.
  if (partnerKey === 'strike') {
    const arcObjectiveId = (profile.objective_id as string | null) ?? objectiveId
    return handleStrikeBrief(supabase, arcObjectiveId)
  }

  // Generic MIP payload, read by the verified profile PK
  const { payload, notFound } = await getMipBriefPayload(supabase, profile.id)
  if (notFound) {
    return NextResponse.json({ error: 'Objective not found' }, { status: 404 })
  }

  return NextResponse.json(payload)
}
