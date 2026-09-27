'use client'

import type { VoiceBriefTasker } from '@/lib/voice/voiceBriefTypes'
import type { ActionRunnerStatus } from '@/lib/voice/actionRunnerTypes'

const TASKER_LABELS: Record<string, string> = {
  log_action: 'Log Action',
  score_prediction: 'Score Prediction',
  update_objective: 'Update Goal',
  lifecycle_change: 'Goal Status',
}

interface TaskerCardProps {
  tasker: VoiceBriefTasker
  status: ActionRunnerStatus
  currentIndex: number
  totalCount: number
}

export function TaskerCard({ tasker, status, currentIndex, totalCount }: TaskerCardProps) {
  const STATUS_COLORS: Partial<Record<ActionRunnerStatus, string>> = {
    announcing: 'var(--blue)',
    listening: 'var(--green)',
    parsing: 'var(--text3)',
    confirming: 'var(--gold)',
    writing: 'var(--blue)',
  }

  const statusColor = STATUS_COLORS[status] ?? 'var(--text3)'

  return (
    <div
      className="rounded-xl p-4"
      style={{ border: '1px solid var(--border)', backgroundColor: 'var(--gray-lt)' }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide"
          style={{ backgroundColor: 'rgba(46,124,184,0.1)', color: 'var(--blue)' }}
        >
          {TASKER_LABELS[tasker.tasker_type] ?? tasker.tasker_type}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
          Tasker {currentIndex + 1} of {totalCount}
        </span>
      </div>

      <p className="text-[14px] font-medium mb-1" style={{ color: 'var(--text)' }}>
        {tasker.objective_title}
      </p>

      <p className="text-[12px]" style={{ color: 'var(--text2)' }}>
        {tasker.context}
      </p>

      {status !== 'idle' && status !== 'done' && (
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span className="text-[11px]" style={{ color: statusColor }}>
            {status === 'announcing' && 'Speaking…'}
            {status === 'listening' && 'Listening…'}
            {status === 'parsing' && 'Processing…'}
            {status === 'confirming' && 'Confirm?'}
            {status === 'writing' && 'Saving…'}
          </span>
        </div>
      )}
    </div>
  )
}
