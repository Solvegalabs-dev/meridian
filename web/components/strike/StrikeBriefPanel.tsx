'use client'

import StrikeMapStrip from './StrikeMapStrip'
import StrikeFooter from './StrikeFooter'
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { verdictStyle } from '@/lib/strike/verdictStyles'
import { isStaleBrief, staleBriefNote, updatedLabel } from '@/lib/strike/briefFreshness'
import type { BriefRefreshResult } from '@/lib/strike/briefRefresh'
import { PRESEASON_CAPTION } from '@/lib/strike/windowStatus'
import type { WindowState } from '@/lib/objectives/windowState'
import { formatDateOnly } from '@/lib/utils/dateOnly'
import { ZERO_EVIDENCE_BANNER } from '@/lib/strikeBrief/evidence'
import { NO_DATA_PROMPT } from '@/lib/strike/sweepStatus'
import type { ReactNode } from 'react'

type TimeWindow = {
  window: string
  action: string
  probability: number
  priority: 'high' | 'medium' | 'low'
  confidence_tier: string
}

type MapPin = { type: string; lat: number; lon: number; confidence: string; label: string }

type StrikeBrief = {
  summary?: string | null
  lead_signal?: string | null
  go_no_go?: string | null
  brief_date?: string | null
  brief_generated_at?: string | null
  confidence_tier?: string | null
  confidence_pct?: number | null
  time_windows?: TimeWindow[] | null
  signal_chips?: unknown[] | null
  map_pins?: MapPin[] | null
  sources?: string[] | null
  attribution?: string | null
}

type Props = {
  brief: StrikeBrief | null
  isOnline: boolean
  onRefresh: () => Promise<BriefRefreshResult>
  windowState?: WindowState | null
  // Trip start date (YYYY-MM-DD) for an upcoming hunt, used in the pending copy.
  tripStart?: string | null
  // True when the objective has no location (FF-095 Part 3). The pending text then says how to fix that.
  noLocation?: boolean
  onGoToPrep?: () => void
  // FF-098: the Run Sweep prompt. emptyPrompt is shown when there is no brief.
  // stalePrompt shows above a brief when the sweep data is old. Both include the Run Sweep button.
  emptyPrompt?: ReactNode
  stalePrompt?: ReactNode
}

// Opaque backgrounds only (no /60 alpha). Label text is slate-300 (passes 4.5:1 on slate-800).
const CARD = 'bg-slate-800 rounded-lg px-4 py-3'
const LABEL = 'text-xs text-slate-300 uppercase tracking-wider mb-2'

const PRIORITY_RAIL: Record<string, string> = {
  high:   'bg-red-500',
  medium: 'bg-amber-500',
  low:    'bg-green-500',
}

const PRIORITY_TEXT: Record<string, string> = {
  high:   'text-red-400',
  medium: 'text-amber-400',
  low:    'text-green-400',
}

export default function StrikeBriefPanel({ brief, isOnline, onRefresh, windowState, tripStart, noLocation, onGoToPrep, emptyPrompt, stalePrompt }: Props) {
  // time_windows === null means no brief row found (stub). time_windows === [] means
  // brief exists but movement_windows not yet populated: show content, not full pending.
  if (!brief || brief.time_windows === null) {
    return (
      <div className="px-4 py-6 space-y-2 text-sm">
        {noLocation ? (
          <>
            <div className="text-slate-200 font-medium">Add a hunt spot on the Prep tab to start your brief</div>
            {onGoToPrep && (
              <button
                type="button"
                onClick={onGoToPrep}
                className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Go to Prep
              </button>
            )}
          </>
        ) : (
          // The user runs sweeps; nothing scheduled writes this brief for them (FF-098).
          emptyPrompt ?? <div className="text-slate-100">{NO_DATA_PROMPT}</div>
        )}
        {windowState === 'upcoming' && tripStart && (
          <div className="text-slate-300">
            Briefs start when your trip window opens ({formatDateOnly(tripStart)}).
          </div>
        )}
      </div>
    )
  }

  const time_windows = brief.time_windows ?? []
  const map_pins     = brief.map_pins ?? []
  const sources      = brief.sources ?? []
  const { lead_signal, summary } = brief
  const closed = isClosedBrief(brief)
  const verdict = verdictStyle(brief.go_no_go)
  const generatedAt = brief.brief_generated_at ?? null
  const now = new Date()
  const huntActive = windowState === 'active'
  const isPreseason = windowState === 'upcoming' || windowState === 'season_not_open'
  const stale = !closed && generatedAt !== null && isStaleBrief(generatedAt, now, huntActive)

  return (
    <div className="px-4 py-4 space-y-5">
      {/* A brief written with no evidence says so in its first line; the prompt gives the one tap that fixes it. */}
      {brief.summary?.includes(ZERO_EVIDENCE_BANNER) ? emptyPrompt : stalePrompt}

      {/* VERDICT: first thing on the tab. A closed hunt shows its message in the page notice, not a pill. */}
      {verdict && !closed && (
        <section className="space-y-2">
          <span
            className="inline-block text-2xl font-bold leading-none px-3 py-2 rounded-lg"
            style={{ backgroundColor: verdict.bg, color: verdict.color }}
          >
            {verdict.label}
          </span>
          {!closed && isPreseason && <div className="text-sm text-slate-200">{PRESEASON_CAPTION}</div>}
          {!closed && generatedAt && <div className="text-sm text-slate-300">{updatedLabel(generatedAt)}</div>}
          {stale && generatedAt && (
            <div className="rounded-lg px-4 py-3 text-sm font-medium" style={{ backgroundColor: '#451a03', color: '#fde68a' }}>
              {staleBriefNote(generatedAt, now)}
            </div>
          )}
        </section>
      )}

      {/* LEAD SIGNAL */}
      {lead_signal && !closed && (
        <section>
          <div className={LABEL}>Lead signal</div>
          <div className="bg-blue-900 border border-blue-700 rounded-lg px-4 py-3">
            <div className="text-blue-100 text-sm font-medium">{lead_signal}</div>
          </div>
        </section>
      )}

      {/* TIME WINDOWS. Hidden on a closed hunt: it has none, and the page notice says so. */}
      {!closed && (
      <section>
        <div className={LABEL}>Time windows</div>
        {time_windows.length === 0 ? (
          <div className={`${CARD} text-slate-300 text-sm`}>Brief generating: check back shortly</div>
        ) : (
          <div className="space-y-2">
            {time_windows.map((w, i) => (
              <div key={i} className="flex items-start gap-3 bg-slate-800 rounded-lg p-3">
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${PRIORITY_RAIL[w.priority]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-sm font-medium">{w.window}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-bold ${PRIORITY_TEXT[w.priority]}`}>
                        {w.priority.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-300">
                        {Math.round(w.probability * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="text-slate-300 text-sm mt-0.5">{w.action}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* SUMMARY */}
      {summary && (
        <section>
          <div className={LABEL}>Strike summary</div>
          <div className={CARD}>
            <div className="text-slate-100 text-sm leading-relaxed whitespace-pre-line">{summary}</div>
          </div>
        </section>
      )}

      {/* SOURCES */}
      {sources.length > 0 && (
        <section>
          <div className={LABEL}>Sources</div>
          <div className="flex flex-wrap gap-2">
            {sources.map((s, i) => (
              <span key={i} className="text-xs bg-slate-700 text-slate-200 rounded px-2 py-1">
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      <StrikeMapStrip pins={map_pins} isOnline={isOnline} />

      {/* FOOTER */}
      <StrikeFooter brief={brief as unknown as Record<string, unknown>} onRefresh={onRefresh} showRefresh={!closed} />
    </div>
  )
}
