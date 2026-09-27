'use client'

import type { ConciergeResponse } from '@/lib/concierge/conciergePrompt'

interface ConciergeMessageProps {
  question: string
  response: ConciergeResponse
}

export function ConciergeMessage({ question, response }: ConciergeMessageProps) {
  return (
    <div className="space-y-3">
      {/* User question */}
      <div className="flex justify-end">
        <div
          className="max-w-[75%] rounded-2xl rounded-tr-md px-4 py-2.5 text-[13px] text-white"
          style={{ backgroundColor: 'var(--navy)' }}
        >
          {question}
        </div>
      </div>

      {/* Meridian answer */}
      <div className="flex justify-start">
        <div className="max-w-[85%] space-y-3">
          {/* answer_prose */}
          <div
            className="rounded-2xl rounded-tl-md px-4 py-3 text-[13px]"
            style={{ backgroundColor: 'var(--gray-lt)', color: 'var(--text)' }}
          >
            {response.answer_prose}
          </div>

          {/* ranked_actions */}
          {response.ranked_actions.length > 0 && (
            <div className="space-y-1.5">
              {response.ranked_actions.map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl px-3 py-2.5 text-[12px]"
                  style={{ border: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}
                >
                  <p className="font-medium" style={{ color: 'var(--text)' }}>
                    {i + 1}. {a.action}
                  </p>
                  <p className="mt-0.5" style={{ color: 'var(--text3)' }}>{a.rationale}</p>
                </div>
              ))}
            </div>
          )}

          {/* signals_to_watch */}
          {response.signals_to_watch.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {response.signals_to_watch.map((s, i) => (
                <span
                  key={i}
                  className="rounded-full px-2.5 py-0.5 text-[11px]"
                  style={{ backgroundColor: 'rgba(46,124,184,0.1)', color: 'var(--blue)' }}
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {/* needs_sweep banner */}
          {response.needs_sweep && (
            <div
              className="rounded-xl px-3 py-2.5 text-[12px]"
              style={{ backgroundColor: 'rgba(201,155,73,0.1)', border: '1px solid rgba(201,155,73,0.3)', color: 'var(--gold)' }}
            >
              This question needs fresh data.{' '}
              <a href="/sweep/latest" className="underline font-medium">Run a sweep?</a>
              {response.needs_sweep_reason && (
                <span style={{ color: 'var(--text3)' }}> — {response.needs_sweep_reason}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
