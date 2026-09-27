'use client'

import type { VoiceBriefTasker } from '@/lib/voice/voiceBriefTypes'
import type { VoiceIntent } from '@/lib/voice/actionRunnerTypes'

const TASKER_LABELS: Record<string, string> = {
  log_action: 'Log Action',
  score_prediction: 'Score Prediction',
  update_objective: 'Update Goal',
  lifecycle_change: 'Goal Status',
}

const ACTION_LABELS: Record<string, string> = {
  task_completed: 'Task completed',
  decision_made: 'Decision made',
  contact: 'Contact / meeting',
  milestone: 'Milestone',
  observation: 'Observation',
  hit: 'Prediction hit',
  miss: 'Prediction miss',
}

interface DrivingModeTaskerCardProps {
  tasker: VoiceBriefTasker
  intent: VoiceIntent | null
  onConfirm: () => void
  onSkip: () => void
}

export function DrivingModeTaskerCard({ tasker, intent, onConfirm, onSkip }: DrivingModeTaskerCardProps) {
  return (
    <div className="flex flex-col items-center gap-4 w-full px-6">
      {/* Goal name */}
      <p className="text-[28px] font-semibold text-center leading-tight text-white max-w-sm">
        {tasker.objective_title}
      </p>

      {/* Tasker type badge */}
      <span
        className="text-[11px] font-semibold px-3 py-1 rounded-full uppercase tracking-wide"
        style={{ backgroundColor: 'rgba(46,124,184,0.25)', color: '#7ab3e0' }}
      >
        {TASKER_LABELS[tasker.tasker_type] ?? tasker.tasker_type}
      </span>

      {/* Parsed intent — shown after parse */}
      {intent && (
        <div className="text-center space-y-1">
          {intent.action_type && (
            <p className="text-[12px] uppercase tracking-wide" style={{ color: '#7ab3e0' }}>
              {ACTION_LABELS[intent.action_type] ?? intent.action_type}
            </p>
          )}
          <p className="text-[16px] text-white/80 max-w-xs truncate">{intent.note}</p>
          {intent.date && (
            <p className="text-[12px]" style={{ color: '#7ab3e0' }}>{intent.date}</p>
          )}
        </div>
      )}

      {/* Confirm + Skip */}
      <div className="w-full space-y-3 mt-2">
        <button
          onClick={onConfirm}
          disabled={!intent}
          className="w-full rounded-2xl text-[18px] font-semibold text-white transition-opacity"
          style={{
            height: 64,
            backgroundColor: intent ? 'var(--blue)' : 'rgba(255,255,255,0.1)',
            opacity: intent ? 1 : 0.5,
          }}
        >
          Confirm
        </button>
        <button
          onClick={onSkip}
          className="w-full rounded-2xl text-[15px]"
          style={{ height: 52, border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.6)' }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
