import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import HeadlineCard from '@/components/dashboard/HeadlineCard'
import GoalCard from '@/components/dashboard/GoalCard'
import DoNextCard from '@/components/dashboard/DoNextCard'
import CrossDepBanner, { type CrossDep } from '@/components/dashboard/CrossDepBanner'
import SweepStatusStrip from '@/components/dashboard/SweepStatusStrip'
import UpcomingStrip, { type UpcomingEvent } from '@/components/dashboard/UpcomingStrip'
import ConfidenceGraph, { type ObjectiveSeries } from '@/components/dashboard/ConfidenceGraph'
import AskMeridianBar from '@/components/ask/AskMeridianBar'
import AskMeridianLoader from '@/components/AskMeridianLoader'
import { getConfidenceStatus } from '@/lib/utils/confidenceStatus'
import { DrivingModeEntry } from '@/components/voice/DrivingModeEntry'
import { userVoiceTier, canUseFull } from '@/lib/voice/voiceTier'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'

const STATUS_RANK = { risk: 0, watch: 1, on_track: 2 }

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const now = new Date()
  const calWindowEnd = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000)

  const [{ data: profile }, { data: objectives }, { data: lastSweep }, { data: unreadSignals }, { data: upcomingEvents }, { data: episodeData }, { data: latestSweepMeta }, { data: latestVoiceSweep }] = await Promise.all([
    supabase.from('profiles').select('full_name, sweep_count, tier, account_type, voice_addon, voice_mode').eq('id', user!.id).single(),
    supabase.from('objectives').select('id, obj_id, title, confidence, confidence_prev, target_date, updated_at, status').eq('user_id', user!.id).eq('status', 'active').order('sort_order'),
    supabase.from('sweeps').select('*').eq('user_id', user!.id).eq('status', 'complete').not('raw_response', 'is', null).order('completed_at', { ascending: false }).limit(1).single(),
    supabase.from('signals').select('objective_ids').eq('user_id', user!.id).eq('is_read', false),
    supabase.from('calendar_events').select('id, starts_at, summary, objective_ids').eq('user_id', user!.id).gte('starts_at', now.toISOString()).lte('starts_at', calWindowEnd.toISOString()).order('starts_at').limit(5),
    supabase.from('objective_episodes').select('objective_id, episode_number, confidence_end, created_at, narrative').eq('user_id', user!.id).order('episode_number', { ascending: true }),
    supabase.from('sweeps').select('status, raw_response').eq('user_id', user!.id).neq('trigger_type', 'user_action').order('completed_at', { ascending: false }).limit(1).single(),
    supabase.from('sweeps').select('voice_brief').eq('user_id', user!.id).eq('status', 'complete').not('voice_brief', 'is', null).order('completed_at', { ascending: false }).limit(1).single(),
  ])

  const voiceProfile = profile as { tier?: string | null; account_type?: string | null; voice_addon?: boolean | null; voice_mode?: boolean | null } | null
  const voiceTier = userVoiceTier({
    pricing_tier: voiceProfile?.tier ?? null,
    account_type: voiceProfile?.account_type ?? null,
    voice_addon: voiceProfile?.voice_addon ?? false,
  })
  const voiceBrief = (latestVoiceSweep?.voice_brief ?? null) as VoiceBrief | null
  const showDrivingMode = canUseFull(voiceTier) && (voiceProfile?.voice_mode ?? false) && voiceBrief !== null && voiceBrief.taskers.length > 0
  const showConciergeEntry = canUseFull(voiceTier)

  const hasSweep = !!lastSweep
  const lastSweepFailed = !!latestSweepMeta && (
    latestSweepMeta.status === 'failed' || latestSweepMeta.raw_response === null
  )
  const sweepData = lastSweep?.raw_response as {
    sweep_summary?: string
    top_priority_action?: string
    objectives?: Array<{
      obj_id: string
      opportunities?: string[]
      risks?: string[]
      changed_since_last_sweep?: string
      actions?: string[]
    }>
    cross_objective_dependencies?: Array<{
      from_obj: string
      to_obj: string
      description: string
      urgency: string
    }>
  } | null

  const objectiveList = objectives ?? []

  // Unread signal count per objective
  const signalCounts: Record<string, number> = {}
  for (const sig of unreadSignals ?? []) {
    for (const objId of sig.objective_ids ?? []) {
      signalCounts[objId] = (signalCounts[objId] ?? 0) + 1
    }
  }

  // Cross-dependencies, resolved to plain objective names.
  // Deduped by id — the sweep's raw AI output can list the same
  // dependency more than once.
  const crossDepsById = new Map<string, CrossDep>()
  for (const dep of sweepData?.cross_objective_dependencies ?? []) {
    const id = `${dep.from_obj}-${dep.to_obj}`
    if (crossDepsById.has(id)) continue
    const fromObj = objectiveList.find(o => o.obj_id === dep.from_obj)
    const toObj = objectiveList.find(o => o.obj_id === dep.to_obj)
    crossDepsById.set(id, {
      id,
      fromObjective: fromObj?.title ?? dep.from_obj,
      toObjective: toObj?.title ?? dep.to_obj,
      description: dep.description,
    })
  }
  const crossDeps: CrossDep[] = Array.from(crossDepsById.values())

  const topAction = sweepData?.top_priority_action ?? null
  const moreActions = (sweepData?.objectives?.flatMap(o => o.actions ?? []) ?? [])
    .filter(a => a !== topAction)
    .slice(0, 5)

  const sortedObjectives = [...objectiveList].sort(
    (a, b) => STATUS_RANK[getConfidenceStatus(a.confidence)] - STATUS_RANK[getConfidenceStatus(b.confidence)]
  )

  // Build per-objective episode series for the confidence trajectory chart
  const episodesByObjId = new Map<string, ObjectiveSeries['episodes']>()
  for (const ep of episodeData ?? []) {
    if (!episodesByObjId.has(ep.objective_id)) episodesByObjId.set(ep.objective_id, [])
    episodesByObjId.get(ep.objective_id)!.push({
      episode_number: ep.episode_number as number,
      confidence_end: ep.confidence_end as number,
      created_at: ep.created_at as string,
      narrative: ep.narrative as string | null,
    })
  }
  const confidenceSeries: ObjectiveSeries[] = objectiveList
    .map(obj => ({
      objectiveId: obj.id,
      objId: obj.obj_id,
      title: obj.title,
      episodes: episodesByObjId.get(obj.id) ?? [],
    }))
    .filter(s => s.episodes.length > 0)

  return (
    <div className="-m-6 p-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
    <div className="max-w-2xl space-y-4">
      <SweepStatusStrip lastSweepAt={lastSweep?.completed_at ?? null} lastSweepFailed={lastSweepFailed} />

      <HeadlineCard objectives={objectiveList} hasSweep={hasSweep} userName={profile?.full_name} />

      <DoNextCard topAction={topAction} moreActions={moreActions} hasSweep={hasSweep} />

      {upcomingEvents && upcomingEvents.length > 0 && (
        <UpcomingStrip
          events={upcomingEvents as UpcomingEvent[]}
          objectives={(objectiveList).map(o => ({ id: o.id, title: o.title, target_date: o.target_date ?? null }))}
        />
      )}

      <div
        className="rounded-2xl p-4"
        style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--ov-border)' }}
      >
        <p className="text-[9px] uppercase tracking-widest font-semibold mb-3" style={{ color: 'var(--blue-mid)' }}>
          Confidence Trajectory
        </p>
        <ConfidenceGraph
          series={confidenceSeries}
          tier={profile?.tier ?? 'trial'}
          accountType={profile?.account_type ?? null}
        />
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--blue-mid)' }}>
          Your goals
        </p>
        {sortedObjectives.length === 0 ? (
          <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>No goals yet.</p>
        ) : (
          <div className="space-y-3">
            {sortedObjectives.map(obj => (
              <GoalCard
                key={obj.id}
                objective={obj}
                newSignalCount={signalCounts[obj.id] ?? 0}
              />
            ))}
          </div>
        )}
      </div>

      <AskMeridianLoader />

      {showDrivingMode && voiceBrief && (
        <DrivingModeEntry voiceBrief={voiceBrief} />
      )}

      {showConciergeEntry && (
        <Link
          href="/concierge"
          className="flex items-center justify-center w-full rounded-2xl py-3 text-[14px] font-semibold transition-opacity hover:opacity-80"
          style={{ backgroundColor: 'rgba(46,124,184,0.15)', color: '#7ab3e0', border: '1px solid rgba(46,124,184,0.25)' }}
        >
          Ask Meridian →
        </Link>
      )}

      <CrossDepBanner crossDeps={crossDeps} />

      <p className="text-[10px] text-center pt-2" style={{ color: 'var(--ov-text-dim)' }}>
        Meridian Arc surfaces AI-generated insights — always use your own judgment for major decisions.
      </p>
      <p className="text-[10px] text-center pt-1 pb-3" style={{ color: 'var(--ov-text-dim)' }}>
        <a href="/legal#tos" className="hover:underline" style={{ color: 'inherit' }}>Terms of Service</a>
        <span className="mx-1.5">·</span>
        <a href="/legal#privacy" className="hover:underline" style={{ color: 'inherit' }}>Privacy Policy</a>
      </p>
    </div>

    <AskMeridianBar
      showChips={true}
      topObjectiveName={sortedObjectives[0]?.title}
      context={sweepData?.sweep_summary}
    />
    <div className="flex justify-center pb-2">
      <Link href="/ask/history" className="text-[10px]" style={{ color: 'var(--gold)' }}>
        Ask Meridian History →
      </Link>
    </div>
    </div>
  )
}
