'use client'
// components/AskMeridian.tsx
// FF-017 — Ask Meridian: On-Demand Intelligence Queries
// Solvega Labs LLC · Meridian Arc · Confidential
//
// Client component. Receives initialUsed / initialLimit from the server
// wrapper (AskMeridianLoader) and keeps usage in local state after each query.
// Brand tokens: Gold #C9A227 · Navy #0D1B3E

import { useState } from 'react'

interface UsageState {
  used: number
  limit: number
  tier: string
  askCredits: number
}

interface AskMeridianProps {
  initialUsage: UsageState
}

export default function AskMeridian({ initialUsage }: AskMeridianProps) {
  const [question, setQuestion] = useState('')
  const [response, setResponse] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageState>(initialUsage)
  const [webSearchUsed, setWebSearchUsed] = useState(false)
  const [suggestedActions, setSuggestedActions] = useState<string[]>([])
  const [askQueryId, setAskQueryId] = useState<string | null>(null)
  const [matchedObjectiveIds, setMatchedObjectiveIds] = useState<string[]>([])
  const [confirmedActions, setConfirmedActions] = useState<Set<number>>(new Set())

  const remaining = usage.limit - usage.used
  const atLimit = remaining <= 0 && usage.askCredits <= 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim() || loading || atLimit) return

    setLoading(true)
    setError(null)
    setResponse(null)
    setWebSearchUsed(false)

    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        // If the API returned updated usage in the error (e.g. limit_reached), update it
        if (data.used !== undefined && data.limit !== undefined) {
          setUsage((u) => ({ ...u, used: data.used, limit: data.limit }))
        }
        return
      }

      setResponse(data.response)
      setWebSearchUsed(data.web_search_used ?? false)
      setSuggestedActions(data.suggested_actions ?? [])
      setAskQueryId(data.ask_query_id ?? null)
      setMatchedObjectiveIds(data.matched_objective_ids ?? [])
      setConfirmedActions(new Set())
      if (data.usage) {
        setUsage((u) => ({
          ...u,
          used: data.usage.used ?? u.used,
          limit: data.usage.limit ?? u.limit,
          tier: data.usage.tier ?? u.tier,
          askCredits: data.usage.ask_credits_remaining ?? u.askCredits,
        }))
      }
      setQuestion('')
    } catch {
      setError('Network error. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmAction(action: string, index: number, objectiveIds: string[]) {
    try {
      await fetch('/api/ask/confirm-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action_text: action, objective_ids: objectiveIds, ask_query_id: askQueryId }),
      })
    } catch {
      // Non-fatal — optimistically mark confirmed regardless
    }
    setConfirmedActions(prev => new Set(prev).add(index))
  }

  return (
    <section
      aria-label="Ask Meridian"
      className="mt-8 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {/* Beacon mark (simplified gold pulse) */}
          <span
            aria-hidden
            className="relative flex h-2.5 w-2.5 items-center justify-center"
          >
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#C9A227] opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#C9A227]" />
          </span>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-900 dark:text-neutral-100">
            Ask Meridian
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <UsagePill usage={usage} />
          {usage.used / Math.max(usage.limit, 1) >= 0.8 && (
            <div className="flex items-center gap-1">
              <a
                href="/settings"
                className="text-xs font-semibold text-[#C9A227] hover:text-[#b89220] transition"
              >
                Reload Credits
              </a>
              <div className="relative group">
                <span className="flex h-3.5 w-3.5 cursor-default items-center justify-center rounded-full border border-neutral-400 dark:border-neutral-500 text-[9px] font-bold text-neutral-400 dark:text-neutral-500 leading-none">
                  ?
                </span>
                <div className="pointer-events-none absolute right-0 top-5 z-10 w-48 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-600 dark:text-neutral-300 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  1 credit = 1 Ask query. Credits never expire.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about your goals, markets, or decisions..."
          disabled={loading || atLimit}
          maxLength={1000}
          className={[
            'min-w-0 flex-1 rounded-lg border bg-neutral-50 dark:bg-neutral-800 px-4 py-2.5 text-sm',
            'text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500',
            'transition focus:outline-none focus:ring-2 focus:ring-[#C9A227]/40 focus:border-[#C9A227]',
            'disabled:cursor-not-allowed disabled:opacity-50',
            'border-neutral-300 dark:border-neutral-600',
          ].join(' ')}
        />
        <button
          type="submit"
          disabled={loading || atLimit || !question.trim()}
          className={[
            'flex shrink-0 items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition',
            'bg-[#C9A227] text-[#0D1B3E] hover:bg-[#b89220]',
            'disabled:cursor-not-allowed disabled:opacity-50',
          ].join(' ')}
        >
          {loading ? (
            <>
              <Spinner />
              Thinking…
            </>
          ) : (
            'Ask'
          )}
        </button>
      </form>

      <div className="flex justify-end mt-1.5">
        <a
          href="/ask/history"
          className="text-xs"
          style={{ color: '#C9A227' }}
        >
          History →
        </a>
      </div>

      {/* Error */}
      {error && !atLimit && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Response */}
      {response && (
        <div className="mt-4 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full bg-[#C9A227]"
            />
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
              Meridian
            </span>
            {webSearchUsed && (
              <span className="ml-auto flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
                <WebIcon />
                Live web data
              </span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
            {response}
          </p>
        </div>
      )}

      {/* Suggested actions */}
      {suggestedActions.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-neutral-400 dark:text-neutral-500">
            Suggested Actions
          </p>
          {suggestedActions.map((action, i) => {
            const objectiveIds = matchedObjectiveIds
            const hasObjective = objectiveIds.length > 0
            return (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-neutral-200 dark:border-neutral-700 px-4 py-3"
              >
                <p className="flex-1 text-sm text-neutral-700 dark:text-neutral-300">{action}</p>
                {confirmedActions.has(i) ? (
                  <span className="shrink-0 text-xs font-semibold text-green-600 dark:text-green-400">
                    Added ✓
                  </span>
                ) : hasObjective ? (
                  <button
                    onClick={() => handleConfirmAction(action, i, objectiveIds)}
                    className="shrink-0 text-xs font-semibold text-[#C9A227] hover:text-[#b89220] transition"
                  >
                    Add to list →
                  </button>
                ) : (
                  <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500 cursor-default">
                    No matching goal
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* At-limit upgrade nudge */}
      {atLimit && (
        <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-800 dark:text-amber-400">
          You&apos;ve used {usage.limit === 1 ? 'your' : `all ${usage.limit}`}{' '}
          Ask {usage.limit === 1 ? 'query' : 'queries'} for this month.{' '}
          {usage.tier === 'explorer' && (
            <a
              href="/settings"
              className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 transition"
            >
              Upgrade to Command for 10/month →
            </a>
          )}
          {usage.tier === 'accelerator' && (
            <a
              href="/settings"
              className="font-semibold underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-300 transition"
            >
              Add sweep credits or upgrade to Command →
            </a>
          )}
        </div>
      )}
    </section>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function UsagePill({ usage }: { usage: UsageState }) {
  const { used, limit, askCredits } = usage
  const overMonthly = used >= limit

  // When monthly queries are exhausted but credits remain, show credits count
  if (overMonthly && askCredits > 0) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs font-medium text-amber-500 dark:text-amber-400"
        aria-label={`${askCredits} ask credits remaining`}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
        {askCredits} {askCredits === 1 ? 'credit' : 'credits'} remaining
      </div>
    )
  }

  const pct = Math.min(used / Math.max(limit, 1), 1)
  const nearLimit = !overMonthly && pct >= 0.67
  const barColor = overMonthly
    ? 'bg-red-400'
    : nearLimit
    ? 'bg-amber-400'
    : 'bg-[#C9A227]'

  return (
    <div
      className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400"
      aria-label={`${used} of ${limit} Ask queries used this month`}
    >
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span>
        {used} of {limit} this month
      </span>
    </div>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0D1B3E]/30 border-t-[#0D1B3E]"
    />
  )
}

function WebIcon() {
  return (
    <svg
      aria-hidden
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
    </svg>
  )
}
