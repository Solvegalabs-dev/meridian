import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import CampaignView from '@/components/strike/CampaignView'
import InviteOnlyScreen from '@/components/strike/InviteOnlyScreen'
import { isUserInvited } from '@/lib/auth/inviteGate'
import { evaluateProfilesWindow, PROFILE_WINDOW_COLUMNS, type ObjectiveWindowProfile } from '@/lib/objectives/objectiveWindow'
import { buildOtherObjectives, evaluationKey, type OtherBrief, type OtherProfileRow } from '@/lib/strike/otherObjectives'
import { resolveObjectiveTitle } from '@/lib/objectives/objectiveTitle'
import { loadSeasonIndex } from '@/lib/strike/coverageData'
import { resolveEndedNotice } from '@/lib/strikeBrief/closedBrief'

export const dynamic = 'force-dynamic'

type RawUnit = {
  id: string
  objective_id: string
  role: string
  rank: number | null
  status: string
  missed_reason: string | null
  confidence_trajectory: unknown
  pivot_recommended: boolean
  pivot_reason: string | null
}

export default async function StrikePage() {
  const cookieStore = cookies()
  const authClient = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) redirect('/login')

  const supabase = createServiceClient()
  // FF-092 Part 2.3: not invited means the screen and no data.
  if (!(await isUserInvited(supabase, user))) return <InviteOnlyScreen />

  const userId = user.id

  // Campaigns, and (FF-095) every Strike objective the signed-in user owns. The standalone ones are the
  // profiles no campaign unit points at. Both reads use the session user id: nobody else's rows are listed.
  const [{ data: campaigns }, { data: ownedProfiles }, { data: archivedProfiles }] = await Promise.all([
    supabase
      .from('hunt_campaigns')
      .select(`id, name, status, taxonomy_key, season_year,
      campaign_units (id, objective_id, role, rank, status, missed_reason,
        confidence_trajectory, pivot_recommended, pivot_reason)`)
      .eq('user_id', userId)
      // FF-089 P0: closed campaigns stay visible (read-only, sorted last) so the last brief can still be read.
      .in('status', ['active', 'closed'])
      .order('created_at', { ascending: false }),
    supabase
      .from('objective_profiles')
      .select(`${PROFILE_WINDOW_COLUMNS}, geo, created_at`)
      .eq('user_id', userId)
      .eq('org_source', 'strike')
      // FF-096: removed ('archived') objectives are not listed here. They appear under Removed objectives.
      .in('status', ['active', 'completed']),
    supabase
      .from('objective_profiles')
      .select('id, objective_id, taxonomy_key, state, hunt_code, geo, created_at')
      .eq('user_id', userId)
      .eq('org_source', 'strike')
      .eq('status', 'archived'),
  ])

  const allObjectiveIds: string[] = (campaigns ?? []).flatMap(c =>
    ((c.campaign_units ?? []) as RawUnit[])
      .map(u => u.objective_id)
      .filter(Boolean)
  )

  const inCampaign = new Set(allObjectiveIds)
  const standaloneProfiles = ((ownedProfiles ?? []) as unknown as OtherProfileRow[])
    .filter(p => !inCampaign.has(p.id) && !(p.objective_id && inCampaign.has(p.objective_id)))
  const standaloneObjectiveIds = standaloneProfiles.map(p => p.objective_id).filter((id): id is string => !!id)

  const removedProfiles = (archivedProfiles ?? []) as unknown as Array<{
    id: string; objective_id: string | null; taxonomy_key: string | null; state: string | null
    hunt_code: string | null; geo: { water_body?: unknown } | null; created_at: string | null
  }>
  const titleObjectiveIds = [
    ...standaloneObjectiveIds,
    ...removedProfiles.map(p => p.objective_id).filter((id): id is string => !!id),
  ]

  const [profileResult, briefResult, titleResult] = await Promise.all([
    allObjectiveIds.length > 0
      ? supabase
          .from('objective_profiles')
          .select(`${PROFILE_WINDOW_COLUMNS}, geo, agent_build_status`)
          .in('objective_id', allObjectiveIds)
      : Promise.resolve({ data: [] as unknown[] }),
    allObjectiveIds.length + standaloneObjectiveIds.length > 0
      ? supabase
          .from('strike_briefs')
          .select('objective_id, confidence_tier, go_no_go, created_at')
          .in('objective_id', [...allObjectiveIds, ...standaloneObjectiveIds])
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
    titleObjectiveIds.length > 0
      ? supabase
          .from('objectives')
          .select('id, title, archive_date')
          .eq('user_id', userId)
          .in('id', titleObjectiveIds)
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const profileMap = new Map<string, Record<string, unknown>>(
    ((profileResult.data ?? []) as Array<Record<string, unknown>>)
      .map(p => [p.objective_id as string, p])
  )

  // FF-089 P0: window state is evaluated now, not read from the last sweep. One batched season read.
  const profileRows = (profileResult.data ?? []) as unknown as ObjectiveWindowProfile[]
  // The standalone profiles go through the same single season read.
  const standaloneRows = standaloneProfiles.map(p => ({ ...p, objective_id: evaluationKey(p) }))
  const windowStates = await evaluateProfilesWindow(supabase, [...profileRows, ...standaloneRows])

  const briefMap = new Map<string, { confidence_tier?: string; go_no_go?: string }>()
  for (const b of (briefResult.data ?? []) as Array<{ objective_id: string; confidence_tier?: string; go_no_go?: string }>) {
    if (!briefMap.has(b.objective_id)) briefMap.set(b.objective_id, b)
  }

  const titleRows = (titleResult.data ?? []) as Array<{ id: string; title: string | null; archive_date?: string | null }>
  const storedTitles = new Map<string, string | null>(titleRows.map(o => [o.id, o.title]))
  const others = buildOtherObjectives({
    profiles: standaloneProfiles,
    evaluations: windowStates,
    briefs: briefMap as Map<string, OtherBrief>,
    storedTitles,
    seasonIndex: await loadSeasonIndex(supabase),
  })

  // Removed objectives, most recently removed first.
  const archiveDates = new Map(titleRows.map(o => [o.id, o.archive_date ?? '']))
  const removed = removedProfiles
    .map(p => ({
      id: p.id,
      sortKey: (p.objective_id ? archiveDates.get(p.objective_id) : '') || p.created_at || '',
      title: resolveObjectiveTitle({
        storedTitle: p.objective_id ? storedTitles.get(p.objective_id) : null,
        taxonomyKey: p.taxonomy_key,
        state: p.state,
        huntCode: p.hunt_code,
        waterBody: typeof p.geo?.water_body === 'string' ? p.geo.water_body : null,
      }),
    }))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map(({ id, title }) => ({ id, title }))

  const enriched = (campaigns ?? []).map(c => ({
    id: c.id as string,
    name: c.name as string,
    status: c.status as string,
    taxonomy_key: c.taxonomy_key as string,
    season_year: c.season_year as number | null,
    units: ((c.campaign_units ?? []) as RawUnit[])
      // FF-096: a removed (archived) profile is never shown as a campaign unit.
      .filter(u => profileMap.get(u.objective_id)?.status !== 'archived')
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map(u => ({
        ...u,
        profile: profileMap.get(u.objective_id) ?? null,
        brief: briefMap.get(u.objective_id) ?? null,
        ended: resolveEndedNotice({
          evaluation: windowStates.get(u.objective_id) ?? null,
          unitStatus: u.status,
          profileStatus: profileMap.get(u.objective_id)?.status as string | undefined,
          endedReason: profileMap.get(u.objective_id)?.ended_reason as string | undefined,
        }),
      })),
  }))

  return <CampaignView campaigns={enriched} others={others} removed={removed} />
}
