import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import SweepStoryCard from '@/components/sweep/SweepStoryCard'
import AskMeridianBar from '@/components/ask/AskMeridianBar'
import { ChevronLeft } from 'lucide-react'

interface ObjectiveResult {
  obj_id: string
  confidence: number
  confidence_reasoning: string
  actions: string[]
  opportunities: string[]
  risks: string[]
  changed_since_last_sweep: string
}

interface CrossDependency {
  from_obj: string
  to_obj: string
  description: string
}

interface SweepRawResponse {
  sweep_summary: string
  top_priority_action: string
  objectives: ObjectiveResult[]
  cross_objective_dependencies: CrossDependency[]
}

interface StoryCard {
  type: 'risk' | 'opportunity' | 'insight' | 'action'
  title: string
  body: string
  objectiveName: string
  confidenceDelta?: number
  source?: string
}

function mapSignalType(signalType: string | null): StoryCard['type'] {
  if (signalType === 'risk') return 'risk'
  if (signalType === 'opportunity') return 'opportunity'
  return 'insight'
}

export default async function SweepResultPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: sweep } = await supabase
    .from('sweeps')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user!.id)
    .eq('status', 'complete')
    .single()

  if (!sweep) notFound()

  const raw = sweep.raw_response as SweepRawResponse | null
  const objectiveIds: string[] = sweep.objectives_swept ?? []

  const [{ data: objectives }, { data: scores }, { data: signals }] = await Promise.all([
    supabase.from('objectives').select('id, obj_id, title').in('id', objectiveIds),
    supabase.from('confidence_scores').select('objective_id, score, sweep_id, created_at').in('objective_id', objectiveIds).order('created_at', { ascending: true }),
    supabase.from('signals').select('*').eq('sweep_id', sweep.id),
  ])

  const objectiveList = objectives ?? []
  const titleByObjId = new Map(objectiveList.map(o => [o.obj_id, o.title]))
  const titleById = new Map(objectiveList.map(o => [o.id, o.title]))

  // Old → new score per objective, for this specific sweep
  const scoresByObjective = new Map<string, typeof scores>()
  for (const s of scores ?? []) {
    const list = scoresByObjective.get(s.objective_id) ?? []
    list.push(s)
    scoresByObjective.set(s.objective_id, list)
  }

  let biggestDelta: { objectiveName: string; oldScore: number | null; newScore: number; reason: string } | null = null

  for (const obj of objectiveList) {
    const history = scoresByObjective.get(obj.id) ?? []
    const idx = history.findIndex(s => s.sweep_id === sweep.id)
    if (idx === -1) continue
    const newScore = history[idx].score
    const oldScore = idx > 0 ? history[idx - 1].score : null
    const delta = oldScore !== null ? Math.abs(newScore - oldScore) : 0
    const reason = raw?.objectives.find(o => o.obj_id === obj.obj_id)?.confidence_reasoning ?? ''

    if (!biggestDelta || delta > Math.abs((biggestDelta.newScore) - (biggestDelta.oldScore ?? biggestDelta.newScore))) {
      biggestDelta = { objectiveName: obj.title, oldScore, newScore, reason }
    }
  }

  // Story cards: actions first, then risks, then opportunities, then insights
  const actionCards: StoryCard[] = []
  if (raw?.top_priority_action) {
    actionCards.push({ type: 'action', title: raw.top_priority_action, body: 'Your highest-priority action from this scan.', objectiveName: 'your goals' })
  }
  for (const obj of raw?.objectives ?? []) {
    for (const action of obj.actions) {
      if (action === raw?.top_priority_action) continue
      actionCards.push({ type: 'action', title: action, body: obj.changed_since_last_sweep || 'Recommended based on your latest scan.', objectiveName: titleByObjId.get(obj.obj_id) ?? obj.obj_id })
    }
  }

  // Cross-dependency signals are re-derived below from raw_response with
  // resolved objective names — skip them here to avoid showing each twice.
  const signalCards: StoryCard[] = (signals ?? [])
    .filter(sig => sig.signal_type !== 'cross_dep')
    .map(sig => ({
      type: mapSignalType(sig.signal_type),
      title: sig.title,
      body: sig.body ?? '',
      objectiveName: titleById.get(sig.objective_ids?.[0] ?? '') ?? 'your goals',
      source: sig.source ?? undefined,
    }))

  // Dedupe — the sweep's raw AI output can list the same dependency more than once.
  const seenDeps = new Set<string>()
  const crossDepCards: StoryCard[] = (raw?.cross_objective_dependencies ?? [])
    .filter(dep => {
      const key = `${dep.from_obj}-${dep.to_obj}`
      if (seenDeps.has(key)) return false
      seenDeps.add(key)
      return true
    })
    .map(dep => ({
      type: 'insight' as const,
      title: `${titleByObjId.get(dep.from_obj) ?? dep.from_obj} → ${titleByObjId.get(dep.to_obj) ?? dep.to_obj}`,
      body: dep.description,
      objectiveName: titleByObjId.get(dep.from_obj) ?? dep.from_obj,
    }))

  const risks = signalCards.filter(c => c.type === 'risk')
  const opportunities = signalCards.filter(c => c.type === 'opportunity')
  const insights = [...signalCards.filter(c => c.type === 'insight'), ...crossDepCards]

  const orderedCards = [...actionCards, ...risks, ...opportunities, ...insights]

  const sweepDate = sweep.completed_at
    ? new Date(sweep.completed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div className="-m-6 p-6 min-h-[calc(100vh-3.5rem)]" style={{ backgroundColor: 'var(--navy)' }}>
      <div className="max-w-2xl mx-auto pb-24">
        {/* Page-local header */}
        <div className="flex items-center gap-3 mb-5">
          <Link href="/dashboard" aria-label="Back to dashboard" style={{ color: 'var(--ov-text-mid)' }}>
            <ChevronLeft size={20} />
          </Link>
          <div>
            <p style={{ fontFamily: "'EB Garamond', Georgia, serif", fontStyle: 'italic', fontSize: 18, color: '#fff' }}>
              This week&apos;s brief
            </p>
            <p className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>{sweepDate}</p>
          </div>
        </div>

        {/* Confidence change card */}
        {biggestDelta && (
          <div
            className="rounded-2xl p-5 mb-4"
            style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)' }}
          >
            <p className="text-[13px] font-medium mb-2" style={{ color: 'var(--ov-text-hi)' }}>{biggestDelta.objectiveName}</p>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[28px] font-light" style={{ color: 'var(--ov-text-dim)' }}>{biggestDelta.oldScore ?? '—'}</span>
              <span style={{ color: 'var(--ov-text-dim)' }}>→</span>
              <span className="text-[28px] font-bold" style={{ color: 'var(--gold)' }}>{biggestDelta.newScore}</span>
            </div>
            {biggestDelta.reason && (
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>{biggestDelta.reason}</p>
            )}
          </div>
        )}

        {/* Story cards */}
        <div className="space-y-3">
          {orderedCards.map((card, i) => (
            <SweepStoryCard key={i} {...card} />
          ))}
        </div>

        {/* Full analysis accordion */}
        {signals && signals.length > 0 && (
          <details className="mt-5 group">
            <summary
              className="text-[11px] font-medium cursor-pointer list-none flex items-center gap-1.5"
              style={{ color: 'var(--blue-mid)' }}
            >
              See full analysis
            </summary>
            <div className="mt-3 space-y-2">
              {signals.map(sig => (
                <div key={sig.id} className="text-[12px] p-3 rounded-lg" style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border)' }}>
                  <p style={{ color: 'var(--ov-text-mid)' }}>{sig.title}</p>
                  {sig.source && <p className="text-[10px] mt-1" style={{ color: 'var(--ov-text-dim)' }}>{sig.source}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <AskMeridianBar
        placeholder="Ask Meridian about any of this…"
        context={raw?.sweep_summary}
      />
    </div>
  )
}
