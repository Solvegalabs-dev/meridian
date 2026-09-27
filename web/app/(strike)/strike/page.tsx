import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createServiceClient } from '@/lib/supabase/server'
import CampaignView from '@/components/strike/CampaignView'

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

  const userId = user.id
  const supabase = createServiceClient()

  const { data: campaigns } = await supabase
    .from('hunt_campaigns')
    .select(`id, name, status, taxonomy_key, season_year,
      campaign_units (id, objective_id, role, rank, status, missed_reason,
        confidence_trajectory, pivot_recommended, pivot_reason)`)
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  const allObjectiveIds: string[] = (campaigns ?? []).flatMap(c =>
    ((c.campaign_units ?? []) as RawUnit[])
      .map(u => u.objective_id)
      .filter(Boolean)
  )

  const [profileResult, briefResult] = await Promise.all([
    allObjectiveIds.length > 0
      ? supabase
          .from('objective_profiles')
          .select('id, objective_id, geo, timing, agent_build_status')
          .in('objective_id', allObjectiveIds)
      : Promise.resolve({ data: [] as unknown[] }),
    allObjectiveIds.length > 0
      ? supabase
          .from('strike_briefs')
          .select('objective_id, confidence_tier, go_no_go, created_at')
          .in('objective_id', allObjectiveIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ])

  const profileMap = new Map<string, Record<string, unknown>>(
    ((profileResult.data ?? []) as Array<Record<string, unknown>>)
      .map(p => [p.objective_id as string, p])
  )

  const briefMap = new Map<string, { confidence_tier?: string; go_no_go?: string }>()
  for (const b of (briefResult.data ?? []) as Array<{ objective_id: string; confidence_tier?: string; go_no_go?: string }>) {
    if (!briefMap.has(b.objective_id)) briefMap.set(b.objective_id, b)
  }

  const enriched = (campaigns ?? []).map(c => ({
    id: c.id as string,
    name: c.name as string,
    taxonomy_key: c.taxonomy_key as string,
    season_year: c.season_year as number | null,
    units: ((c.campaign_units ?? []) as RawUnit[])
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .map(u => ({
        ...u,
        profile: profileMap.get(u.objective_id) ?? null,
        brief: briefMap.get(u.objective_id) ?? null,
      })),
  }))

  return <CampaignView campaigns={enriched} />
}
