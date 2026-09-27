'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'
import { timeAgo } from '@/lib/utils/timeAgo'
import type { ConciergeResponse } from '@/lib/concierge/conciergePrompt'

type AskIntent = 'external' | 'internal'
type PreviewIntent = AskIntent | null

const INTERNAL_SIGNALS = [
  'my goal', 'my objective', 'my confidence', 'my prediction', 'my score',
  'what should i do', 'what do i need to do', 'what is blocking', 'how do i get to',
  'what happened with my', 'which goal', 'my week', 'my actions', 'my signals',
  'my progress', 'my results',
]
const EXTERNAL_SIGNALS = [
  'what is happening', 'market', 'news', 'industry', 'rates', 'hiring',
  'latest', 'current', 'today', 'prices', 'economy', 'regulations',
  'what are companies', 'what is the outlook', 'trends',
]

function previewIntent(q: string): PreviewIntent {
  const lower = q.toLowerCase()
  if (INTERNAL_SIGNALS.some(s => lower.includes(s))) return 'internal'
  if (EXTERNAL_SIGNALS.some(s => lower.includes(s))) return 'external'
  return null
}

interface Message {
  role: 'user' | 'assistant'
  text?: string
  conciergeResponse?: ConciergeResponse
  intent?: AskIntent
  timestamp: string
}

const INTERNAL_STARTERS = [
  'What do I need to do to move my top goal to 90%?',
  'What is blocking my goals right now?',
  'Which goal needs my attention most urgently?',
  'What were my biggest wins last week?',
]

const EXTERNAL_STARTERS = [
  'What is happening in airline hiring right now?',
  'What market conditions affect my investment goal?',
  'What should I know about this week?',
]

interface AskThreadClientProps {
  openingMessage: string
  objectives: unknown[]
  latestSweep: unknown
  initialQuestion?: string
}

export default function AskThreadClient({
  openingMessage,
  objectives,
  latestSweep,
  initialQuestion,
}: AskThreadClientProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: openingMessage, timestamp: new Date().toISOString() },
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [intentPreview, setIntentPreview] = useState<PreviewIntent>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const sentInitialRef = useRef(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleInputChange(value: string) {
    setInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setIntentPreview(value.trim() ? previewIntent(value) : null)
    }, 500)
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setInput('')
    setIntentPreview(null)
    setMessages(prev => [...prev, { role: 'user', text: trimmed, timestamp: new Date().toISOString() }])
    setSending(true)

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: trimmed, context: { objectives, latestSweep } }),
      })
      const data = await res.json() as {
        response?: string | ConciergeResponse
        intent?: AskIntent
        error?: string
      }

      const intent = data.intent
      const response = data.response

      if (intent === 'internal' && response && typeof response === 'object') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          conciergeResponse: response as ConciergeResponse,
          intent: 'internal',
          timestamp: new Date().toISOString(),
        }])
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: typeof response === 'string' ? response : (data.error ?? 'Something went wrong — please try again.'),
          intent: intent ?? 'external',
          timestamp: new Date().toISOString(),
        }])
      }
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Something went wrong — please try again.',
        timestamp: new Date().toISOString(),
      }])
    }
    setSending(false)
  }

  useEffect(() => {
    if (initialQuestion && !sentInitialRef.current) {
      sentInitialRef.current = true
      void send(initialQuestion)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const showStarters = messages.length <= 1 && !sending

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem-2rem)]">
      <div className="flex-1 flex flex-col gap-4 max-w-2xl mx-auto w-full pt-2">

        {/* Starter prompts */}
        {showStarters && (
          <div className="space-y-4 mb-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: '#C8A84B' }}>
                About your goals
              </p>
              <div className="flex flex-wrap gap-2">
                {INTERNAL_STARTERS.map(p => (
                  <button
                    key={p}
                    onClick={() => void send(p)}
                    className="text-[12px] px-3 py-1.5 rounded-xl text-left transition-opacity hover:opacity-70"
                    style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: '#0E8A8A' }}>
                About the world
              </p>
              <div className="flex flex-wrap gap-2">
                {EXTERNAL_STARTERS.map(p => (
                  <button
                    key={p}
                    onClick={() => void send(p)}
                    className="text-[12px] px-3 py-1.5 rounded-xl text-left transition-opacity hover:opacity-70"
                    style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Message thread */}
        {messages.map((m, i) => (
          <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
            {m.role === 'assistant' && (
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: m.intent === 'internal' ? '#C8A84B' : m.intent === 'external' ? '#0E8A8A' : 'var(--gold)' }}
                />
                <p
                  className="text-[10px] font-medium"
                  style={{ color: m.intent === 'internal' ? '#C8A84B' : m.intent === 'external' ? '#0E8A8A' : 'var(--gold)' }}
                >
                  {m.intent === 'internal' ? 'Goal Intelligence' : m.intent === 'external' ? 'World Signal' : 'Meridian'} · {timeAgo(m.timestamp)}
                </p>
              </div>
            )}
            <div
              className="max-w-[85%] px-4 py-2.5 text-[13px] leading-relaxed"
              style={
                m.role === 'user'
                  ? { backgroundColor: 'var(--blue)', color: '#fff', borderRadius: '14px 14px 4px 14px' }
                  : { backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)', borderRadius: '14px 14px 14px 4px' }
              }
            >
              {m.conciergeResponse ? (
                <ConciergeResponseView response={m.conciergeResponse} />
              ) : (
                m.text
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex flex-col items-start">
            <p className="text-[10px] font-medium mb-1 flex items-center gap-1.5" style={{ color: 'var(--gold)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--gold)' }} />
              Meridian
            </p>
            <div
              className="px-4 py-2.5 text-[13px]"
              style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-dim)', borderRadius: '14px 14px 14px 4px' }}
            >
              Thinking…
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div
        className="sticky bottom-0 pt-8 pb-4 px-1"
        style={{ background: 'linear-gradient(to top, rgba(11,24,41,0.92), rgba(11,24,41,0))' }}
      >
        <form
          onSubmit={e => { e.preventDefault(); void send(input) }}
          className="flex items-center gap-2 max-w-2xl mx-auto"
        >
          <input
            value={input}
            onChange={e => handleInputChange(e.target.value)}
            placeholder="Ask anything about your goals or the world..."
            className="flex-1 px-4 py-3 rounded-full text-[13px] focus:outline-none"
            style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: '#fff' }}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || sending}
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: 'var(--blue)' }}
          >
            <ArrowUp size={16} color="#fff" />
          </button>
        </form>
        <p className="text-center mt-2 text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
          {intentPreview === 'internal'
            ? 'This looks like a goal question (2 credits)'
            : intentPreview === 'external'
            ? 'This looks like a world question (1 credit)'
            : 'Goal questions use 2 credits · World questions use 1 credit'}
        </p>
      </div>
    </div>
  )
}

function ConciergeResponseView({ response }: { response: ConciergeResponse }) {
  return (
    <div className="space-y-3">
      <p>{response.answer_prose}</p>
      {response.ranked_actions.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold mb-1 uppercase tracking-wider" style={{ color: '#C8A84B' }}>
            Actions
          </p>
          <ol className="space-y-1 list-decimal list-inside">
            {response.ranked_actions.map((a, i) => (
              <li key={i} className="text-[12px]">{a.action}</li>
            ))}
          </ol>
        </div>
      )}
      {response.signals_to_watch.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {response.signals_to_watch.map((s, i) => (
            <span
              key={i}
              className="text-[11px] px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'rgba(200,168,75,0.12)', color: '#C8A84B', border: '1px solid rgba(200,168,75,0.25)' }}
            >
              {s}
            </span>
          ))}
        </div>
      )}
      {response.needs_sweep && (
        <div
          className="text-[12px] px-3 py-2 rounded-lg mt-1"
          style={{ backgroundColor: 'rgba(200,168,75,0.08)', border: '1px solid rgba(200,168,75,0.2)', color: '#C8A84B' }}
        >
          A sweep would help answer this more precisely.
        </div>
      )}
    </div>
  )
}
