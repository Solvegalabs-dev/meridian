'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { speak as speakTTS, stopSpeaking } from '@/lib/voice/ttsEngine'
import { useVoice } from '@/lib/voice/useVoice'
import type { VoiceBrief, VoiceBriefTasker } from '@/lib/voice/voiceBriefTypes'
import type { ActionRunnerStatus, VoiceIntent } from '@/lib/voice/actionRunnerTypes'
import { TaskerCard } from './TaskerCard'
import { ActionRunnerConfirm } from './ActionRunnerConfirm'

interface ActionRunnerProps {
  brief: VoiceBrief
  onComplete: () => void
  drivingMode?: boolean
  onConciergeRequest?: (question: string) => void
}

export function ActionRunner({ brief, onComplete, drivingMode, onConciergeRequest }: ActionRunnerProps) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [status, setStatus] = useState<ActionRunnerStatus>('idle')
  const [intent, setIntent] = useState<VoiceIntent | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const supabase = createClient()
  const { isSupported, transcript, startListening, stopListening, resetTranscript } = useVoice()
  const announcedRef = useRef(false)

  const tasker: VoiceBriefTasker | undefined = brief.taskers[currentIndex]

  const speak = useCallback((text: string, onEnd?: () => void) => {
    void speakTTS(text, onEnd)
  }, [])

  const deferTasker = useCallback(async (t: VoiceBriefTasker) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('voice_tasks').insert({
          user_id: user.id,
          sweep_id: brief.sweep_id,
          tasker_type: t.tasker_type,
          objective_id: t.objective_id,
          context: { original_context: t.context },
          status: 'pending',
        })
      }
    } catch {
      // non-fatal
    }
  }, [supabase, brief.sweep_id])

  const advance = useCallback(() => {
    const next = currentIndex + 1
    if (next >= brief.taskers.length) {
      setStatus('done')
      speak('All taskers complete.', onComplete)
    } else {
      setCurrentIndex(next)
      setStatus('idle')
      setIntent(null)
      announcedRef.current = false
    }
  }, [currentIndex, brief.taskers.length, speak, onComplete])

  // Announce current tasker when status resets to idle
  useEffect(() => {
    if (!tasker || announcedRef.current) return
    announcedRef.current = true
    setStatus('announcing')
    speak(tasker.context, () => {
      setStatus('listening')
      startListening()
    })
  }, [tasker, speak, startListening])

  // Handle transcript when listening
  useEffect(() => {
    if (status !== 'listening' || !transcript) return
    stopListening()

    // Driving mode stop command
    if (drivingMode && transcript.toLowerCase().includes('meridian stop')) {
      window.speechSynthesis.cancel()
      onComplete()
      return
    }

    // "Ask Meridian [question]" — pause runner, open Concierge
    const lower = transcript.toLowerCase()
    if (lower.startsWith('ask meridian') && onConciergeRequest) {
      const question = transcript.slice('ask meridian'.length).trim()
      if (question) {
        stopListening()
        speak('One moment.')
        onConciergeRequest(question)
        // Reset to re-announce current tasker after Concierge closes
        announcedRef.current = false
        setStatus('idle')
        return
      }
    }

    setStatus('parsing')
    fetch('/api/voice/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        tasker_type: tasker?.tasker_type ?? '',
        objective_title: tasker?.objective_title ?? '',
        objective_id: tasker?.objective_id ?? '',
        prediction_title: undefined,
      }),
    })
      .then(r => r.json() as Promise<{ intent?: VoiceIntent }>)
      .then(data => {
        const parsed = data.intent
        if (!parsed) { void deferTasker(tasker!); advance(); return }

        // Driving mode: defer if confidence low or has clarifying question
        if (drivingMode && (parsed.confidence < 0.80 || parsed.clarifying_question)) {
          speak('Held for later.')
          void deferTasker(tasker!)
          setTimeout(advance, 1500)
          return
        }

        setIntent(parsed)
        setStatus('confirming')
        resetTranscript()
      })
      .catch(() => { void deferTasker(tasker!); advance() })
  }, [status, transcript, tasker, drivingMode, stopListening, speak, deferTasker, advance, resetTranscript, onComplete, onConciergeRequest])

  async function executeTasker(t: VoiceBriefTasker, i: VoiceIntent) {
    setStatus('writing')
    setWriteError(null)
    try {
      if (t.tasker_type === 'log_action') {
        await fetch(`/api/objectives/${t.objective_id}/actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: i.note,
            action_date: i.date ?? new Date().toISOString().split('T')[0],
            source: 'voice',
          }),
        })
      } else if (t.tasker_type === 'score_prediction' && t.prediction_id) {
        await fetch('/api/predictions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: t.prediction_id,
            accuracy_score: i.action_type === 'hit' ? 1 : 0,
            scoring_note: i.note,
          }),
        })
      } else if (t.tasker_type === 'update_objective') {
        await fetch(`/api/objectives/${t.objective_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: i.note }),
        })
      } else if (t.tasker_type === 'lifecycle_change') {
        const endpoint = i.action_type === 'task_completed'
          ? `/api/objectives/${t.objective_id}/complete`
          : i.action_type === 'decision_made' && i.note.toLowerCase().includes('abandon')
          ? `/api/objectives/${t.objective_id}/abandon`
          : `/api/objectives/${t.objective_id}`
        const isPost = endpoint.endsWith('/complete') || endpoint.endsWith('/abandon')
        await fetch(endpoint, {
          method: isPost ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isPost ? {} : { status: 'active' }),
        })
      }
    } catch {
      setWriteError('Save failed. Try again or defer.')
      setStatus('confirming')
      return
    }
    advance()
  }

  function handleConfirm() {
    if (!tasker || !intent) return
    void executeTasker(tasker, intent)
  }

  function handleRedo() {
    setIntent(null)
    setStatus('listening')
    resetTranscript()
    startListening()
  }

  function handleDefer() {
    void deferTasker(tasker!)
    advance()
  }

  if (status === 'done' || !tasker) return null

  return (
    <div className="space-y-3">
      <TaskerCard
        tasker={tasker}
        status={status}
        currentIndex={currentIndex}
        totalCount={brief.taskers.length}
      />

      {writeError && (
        <p className="text-[12px] px-1" style={{ color: 'var(--red)' }}>{writeError}</p>
      )}

      {status === 'confirming' && intent && (
        <ActionRunnerConfirm
          intent={intent}
          tasker={tasker}
          onConfirm={handleConfirm}
          onRedo={handleRedo}
          onDefer={handleDefer}
        />
      )}

      {(status === 'announcing' || status === 'listening' || status === 'parsing') && (
        <div className="flex gap-2">
          {status === 'listening' && isSupported && (
            <button
              onClick={() => { stopListening(); handleDefer() }}
              className="flex-1 py-2 rounded-lg text-[13px]"
              style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
            >
              Skip this tasker
            </button>
          )}
          <button
            onClick={() => { stopSpeaking(); stopListening(); void deferTasker(tasker); advance() }}
            className="flex-1 py-2 rounded-lg text-[13px]"
            style={{ border: '1px solid var(--border)', color: 'var(--text2)' }}
          >
            Defer all remaining
          </button>
        </div>
      )}
    </div>
  )
}
