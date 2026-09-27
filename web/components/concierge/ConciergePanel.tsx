'use client'

import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { VoiceUpgradePrompt } from '@/components/voice/VoiceUpgradePrompt'
import { ConciergeMessage } from './ConciergeMessage'
import type { ConciergeResponse } from '@/lib/concierge/conciergePrompt'
import { canUseFull } from '@/lib/voice/voiceTier'

interface ConversationItem {
  question: string
  response: ConciergeResponse
}

const STARTER_PROMPTS = [
  'What do I need to do to move my top goal to 90%?',
  'What is blocking my goals right now?',
  'What were my biggest wins last week?',
  'Which goal needs my attention most urgently?',
]

interface ConciergePanelProps {
  initialQuery?: string
}

export function ConciergePanel({ initialQuery }: ConciergePanelProps = {}) {
  const { voiceTier, voiceMode } = useAppStore()
  const [messages, setMessages] = useState<ConversationItem[]>([])
  const [input, setInput] = useState(initialQuery ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Auto-submit when VoiceMeridian pre-populates a question
  useEffect(() => {
    if (initialQuery?.trim()) {
      void handleSend(initialQuery.trim())
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!canUseFull(voiceTier)) {
    return <VoiceUpgradePrompt featureName="Concierge" requiredTier="full" />
  }

  async function handleSend(question: string) {
    const q = question.trim()
    if (!q || loading) return
    setInput('')
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/concierge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })

      if (res.status === 402) {
        setError('No ask credits remaining. Credits reset monthly.')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError('Concierge is available on Command plan.')
        setLoading(false)
        return
      }

      const data = await res.json() as { response?: ConciergeResponse }
      if (!data.response) throw new Error('empty response')

      setMessages(prev => [...prev, { question: q, response: data.response! }])

      // Speak answer_prose if voice mode is on
      if (voiceMode) {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(data.response.answer_prose)
        window.speechSynthesis.speak(utterance)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-8rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-6 pb-4">
        {messages.length === 0 && !loading && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: 'var(--text3)' }}>
              Ask Meridian anything about your goals, predictions, or progress.
            </p>
            <div className="flex flex-wrap gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => void handleSend(p)}
                  className="text-[12px] px-3 py-2 rounded-xl text-left transition-colors hover:opacity-80"
                  style={{ border: '1px solid var(--border)', color: 'var(--text2)', backgroundColor: 'var(--gray-lt)' }}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <ConciergeMessage key={i} question={m.question} response={m.response} />
        ))}

        {loading && (
          <div className="flex justify-start">
            <div
              className="rounded-2xl rounded-tl-md px-4 py-3 text-[13px]"
              style={{ backgroundColor: 'var(--gray-lt)', color: 'var(--text3)' }}
            >
              Thinking…
            </div>
          </div>
        )}

        {error && (
          <p className="text-[12px] px-1" style={{ color: 'var(--red)' }}>{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask anything about your goals…"
              rows={1}
              disabled={loading}
              style={{ width: '100%', resize: 'none' }}
            />
          </div>
          <button
            onClick={() => void handleSend(input)}
            disabled={!input.trim() || loading}
            className="flex items-center justify-center rounded-xl transition-opacity"
            style={{
              width: 40, height: 40,
              backgroundColor: 'var(--blue)',
              color: '#fff',
              opacity: (!input.trim() || loading) ? 0.4 : 1,
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
