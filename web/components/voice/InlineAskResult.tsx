'use client'

import type { ConciergeResponse } from '@/lib/concierge/conciergePrompt'

interface InlineAskResultProps {
  query: string
  response: ConciergeResponse | string | null
  onDismiss?: () => void
}

export function InlineAskResult({ query, response, onDismiss }: InlineAskResultProps) {
  const isConcierge = response !== null && typeof response === 'object'
  const prose = isConcierge
    ? (response as ConciergeResponse).answer_prose
    : typeof response === 'string' ? response : ''
  const actions = isConcierge ? (response as ConciergeResponse).ranked_actions.slice(0, 2) : []

  return (
    <div
      className="w-full max-w-md rounded-2xl p-5 space-y-3"
      style={{ backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      {query && (
        <p className="text-[11px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.4)' }}>
          {query}
        </p>
      )}
      <p className="text-white text-[14px] leading-relaxed">{prose}</p>

      {actions.length > 0 && (
        <ol className="space-y-1.5 list-none">
          {actions.map((a, i) => (
            <li key={i} className="flex gap-2 text-[13px]">
              <span style={{ color: '#C8A84B', fontVariantNumeric: 'tabular-nums', minWidth: 16 }}>
                {i + 1}.
              </span>
              <span style={{ color: 'rgba(255,255,255,0.85)' }}>{a.action}</span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between pt-1">
        <a
          href={query ? `/ask?q=${encodeURIComponent(query)}` : '/ask'}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] underline"
          style={{ color: '#C8A84B' }}
        >
          See full answer →
        </a>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-[11px]"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}
