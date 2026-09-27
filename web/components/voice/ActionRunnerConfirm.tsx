'use client'

import { useEffect } from 'react'
import type { VoiceBriefTasker } from '@/lib/voice/voiceBriefTypes'
import type { VoiceIntent } from '@/lib/voice/actionRunnerTypes'
import { speak, stopSpeaking } from '@/lib/voice/ttsEngine'

interface ActionRunnerConfirmProps {
  intent: VoiceIntent
  tasker: VoiceBriefTasker
  onConfirm: () => void
  onRedo: () => void
  onDefer: () => void
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

export function ActionRunnerConfirm({ intent, tasker, onConfirm, onRedo, onDefer }: ActionRunnerConfirmProps) {
  useEffect(() => {
    if (!intent.clarifying_question) {
      const text = `${intent.action_type ? ACTION_LABELS[intent.action_type] ?? intent.action_type : 'Action'}: ${intent.note}${intent.date ? `. Date: ${intent.date}` : ''}. Confirm?`
      void speak(text)
    }
    return () => { stopSpeaking() }
  }, [intent])

  if (intent.clarifying_question) {
    return (
      <div className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--blue)', backgroundColor: 'rgba(46,124,184,0.06)' }}>
        <p className="text-[13px] font-medium" style={{ color: 'var(--blue)' }}>
          {intent.clarifying_question}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
          Speak your answer, or defer this tasker.
        </p>
        <button
          onClick={onDefer}
          className="w-full py-2 rounded-lg text-[13px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          Defer for later
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ border: '1px solid var(--border)', backgroundColor: 'var(--gray-lt)' }}>
      <div className="space-y-1">
        <p className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>{tasker.objective_title}</p>
        {intent.action_type && (
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text3)' }}>
            {ACTION_LABELS[intent.action_type] ?? intent.action_type}
          </p>
        )}
        <p className="text-[13px]" style={{ color: 'var(--text2)' }}>{intent.note}</p>
        {intent.date && (
          <p className="text-[11px]" style={{ color: 'var(--text3)' }}>Date: {intent.date}</p>
        )}
      </div>

      <button
        onClick={onConfirm}
        className="w-full py-2.5 rounded-lg text-[14px] font-semibold"
        style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
      >
        Confirm
      </button>

      <div className="flex gap-2">
        <button
          onClick={onRedo}
          className="flex-1 py-2 rounded-lg text-[13px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          Redo
        </button>
        <button
          onClick={onDefer}
          className="flex-1 py-2 rounded-lg text-[13px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          Defer
        </button>
      </div>
    </div>
  )
}
