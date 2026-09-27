import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import StrikeBriefClient from '@/components/strike/StrikeBriefClient'

export const dynamic = 'force-dynamic'

const TIER_PCT: Record<string, number> = { T1: 90, T2: 74, T3: 55, T4: 35 }

type ChipEntry = { label: string; value: string; status: 'ok' | 'warn' | 'critical' }
const CHIP_MAP: Record<string, ChipEntry> = {
  OUTDOOR_MOON_PHASE:            { label: 'Moon Phase (Meeus)',   value: 'Waning 34%',  status: 'ok'   },
  OUTDOOR_NOAA_FIRE_RISK:        { label: 'NOAA Fire Risk',       value: 'Moderate',    status: 'warn' },
  OUTDOOR_DROUGHT_MONITOR:       { label: 'NOAA Drought Monitor', value: 'D2–D3',       status: 'warn' },
  OUTDOOR_NOAA_DROUGHT_STATE:    { label: 'NOAA Drought Monitor', value: 'D2–D3',       status: 'warn' },
  OUTDOOR_USGS_STREAMFLOW_STATE: { label: 'USGS Streamflow',      value: 'Below avg',   status: 'warn' },
  OUTDOOR_WINDY_API:             { label: 'Windy.com',            value: 'NW 8mph',     status: 'ok'   },
  OUTDOOR_DWR_HARVEST_UT:        { label: 'UDWR Herd Survey',     value: '53% target',  status: 'warn' },
  OUTDOOR_DWR_PERMITS_UT:        { label: 'UDWR Permits',         value: 'Open',        status: 'ok'   },
  OUTDOOR_USFS_CLOSURE:          { label: 'USFS Closure',         value: 'Active',      status: 'warn' },
  OUTDOOR_INAT_OBSERVATIONS:     { label: 'iNaturalist',          value: 'Active',      status: 'ok'   },
  OUTDOOR_SNOTEL_STATE:          { label: 'SNOTEL',               value: 'Monitoring',  status: 'ok'   },
}

function mapBriefRow(
  row: Record<string, unknown> | null,
  arcObjectiveId: string,
): Record<string, unknown> {
  const today = new Date().toISOString().split('T')[0]

  if (!row) {
    return {
      objective_id: arcObjectiveId,
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
    }
  }

  const tierStr = (row.confidence_tier as string | null) ?? 'T4'
  const confidencePct = TIER_PCT[tierStr] ?? 35

  const agentHits = (row.agent_hits as string[] | null) ?? []
  const signalChips = agentHits
    .filter(h => h.startsWith('OUTDOOR_') && CHIP_MAP[h])
    .map(h => ({ label: CHIP_MAP[h].label, value: CHIP_MAP[h].value, status: CHIP_MAP[h].status }))
    .filter((c, i, arr) => arr.findIndex(x => x.label === c.label) === i)

  type MvtWindow = { time?: string; reason?: string; probability?: number; confidence_tier?: string }
  const mvt = (row.movement_windows as MvtWindow[] | null) ?? []
  const timeWindows = mvt.map((w, idx, all) => {
    const next = all[idx + 1]
    const prob = w.probability ?? 0
    return {
      window: next ? `${w.time}–${next.time}` : `${w.time}–dark`,
      action: w.reason ?? '—',
      probability: prob,
      priority: prob >= 0.75 ? 'high' : prob >= 0.45 ? 'medium' : ('low' as 'high' | 'medium' | 'low'),
      confidence_tier: w.confidence_tier ?? tierStr,
    }
  })

  const agentKeyToLabel = (key: string) =>
    key.split('_').slice(1).map((p: string) => p.charAt(0) + p.slice(1).toLowerCase()).join(' ')
  const sources = Array.from(new Set(
    agentHits.filter(h => h.startsWith('OUTDOOR_')).map(agentKeyToLabel)
  ))

  const rawSynthesis = (row.synthesis as string) ?? ''
  const stripped = rawSynthesis.replace(/ \(T[1-4]: [^)]+\)/g, '').trim()
  const cleanSummary = stripped || rawSynthesis.trim() || null

  return {
    objective_id: arcObjectiveId,
    brief_date: (row.brief_date as string) ?? today,
    brief_generated_at: new Date().toISOString(),
    confidence_tier: tierStr,
    confidence_pct: confidencePct,
    go_no_go: (row.go_no_go as string) ?? 'NO-GO',
    summary: cleanSummary,
    lead_signal: (row.lead_signal as string | null) ?? null,
    time_windows: timeWindows,
    signal_chips: signalChips,
    sources,
    attribution: 'Powered by Meridian Arc',
  }
}

export default async function StrikePage({ params }: { params: { id: string } }) {
  const supabase = createServiceClient()

  // Try profile PK first, fall back to arc objective_id FK
  let { data: objective } = await supabase
    .from('objective_profiles')
    .select('*')
    .eq('id', params.id)
    .maybeSingle()

  if (!objective) {
    const { data: byArcId } = await supabase
      .from('objective_profiles')
      .select('*')
      .eq('objective_id', params.id)
      .maybeSingle()
    objective = byArcId
  }

  console.log('[strike/[id]] params.id:', params.id, 'objective id:', (objective as Record<string, unknown> | null)?.id ?? null)
  if (!objective) notFound()

  const arcObjectiveId = (objective.objective_id as string | null) ?? params.id

  // Query brief: today first, fall back to most recent
  const today = new Date().toISOString().split('T')[0]
  const { data: todayBrief } = await supabase
    .from('strike_briefs')
    .select('*')
    .eq('objective_id', arcObjectiveId)
    .eq('brief_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let briefRow = todayBrief as Record<string, unknown> | null
  if (!briefRow) {
    const { data: fallback } = await supabase
      .from('strike_briefs')
      .select('*')
      .eq('objective_id', arcObjectiveId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    briefRow = fallback as Record<string, unknown> | null
  }

  console.log('[strike/[id]] arcObjectiveId:', arcObjectiveId, 'brief found:', !!briefRow, 'time_windows:', (briefRow?.movement_windows as unknown[] | null)?.length ?? 'null')

  const brief = mapBriefRow(briefRow, arcObjectiveId)

  return (
    <StrikeBriefClient
      brief={brief}
      objective={objective as Parameters<typeof StrikeBriefClient>[0]['objective']}
    />
  )
}
