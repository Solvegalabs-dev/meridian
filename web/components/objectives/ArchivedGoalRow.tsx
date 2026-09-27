'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

interface OutcomeData {
  outcome_type: string | null
  outcome_note: string | null
  actual_completed_at: string | null
  swept_at_close: number | null
  prediction_id: string | null
  recorded_at: string
}

interface ArchivedGoal {
  id: string
  title: string
  status: string
  closure_type: string | null
  updated_at: string
  target_date: string | null
  outcome: string | null
  notes: string | null
  objective_outcomes?: OutcomeData[] | null
}

interface EpisodeDetail {
  narrative: string | null
}

interface PredictionDetail {
  statement: string
  accuracy_score: number | null
}

interface ExpandedData {
  episode: EpisodeDetail | null
  prediction: PredictionDetail | null
  loaded: boolean
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function OutcomeBadge({ outcomeType }: { outcomeType: string | null }) {
  if (!outcomeType || outcomeType === 'ABANDONED') {
    if (outcomeType === 'ABANDONED') {
      return (
        <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold bg-gray-700 text-gray-300">
          ABANDONED
        </span>
      )
    }
    return <span className="text-[13px] text-[var(--text3)]">—</span>
  }
  const styles: Record<string, string> = {
    HIT:     'bg-green-600/20 text-green-400 border border-green-600/40',
    PARTIAL: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
    MISS:    'bg-red-600/20 text-red-400 border border-red-600/40',
  }
  const cls = styles[outcomeType] ?? 'bg-gray-700 text-gray-300'
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      {outcomeType}
    </span>
  )
}

function PredBadge({ score }: { score: number | null }) {
  if (score === null) return null
  const cls =
    score >= 70 ? 'bg-green-600/20 text-green-400 border border-green-600/40' :
    score >= 40 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                  'bg-red-600/20 text-red-400 border border-red-600/40'
  const label = score >= 70 ? 'HIT' : score >= 40 ? 'PARTIAL' : 'MISS'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {label} {score}%
    </span>
  )
}

export function ArchivedGoalRow({ goal }: { goal: ArchivedGoal }) {
  const supabase = createClient()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<ExpandedData>({ episode: null, prediction: null, loaded: false })

  const outcome = goal.objective_outcomes?.[0] ?? null
  const closedAt = outcome?.actual_completed_at ?? goal.updated_at
  const closureLabel = goal.closure_type === 'abandoned' || outcome?.outcome_type === 'ABANDONED'
    ? 'Abandoned'
    : goal.status === 'achieved' || (outcome && outcome.outcome_type !== 'ABANDONED')
    ? 'Closed'
    : goal.status === 'paused' || goal.status === 'archived'
    ? 'Archived'
    : 'Closed'

  function handleClone() {
    const parts: string[] = [`pre_title=${encodeURIComponent(goal.title)}`]
    if (goal.outcome) parts.push(`pre_outcome=${encodeURIComponent(goal.outcome)}`)
    if (goal.notes)   parts.push(`pre_notes=${encodeURIComponent(goal.notes)}`)
    if (goal.target_date) parts.push(`pre_target_date=${encodeURIComponent(goal.target_date)}`)
    parts.push('cloned=1')
    router.push(`/objectives/new?${parts.join('&')}`)
  }

  async function handleToggle() {
    if (!open && !expanded.loaded) {
      const [episodeRes, predRes] = await Promise.all([
        supabase
          .from('objective_episodes')
          .select('narrative')
          .eq('objective_id', goal.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        outcome?.prediction_id
          ? supabase
              .from('predictions')
              .select('statement, accuracy_score')
              .eq('id', outcome.prediction_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      setExpanded({
        episode: episodeRes.data ?? null,
        prediction: (predRes as { data: PredictionDetail | null }).data ?? null,
        loaded: true,
      })
    }
    setOpen(o => !o)
  }

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-white">
      {/* Main row */}
      <div className="grid items-center gap-3 px-4 py-3" style={{ gridTemplateColumns: '1fr 100px 120px 100px 40px' }}>
        {/* Goal */}
        <div>
          <p className="text-[13px] font-medium text-[var(--text)] leading-snug">{goal.title}</p>
          <p className="text-[11px] text-[var(--text3)] mt-0.5">{closureLabel}</p>
        </div>

        {/* Outcome */}
        <div>
          <OutcomeBadge outcomeType={outcome?.outcome_type ?? null} />
        </div>

        {/* Confidence at close */}
        <div className="text-[13px] text-[var(--text)]">
          {outcome?.swept_at_close != null ? `${outcome.swept_at_close}%` : '—'}
        </div>

        {/* Closed date */}
        <div className="text-[13px] text-[var(--text2)]">
          {fmtDate(closedAt)}
        </div>

        {/* More toggle */}
        <button
          onClick={handleToggle}
          className="flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--gray-lt)] transition-colors"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? <ChevronUp size={14} className="text-[var(--text3)]" /> : <ChevronDown size={14} className="text-[var(--text3)]" />}
        </button>
      </div>

      {/* Inline expansion */}
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3 bg-[var(--bg)] flex flex-col gap-3">
          {!expanded.loaded && (
            <p className="text-[12px] text-[var(--text3)]">Loading…</p>
          )}

          {expanded.loaded && (
            <>
              {/* Part 1: Outcome note */}
              {outcome?.outcome_note && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)] mb-1">What happened:</p>
                  <p className="text-[13px] text-[var(--text2)] leading-relaxed">{outcome.outcome_note}</p>
                </div>
              )}

              {/* Part 2: Last engine read */}
              {expanded.episode?.narrative && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)] mb-1">Last engine read:</p>
                  <p className="text-[13px] text-[var(--text2)] leading-relaxed">
                    {expanded.episode.narrative.length > 500
                      ? `${expanded.episode.narrative.slice(0, 500)}…`
                      : expanded.episode.narrative}
                  </p>
                </div>
              )}

              {/* Part 3: Linked prediction */}
              {expanded.prediction && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)] mb-1">Prediction:</p>
                  <div className="flex items-start gap-2">
                    <p className="text-[13px] text-[var(--text2)] leading-relaxed flex-1">
                      {expanded.prediction.statement.length > 120
                        ? `${expanded.prediction.statement.slice(0, 120)}…`
                        : expanded.prediction.statement}
                    </p>
                    <PredBadge score={expanded.prediction.accuracy_score} />
                  </div>
                </div>
              )}

              {/* Nothing to show */}
              {!outcome?.outcome_note && !expanded.episode?.narrative && !expanded.prediction && (
                <p className="text-[12px] text-[var(--text3)]">No additional details recorded.</p>
              )}

              {/* Clone action */}
              <div className="pt-1 border-t border-[var(--border)]">
                <button
                  onClick={handleClone}
                  className="text-[12px] text-[var(--blue)] hover:underline font-medium"
                >
                  Clone this goal
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
