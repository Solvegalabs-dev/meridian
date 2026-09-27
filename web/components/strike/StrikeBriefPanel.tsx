'use client'

import StrikeMapStrip from './StrikeMapStrip'
import StrikeFooter from './StrikeFooter'

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
  onRefresh: () => void
}

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

export default function StrikeBriefPanel({ brief, isOnline, onRefresh }: Props) {
  // time_windows === null means no brief row found (stub). time_windows === [] means
  // brief exists but movement_windows not yet populated — show content, not full pending.
  if (!brief || brief.time_windows === null) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm">
        <div className="mb-1">Intelligence sweep pending</div>
        <div className="text-xs text-slate-500">Check back after the next scheduled run</div>
      </div>
    )
  }

  const time_windows = brief.time_windows ?? []
  const map_pins     = brief.map_pins ?? []
  const sources      = brief.sources ?? []
  const { lead_signal, summary } = brief

  return (
    <div className="px-4 py-4 space-y-5">
      {/* Map strip */}
      <StrikeMapStrip pins={map_pins} isOnline={isOnline} />

      {/* TIME WINDOWS — rendered first */}
      <section>
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">
          Time windows
        </div>
        {time_windows.length === 0 ? (
          <div className="bg-slate-800/60 rounded-lg px-4 py-3 text-slate-400 text-sm">
            Brief generating — check back shortly
          </div>
        ) : (
          <div className="space-y-2">
            {time_windows.map((w, i) => (
              <div key={i} className="flex items-start gap-3 bg-slate-800/60 rounded-lg p-3">
                {/* Priority rail */}
                <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${PRIORITY_RAIL[w.priority]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white text-sm font-medium">{w.window}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs font-bold ${PRIORITY_TEXT[w.priority]}`}>
                        {w.priority.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-400">
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

      {/* LEAD SIGNAL — callout above summary */}
      {lead_signal && (
        <section>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Lead signal</div>
          <div className="bg-blue-900/40 border border-blue-700/60 rounded-lg px-4 py-3">
            <div className="text-blue-200 text-sm font-medium">{lead_signal}</div>
          </div>
        </section>
      )}

      {/* SUMMARY */}
      {summary && (
        <section>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Strike summary</div>
          <div className="bg-slate-800/60 rounded-lg px-4 py-3">
            <div className="text-slate-200 text-sm leading-relaxed">{summary}</div>
          </div>
        </section>
      )}

      {/* SOURCES */}
      {sources.length > 0 && (
        <section>
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Sources</div>
          <div className="flex flex-wrap gap-2">
            {sources.map((s, i) => (
              <span
                key={i}
                className="text-xs bg-slate-700 text-slate-300 rounded px-2 py-0.5"
              >
                {s}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* FOOTER */}
      <StrikeFooter brief={brief as unknown as Record<string, unknown>} onRefresh={onRefresh} />
    </div>
  )
}
