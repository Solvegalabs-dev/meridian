import { notFound } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveAccess, ObjectiveAccessError } from '@/lib/auth/ownership'
import { isUserInvited } from '@/lib/auth/inviteGate'
import { resolveObjectiveTitle } from '@/lib/objectives/objectiveTitle'
import { isCampaignUnit } from '@/lib/strike/campaignUnit'
import { computeSweepInfo } from '@/lib/strike/sweepStatus'
import RemovedObjectiveNotice from '@/components/strike/RemovedObjectiveNotice'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'
import StrikeBriefClient from '@/components/strike/StrikeBriefClient'
import { getCollarBriefAugmentation } from '@/lib/swarm/agents/outdoor/collarCalibration'
import { loadObjectiveWindow } from '@/lib/objectives/objectiveWindow'
import { isEndedWindowState } from '@/lib/objectives/windowState'
import { NOTICE_CLASSES } from '@/lib/strike/noticeStyles'
import { hasLocation } from '@/lib/agents/geoLocation'
import { cleanSynthesis, lastHuntHeading, selectLastHuntBrief } from '@/lib/strike/lastHuntBrief'
import LastHuntBrief from '@/components/strike/LastHuntBrief'
import {
  closedSynthesis,
  endedNoticeLabel,
  resolveEndedNotice,
  windowOpensBanner,
} from '@/lib/strikeBrief/closedBrief'

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

// Priority buckets used elsewhere on this page (see the movement_windows
// mapping below) reversed, so a collar-calibrated window (which only has a
// priority, not a stored probability) can be slotted into the same list.
const PRIORITY_TO_PROBABILITY: Record<'high' | 'medium' | 'low', number> = {
  high: 0.75,
  medium: 0.55,
  low: 0.3,
}

async function mapBriefRow(
  row: Record<string, unknown> | null,
  arcObjectiveId: string,
  objective: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().split('T')[0]

  // Collar augmentation runs regardless of whether a strike_briefs row
  // exists yet — an objective can have Movebank data before its first AI
  // brief generates (Fix 4: this is the server-rendered path a hunter sees
  // on first load, not just the client's 30-minute /api/mip/brief refresh).
  const collarAugmentation = await getCollarBriefAugmentation(
    objective.taxonomy_key as string | undefined,
    (objective.lat as number | string | null | undefined),
    (objective.lon as number | string | null | undefined),
    objective.domain as string | undefined,
    objective.state as string | undefined,
    objective.user_id as string | undefined
  )

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
      // FF-089 P0: an ended hunt (ended_at set) shows no windows, even before its CLOSED row exists.
      time_windows: collarAugmentation.windows.length > 0 && objective.ended_at == null
        ? collarAugmentation.windows.map(w => ({
            window: w.window, action: w.action, priority: w.priority,
            probability: PRIORITY_TO_PROBABILITY[w.priority], confidence_tier: 'T4',
          }))
        : null,
      signal_chips: [],
      sources: collarAugmentation.credit ? [collarAugmentation.credit] : [],
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

  for (const w of collarAugmentation.windows) {
    timeWindows.push({
      window: w.window, action: w.action, priority: w.priority,
      probability: PRIORITY_TO_PROBABILITY[w.priority], confidence_tier: tierStr,
    })
  }

  const agentKeyToLabel = (key: string) =>
    key.split('_').slice(1).map((p: string) => p.charAt(0) + p.slice(1).toLowerCase()).join(' ')
  const sources = Array.from(new Set([
    ...agentHits.filter(h => h.startsWith('OUTDOOR_')).map(agentKeyToLabel),
    // CC-BY requires attribution reaching the hunter, not just an internal
    // sources[] array nothing renders (Fix 4).
    ...(collarAugmentation.credit ? [collarAugmentation.credit] : []),
  ]))

  const cleanSummary = cleanSynthesis(row.synthesis as string | null)

  return {
    objective_id: arcObjectiveId,
    brief_date: (row.brief_date as string) ?? today,
    // The stored row's time, so "Updated …" and the stale note describe the brief, not this request.
    brief_generated_at: (row.created_at as string | null) ?? new Date().toISOString(),
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

// Columns the Strike page and its panels read. Explicit, so a new sensitive column is not exposed by default.
const STRIKE_PAGE_COLUMNS = [
  'status', 'ended_at', 'ended_reason', 'created_at',
  'taxonomy_key', 'domain', 'geo', 'timing', 'hunt_code', 'hunt_unit_id',
  'state', 'county', 'lat', 'lon',
  'nws_grid_office', 'nws_grid_x', 'nws_grid_y', 'nws_zone_id',
  'usgs_gauge_ids', 'snotel_station_ids', 'elevation_ft_avg',
  'assigned_agents', 'agent_build_status',
]

export default async function StrikePage({ params }: { params: { id: string } }) {
  // Session first. The objective must belong to the signed-in user; anything else is a 404.
  const { data: { user } } = await createClient().auth.getUser()
  if (!user) notFound()

  const supabase = createServiceClient()
  // FF-092 Part 2.3: not invited means the screen and no data, before any objective lookup.
  if (!(await isUserInvited(supabase, user))) return <InviteOnlyScreen />

  let objective: Awaited<ReturnType<typeof requireObjectiveAccess>>
  try {
    objective = await requireObjectiveAccess(supabase, user.id, params.id, STRIKE_PAGE_COLUMNS)
  } catch (err) {
    if (err instanceof ObjectiveAccessError) notFound()
    throw err
  }

  const arcObjectiveId = (objective.objective_id as string | null) ?? params.id

  // FF-096: a removed objective shows a short notice with Restore (owner only), never the brief.
  if (objective.status === 'archived') {
    const { data: removedRow } = await supabase.from('objectives').select('title').eq('id', arcObjectiveId).maybeSingle()
    const removedTitle = resolveObjectiveTitle({
      storedTitle: removedRow?.title as string | null | undefined,
      taxonomyKey: objective.taxonomy_key as string | null,
      state: objective.state as string | null,
      huntCode: objective.hunt_code as string | null,
      waterBody: (objective.geo as { water_body?: unknown } | null)?.water_body as string | null | undefined,
    })
    return <RemovedObjectiveNotice objectiveId={objective.id} title={removedTitle} />
  }

  // FF-096: only a standalone objective can be removed here. A campaign unit stays until campaigns can be managed.
  const canRemove = !(await isCampaignUnit(supabase, objective))

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

  const brief = await mapBriefRow(briefRow, arcObjectiveId, objective as Record<string, unknown>)

  const { data: objectiveRow } = await supabase
    .from('objectives')
    .select('title, notes')
    .eq('id', arcObjectiveId)
    .maybeSingle()
  const note = (objectiveRow?.notes as string | null | undefined) ?? null

  // FF-098: the user's last sweep (and when the next is allowed) and the newest signal tagged to this objective.
  // Two small reads: they decide whether the tabs point at Run Sweep.
  const [{ data: sweepProfile }, { data: latestSignal }] = await Promise.all([
    supabase.from('profiles').select('account_type, last_sweep_at').eq('id', user.id).maybeSingle(),
    supabase
      .from('signals')
      .select('created_at')
      .eq('user_id', user.id)
      .contains('objective_ids', [arcObjectiveId])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const sweep = computeSweepInfo({
    accountType: sweepProfile?.account_type as string | null | undefined,
    email: user.email,
    lastSweepAt: sweepProfile?.last_sweep_at as string | null | undefined,
    objectiveCreatedAt: objective.created_at as string | null | undefined,
    latestSignalAt: latestSignal?.created_at as string | null | undefined,
  })
  const title = resolveObjectiveTitle({
    storedTitle: objectiveRow?.title as string | null | undefined,
    taxonomyKey: objective.taxonomy_key as string | null,
    state: objective.state as string | null,
    huntCode: objective.hunt_code as string | null,
    waterBody: (objective.geo as { water_body?: unknown } | null)?.water_body as string | null | undefined,
  })

  // FF-089 P0: window state is evaluated at render time. The sweep is not the only trigger.
  const windowCheck = await loadObjectiveWindow(supabase, arcObjectiveId)
  const evaluation = windowCheck?.evaluation ?? null
  const ended = resolveEndedNotice({
    evaluation,
    profileStatus: objective.status as string | null,
    endedReason: objective.ended_reason as string | null,
  })

  if (ended) {
    // The hunt is over: no GO verdict, no windows. The stored brief stays as labeled history only.
    const closedText = evaluation && isEndedWindowState(evaluation.state)
      ? closedSynthesis(evaluation)
      : `${endedNoticeLabel(ended)}.`
    // History is the newest real verdict. The CLOSED row is the end marker, so it is never shown here.
    const { data: historyRows } = await supabase
      .from('strike_briefs')
      .select('brief_date, go_no_go, synthesis')
      .eq('objective_id', arcObjectiveId)
      .neq('go_no_go', 'CLOSED')
      .order('created_at', { ascending: false })
      .limit(1)
    const lastHunt = selectLastHuntBrief((historyRows ?? []) as Array<{ brief_date: string | null; go_no_go: string | null; synthesis: string | null }>)
    const closedBrief = {
      ...brief,
      go_no_go: 'CLOSED',
      confidence_tier: null,
      time_windows: [],
      signal_chips: [],
      lead_signal: null,
      summary: null,
    }

    // Notices sit inside the dark page container, so they never land on the white strip above it.
    return (
      <div className="bg-slate-900 text-white">
        <div className={NOTICE_CLASSES.closed}>
          {closedText}
        </div>
        {lastHunt && (
          <LastHuntBrief heading={lastHuntHeading(lastHunt)} synthesis={cleanSynthesis(lastHunt.synthesis)} />
        )}
        <StrikeBriefClient
          brief={closedBrief}
          objective={objective as unknown as Parameters<typeof StrikeBriefClient>[0]['objective']}
          title={title}
          note={note}
          sweep={sweep}
          canRemove={canRemove}
          hasBrief={briefRow !== null}
          evaluation={evaluation}
        />
      </div>
    )
  }

  // FF-089 P0: "Season opens {date}" / "Trip opens {date}" banner, rendered server-side
  // so the partner API keeps its single additive field (objective_state).
  const banner = windowOpensBanner(evaluation)
  // FF-091 Part C: an objective with no location says so, instead of showing another area's data.
  const noLocation = !hasLocation(objective as Parameters<typeof hasLocation>[0]);

  return (
    <div className="bg-slate-900 text-white">
      {banner && <div className={NOTICE_CLASSES.opens}>{banner}</div>}
      {noLocation && <div className={NOTICE_CLASSES.opens}>Location not set. Add a hunt spot to get local intel.</div>}
      <StrikeBriefClient
        brief={brief}
        objective={objective as unknown as Parameters<typeof StrikeBriefClient>[0]['objective']}
        title={title}
        note={note}
        sweep={sweep}
        canRemove={canRemove}
        hasBrief={briefRow !== null}
        evaluation={evaluation}
      />
    </div>
  )
}
