'use client'

import { useState } from 'react'
import type { ScoredPrediction, OutcomeType } from '@/lib/predictions/trackRecord'

interface Props {
  predictions: ScoredPrediction[]
}

const OUTCOME_BADGE: Record<OutcomeType, { label: string; bg: string; text: string; border: string }> = {
  HIT:     { label: 'HIT',     bg: 'var(--green-lt)',  text: 'var(--green)',        border: 'rgba(15,110,86,0.2)' },
  PARTIAL: { label: 'PARTIAL', bg: 'var(--amber-lt)',  text: 'var(--amber-brand)',  border: 'rgba(186,117,23,0.2)' },
  MISS:    { label: 'MISS',    bg: '#FDECEA',          text: '#A32D2D',             border: 'rgba(163,45,45,0.2)' },
  OPEN:    { label: 'OPEN',    bg: 'var(--gray-lt)',   text: 'var(--text3)',        border: 'var(--border)' },
}

function AccuracyDisplay({ score }: { score: number | null }) {
  if (score === null) return null
  if (score <= 5) {
    return (
      <span className="text-[11px]" style={{ color: 'var(--gold)' }}>
        {'★'.repeat(score)}{'☆'.repeat(5 - score)}
      </span>
    )
  }
  // 0-100 Engine 4 score
  const color = score >= 70 ? 'var(--green)' : score >= 50 ? 'var(--amber-brand)' : '#A32D2D'
  return (
    <span className="text-[11px] font-semibold tabular-nums" style={{ color }}>
      {score}
    </span>
  )
}

export function PredictionHistoryList({ predictions }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (predictions.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--text3)]">
        <div className="text-[36px] mb-3">🎯</div>
        <div className="text-[13px] font-medium text-[var(--text2)] mb-1">No predictions scored yet</div>
        <div className="text-[12px] text-[var(--text3)]">
          When a prediction horizon passes, log the outcome — it appears here.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {predictions.map((pred) => {
        const badge = OUTCOME_BADGE[pred.outcome_type]
        const isExpanded = expandedId === pred.id
        const horizonDate = new Date(pred.horizon_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })

        return (
          <div
            key={pred.id}
            className="border border-[var(--border)] rounded-xl bg-white overflow-hidden"
          >
            <div
              className="flex items-start gap-3 p-4 cursor-pointer hover:bg-[var(--gray-lt)] transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : pred.id)}
            >
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5"
                style={{
                  backgroundColor: badge.bg,
                  color: badge.text,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {badge.label}
              </span>

              <div className="flex-1 min-w-0">
                {pred.objective_title && (
                  <div className="text-[11px] text-[var(--text3)] mb-0.5 font-medium truncate">
                    {pred.objective_obj_id ? `${pred.objective_obj_id} · ` : ''}{pred.objective_title}
                  </div>
                )}
                <div className="text-[13px] text-[var(--text2)] leading-snug line-clamp-2">
                  {pred.statement}
                </div>
              </div>

              <div className="text-right flex-shrink-0 ml-2">
                <div className="text-[13px] font-semibold text-[var(--text)]">
                  {pred.filed_confidence}%
                </div>
                <AccuracyDisplay score={pred.accuracy_score} />
                <div className="text-[10px] text-[var(--text3)] mt-0.5">{horizonDate}</div>
              </div>
            </div>

            {isExpanded && pred.outcome_text && (
              <div className="px-4 pb-4 border-t border-[var(--border)] bg-[var(--gray-lt)]">
                <div className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wider mb-1.5 mt-3">
                  Outcome
                </div>
                <div className="text-[12px] text-[var(--text2)] leading-relaxed">
                  {pred.outcome_text}
                </div>
                {pred.scored_at && (
                  <div className="text-[11px] text-[var(--text3)] mt-2">
                    Scored {new Date(pred.scored_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                )}
              </div>
            )}

            {isExpanded && !pred.outcome_text && pred.accuracy_score !== null && (
              <div className="px-4 pb-4 border-t border-[var(--border)] bg-[var(--gray-lt)]">
                <div className="text-[12px] text-[var(--text3)] mt-3">
                  No outcome narrative recorded.
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
