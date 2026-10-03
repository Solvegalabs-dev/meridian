import { createClient, createServiceClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import ConfidenceRing from '@/components/objectives/ConfidenceRing'
import SparklineBar from '@/components/objectives/SparklineBar'
import ObjectiveDetailClient from './ObjectiveDetailClient'
import ObjectiveTabs from './ObjectiveTabs'
import { getConfidenceStatus } from '@/lib/utils/confidenceStatus'
import AskMeridianLoader from '@/components/AskMeridianLoader'
import { formatDateOnly } from '@/lib/utils/dateOnly'

const EXPERIMENT_START = new Date('2026-06-23')

interface SweepObjectiveResult {
  obj_id: string
  confidence_reasoning?: string
  opportunities?: string[]
  risks?: string[]
  changed_since_last_sweep?: string
}

export interface Factor {
  color: 'red' | 'amber' | 'green' | 'blue'
  title: string
  description: string
  impact: string
}

export default async function ObjectiveDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: obj } = await supabase.from('objectives').select('*').eq('id', params.id).eq('user_id', user.id).single()
  if (!obj) notFound()

  const [{ data: scores }, { data: signals }, { data: allObjectives }, { data: profile }, { data: calConnections }, { data: episodes }, { data: doneEngineActions }, { data: watchSources }, { count: unseenAlertCount }, { data: signalAccuracy }] = await Promise.all([
    supabase.from('confidence_scores').select('id, score, created_at, sweep_id, recommended_actions').eq('objective_id', obj.id).order('created_at', { ascending: false }).limit(7),
    supabase.from('signals').select('*').contains('objective_ids', [obj.id]).order('created_at', { ascending: false }),
    supabase.from('objectives').select('id, title').eq('user_id', user.id),
    supabase.from('profiles').select('tier, account_type, sms_alerts_enabled').eq('id', user.id).single(),
    supabase.from('calendar_connections').select('id').eq('user_id', user.id).eq('sync_status', 'ok').limit(1),
    supabase.from('objective_episodes').select('id, episode_number, confidence_start, confidence_end, confidence_delta, narrative, top_action, recommended_actions, signal_gap, top_signals, cross_deps_detected, inference_block, source, signal_count, created_at').eq('objective_id', obj.id).order('episode_number', { ascending: false }),
    supabase.from('objective_actions').select('description').eq('objective_id', obj.id).eq('source', 'engine_recommended').eq('status', 'done'),
    supabase.from('watch_sources').select('id, url_provided, url_resolved, url_resolved_at, priority_tier, watch_type, target_signal, last_state, last_checked_at, requires_confirmation, is_active').eq('objective_id', obj.id).eq('user_id', user.id).eq('is_active', true).order('priority_tier', { ascending: true }).order('created_at', { ascending: false }),
    supabase.from('watch_alerts').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('objective_id', obj.id).is('user_seen_at', null),
    supabase.from('signal_class_accuracy').select('signal_class, outcomes_scored, accuracy_avg, weight_modifier').eq('user_id', user.id).eq('objective_domain', obj.category as string).order('outcomes_scored', { ascending: false }),
  ])

  // FF-074: hunt location lives on objective_profiles (service client — ownership verified above)
  const { data: locationProfile } = await createServiceClient()
    .from('objective_profiles')
    .select('lat, lon, nws_grid_office, nws_grid_x, nws_grid_y')
    .eq('objective_id', obj.id)
    .maybeSingle()

  const hasCalendar = (calConnections?.length ?? 0) > 0

  // Cross-dependency signals are stored with a title like
  // "Cross-dependency: OBJ-02 → OBJ-03" (obj_id codes) at sweep time —
  // resolve to real objective names for display instead.
  const titleById = new Map((allObjectives ?? []).map(o => [o.id, o.title]))
  const displaySignals = (signals ?? []).map(sig => {
    if (sig.signal_type !== 'cross_dep' || (sig.objective_ids ?? []).length < 2) return sig
    const [fromId, toId] = sig.objective_ids as string[]
    const fromTitle = titleById.get(fromId)
    const toTitle = titleById.get(toId)
    if (!fromTitle || !toTitle) return sig
    return { ...sig, title: `${fromTitle} → ${toTitle}` }
  })

  const latestScoreEntry = scores?.[0] ?? null
  // The most recent confidence_scores row may be from a user_action recompute,
  // which writes recommended_actions: []. Use the latest entry that actually has
  // recommendations (i.e., from a real sweep) so we don't blank out the action list.
  const latestScoreWithRecs = scores?.find(s => (s.recommended_actions as string[] | null)?.length) ?? null
  const doneDescriptions = new Set((doneEngineActions ?? []).map(a => a.description as string))
  const recommendedActions = ((latestScoreWithRecs?.recommended_actions as string[] | null) ?? [])
    .filter(a => !doneDescriptions.has(a))
  const sparklineScores = [...(scores ?? [])].reverse() // chronological order

  // Pull this objective's narrative from its most recent sweep, for the factor list
  let factors: Factor[] = []
  if (latestScoreEntry?.sweep_id) {
    const { data: sweep } = await supabase.from('sweeps').select('raw_response').eq('id', latestScoreEntry.sweep_id).single()
    const raw = sweep?.raw_response as { objectives?: SweepObjectiveResult[] } | null
    const thisObj = raw?.objectives?.find(o => o.obj_id === obj.obj_id)
    if (thisObj) {
      factors = [
        ...(thisObj.risks ?? []).map(r => ({ color: 'red' as const, title: 'Risk', description: r, impact: 'Action required' })),
        ...(thisObj.opportunities ?? []).map(o => ({ color: 'green' as const, title: 'Opportunity', description: o, impact: 'High impact' })),
        ...(thisObj.changed_since_last_sweep ? [{ color: 'blue' as const, title: 'Recent change', description: thisObj.changed_since_last_sweep, impact: 'Neutral' }] : []),
      ]
    }
  }

  const status = getConfidenceStatus(obj.confidence)
  const delta = obj.confidence_prev !== null ? obj.confidence - obj.confidence_prev : undefined
  const startWeek = Math.max(1, Math.ceil((new Date(obj.created_at).getTime() - EXPERIMENT_START.getTime()) / (7 * 24 * 60 * 60 * 1000)))

  return (
    <div className="-m-6 p-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
      <div className="max-w-2xl mx-auto">
        <Link href="/objectives" className="inline-flex items-center gap-1.5 text-[12px] mb-5" style={{ color: 'var(--ov-text-mid)' }}>
          <ChevronLeft size={14} /> Back to goals
        </Link>

        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 style={{ fontFamily: "'EB Garamond', Georgia, serif", fontSize: 26, color: '#fff', lineHeight: 1.2 }}>
            {obj.title}
          </h1>
          <ObjectiveDetailClient
            obj={{
              id:                obj.id,
              title:             obj.title,
              status:            obj.status,
              confidence:        obj.confidence ?? null,
              target_date:       obj.target_date ?? null,
              deadline_type:     (obj as { deadline_type?: 'hard' | 'soft' }).deadline_type ?? 'hard',
              reservation_price: (obj as { reservation_price?: number | null }).reservation_price ?? null,
              context:           (obj as { context?: Record<string, unknown> }).context ?? {},
              objective_type:    (obj as { objective_type?: string | null }).objective_type ?? null,
              notes:             obj.notes ?? null,
              category:          obj.category as string,
            }}
            tier={(profile as { tier?: string; account_type?: string } | null)?.tier ?? 'trial'}
            accountType={(profile as { tier?: string; account_type?: string } | null)?.account_type ?? null}
            smsAlertsEnabled={(profile as { sms_alerts_enabled?: boolean } | null)?.sms_alerts_enabled ?? false}
            location={locationProfile as import('./ObjectiveDetailClient').HuntLocation | null}
            initialSources={(watchSources ?? []) as import('@/components/watchlist/WatchSourcesPanel').WatchSource[]}
            unseenAlertCount={unseenAlertCount ?? 0}
          />
        </div>
        <p className="text-[12px] mb-6" style={{ color: 'var(--ov-text-dim)' }}>
          {obj.target_date
            ? `Target: ${formatDateOnly(obj.target_date, { month: 'short', day: 'numeric', year: 'numeric' })} · `
            : ''}
          Started: Week {startWeek}
        </p>

        <div className="flex items-center gap-6 mb-6 flex-wrap">
          <ConfidenceRing
            confidence={obj.confidence}
            status={status}
            delta={delta}
            previousScore={obj.confidence_prev ?? undefined}
          />
          <div className="flex-1 min-w-[180px]">
            <SparklineBar scores={sparklineScores} />
          </div>
        </div>

        <ObjectiveTabs
          factors={factors}
          actions={recommendedActions}
          objId={obj.obj_id}
          objectiveId={obj.id}
          signals={displaySignals}
          goalDescription={obj.goal_description}
          goalContext={obj.goal_context}
          tier={(profile as { tier?: string } | null)?.tier ?? 'trial'}
          hasCalendar={hasCalendar}
          episodes={(episodes ?? []) as import('./ObjectiveTabs').Episode[]}
          objectiveDomain={obj.category as string}
          signalAccuracy={(signalAccuracy ?? []) as import('./ObjectiveTabs').SignalAccuracyRow[]}
          askWidget={<AskMeridianLoader />}
        />
      </div>
    </div>
  )
}
