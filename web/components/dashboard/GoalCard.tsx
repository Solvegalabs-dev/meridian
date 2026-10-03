import Link from 'next/link'
import { getConfidenceStatus, STATUS_COLORS, STATUS_LABELS } from '@/lib/utils/confidenceStatus'
import { timeAgo } from '@/lib/utils/timeAgo'
import { formatDateOnly } from '@/lib/utils/dateOnly'

interface GoalCardObjective {
  id: string
  title: string
  confidence: number
  confidence_prev: number | null
  target_date: string | null
  updated_at: string
}

interface GoalCardProps {
  objective: GoalCardObjective
  newSignalCount: number
}

export default function GoalCard({ objective, newSignalCount }: GoalCardProps) {
  const status = getConfidenceStatus(objective.confidence)
  const color = STATUS_COLORS[status]
  const delta = objective.confidence_prev !== null ? objective.confidence - objective.confidence_prev : null

  return (
    <Link
      href={`/objectives/${objective.id}`}
      className="flex rounded-2xl overflow-hidden transition-transform hover:-translate-y-0.5"
      style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)' }}
    >
      <div className="w-[3px] flex-shrink-0" style={{ backgroundColor: color }} />

      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-3 mb-2">
          <p className="text-[13px] font-medium leading-snug" style={{ color: 'var(--ov-text-hi)' }}>
            {objective.title}
          </p>
          <span
            className="flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ color, backgroundColor: `${color}22` }}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="text-[22px] font-bold leading-none" style={{ color }}>
            {objective.confidence}
          </span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--ov-border-md)' }}>
            <div className="h-full rounded-full" style={{ width: `${objective.confidence}%`, backgroundColor: color }} />
          </div>
          <span
            className="text-[11px] font-medium flex-shrink-0"
            style={{ color: delta === null || delta === 0 ? 'var(--ov-text-dim)' : delta > 0 ? 'var(--ov-green)' : 'var(--ov-red)' }}
          >
            {delta === null ? '—' : delta > 0 ? `↑ ${delta}` : delta < 0 ? `↓ ${Math.abs(delta)}` : '— 0'}
          </span>
        </div>
        <p className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'var(--ov-text-dim)' }}>
          on-track score
        </p>

        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--ov-border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
            {objective.target_date
              ? `By ${formatDateOnly(objective.target_date, { month: 'short', year: 'numeric' })}`
              : 'No target date'}
          </span>
          {newSignalCount > 0 ? (
            <span className="text-[11px] font-medium" style={{ color: 'var(--blue-mid)' }}>
              {newSignalCount} new signal{newSignalCount !== 1 ? 's' : ''} ›
            </span>
          ) : (
            <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
              Updated {timeAgo(objective.updated_at)}
            </span>
          )}
        </div>
      </div>
    </Link>
  )
}
