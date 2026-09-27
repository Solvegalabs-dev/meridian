'use client'

import { useState } from 'react'
import type { ObjectiveWithResult, ObjectiveState, LiteTrend, MacroEventLink } from '@/lib/enterprise/objectives-queries'
import { formatPosText } from '@/lib/enterprise/format-pos'

type Props = {
  objective: ObjectiveWithResult
  onStateChange: (objectiveId: string, newState: ObjectiveState) => void
  changingState: boolean
  linkMap?: Map<string, MacroEventLink>
  objTitleMap?: Map<string, string>
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function confidenceTooltip(score: number): string {
  const pct = Math.round(score * 100)
  if (score >= 0.80) return `High confidence (${pct}%) — pattern is well-supported by case data and macro signals. Findings are reliable for decision-making.`
  if (score >= 0.60) return `Moderate confidence (${pct}%) — pattern detected but data volume is limited. Use findings as directional, not definitive.`
  return `Low confidence (${pct}%) — insufficient data to draw strong conclusions. More case history or a re-sweep may improve accuracy.`
}

function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  const cls = score >= 0.75
    ? 'bg-green-900/40 text-green-400'
    : score >= 0.50
    ? 'bg-yellow-900/40 text-yellow-400'
    : 'bg-red-900/30 text-red-400'
  return (
    <span
      className={`text-xs font-bold px-2 py-0.5 rounded-full cursor-help ${cls}`}
      title={confidenceTooltip(score)}
    >
      {pct}%
    </span>
  )
}

function trendBadge(trend: LiteTrend | null) {
  switch (trend) {
    case 'improving':     return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-900/40 text-green-400">▲ Improving</span>
    case 'deteriorating': return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-900/30 text-red-400">▼ Deteriorating</span>
    case 'stable':        return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">→ Stable</span>
    default:              return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-800 text-gray-500">— Unknown</span>
  }
}

function ClampedText({
  text,
  linkMap,
  sectionKey,
  objTitleMap,
}: {
  text: string | null
  linkMap: Map<string, MacroEventLink>
  sectionKey: string
  objTitleMap?: Map<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return <p className="text-sm text-gray-500">—</p>

  return (
    <div>
      <div
        id={`pos-text-${sectionKey}`}
        className={expanded ? '' : 'overflow-hidden [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical]'}
      >
        {formatPosText(text, linkMap, objTitleMap)}
      </div>
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-yellow-600 hover:text-yellow-400 text-xs mt-1.5 hover:underline transition-colors"
        >
          Read more ↓
        </button>
      )}
    </div>
  )
}

function AccordionSection({
  label,
  sectionKey,
  open,
  onToggle,
  objectiveId,
  children,
}: {
  label: string
  sectionKey: string
  open: boolean
  onToggle: () => void
  objectiveId: string
  children: React.ReactNode
}) {
  return (
    <div className="border-t border-gray-800/70">
      <button
        id={`section-${sectionKey}-${objectiveId}`}
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-gray-800/30 transition"
      >
        <span className="text-xs font-semibold text-yellow-500/80 tracking-wide uppercase">{label}</span>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4 pt-1">{children}</div>}
    </div>
  )
}

// ── FOCUS CARD ────────────────────────────────────────────────────────────────

function FocusCard({ objective, onStateChange, changingState, linkMap = new Map(), objTitleMap }: Props) {
  const { latest_result: r } = objective
  const [openSection, setOpenSection] = useState<string | null>('affecting_it')
  const [menuOpen, setMenuOpen] = useState(false)

  const toggleSection = (key: string) =>
    setOpenSection(prev => (prev === key ? null : key))

  const handleAlertClick = () => {
    setOpenSection('what_to_do')
    setTimeout(() => {
      document.getElementById(`section-what-to-do-${objective.id}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-base flex-shrink-0">🎯</span>
          <span className="font-semibold text-sm text-white truncate" style={{ fontFamily: 'EB Garamond, Georgia, serif' }}>
            {objective.title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {objective.escalated_at && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 cursor-help"
              title={`Auto-escalated from Monitoring Lite on ${new Date(objective.escalated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`}
            >
              ESCALATED
            </span>
          )}
          {r && <ConfidenceBadge score={r.confidence_score} />}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(v => !v)}
              className="text-gray-500 hover:text-gray-300 text-lg leading-none px-1 transition"
            >
              ⋯
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-6 z-10 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1 w-48">
                <button
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition"
                  onClick={() => { setMenuOpen(false); onStateChange(objective.id, 'monitoring_lite') }}
                  disabled={changingState}
                  title="Monitoring Lite runs a lighter sweep every 14 days and alerts you if this objective crosses a threshold. Use when the situation is stable and needs periodic watching, not daily attention."
                >
                  Move to Monitoring Lite
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition"
                  onClick={() => { setMenuOpen(false); onStateChange(objective.id, 'paused') }}
                  disabled={changingState}
                  title="Pause this objective — no sweeps will run. The objective and its history are preserved. Reactivate at any time."
                >
                  Pause
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Alert banner */}
      {r?.alert_triggered && (
        <button
          onClick={handleAlertClick}
          className="w-full mb-3 px-4 py-2.5 bg-amber-900/20 border-y border-amber-700/40 flex items-center justify-between gap-2 hover:bg-amber-900/30 transition text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-amber-400 text-sm flex-shrink-0">⚠</span>
            <span className="text-xs font-semibold text-amber-400 leading-relaxed">
              {r.alert_reason ?? 'Alert — this objective crossed its monitoring threshold. Review the findings below.'}
            </span>
          </div>
          <span className="text-xs text-amber-600 flex-shrink-0 whitespace-nowrap ml-2">→ See recommended actions</span>
        </button>
      )}

      {/* Empty state */}
      {!r && (
        <div className="px-4 pb-4 text-sm text-gray-500">
          <p className="mb-1 text-gray-400 text-xs">{objective.statement}</p>
          <p className="text-xs text-gray-600">No sweep data yet — run a portfolio sweep to generate intelligence for this objective.</p>
        </div>
      )}

      {/* POS sections */}
      {r && (
        <>
          <AccordionSection label="What is affecting it" sectionKey="affecting_it" objectiveId={objective.id}
            open={openSection === 'affecting_it'} onToggle={() => toggleSection('affecting_it')}>
            <ClampedText text={r.affecting_it} linkMap={linkMap} sectionKey={`affecting_it-${objective.id}`} objTitleMap={objTitleMap} />
          </AccordionSection>
          <AccordionSection label="What this implies" sectionKey="implies" objectiveId={objective.id}
            open={openSection === 'implies'} onToggle={() => toggleSection('implies')}>
            <ClampedText text={r.implies} linkMap={linkMap} sectionKey={`implies-${objective.id}`} objTitleMap={objTitleMap} />
          </AccordionSection>
          <AccordionSection label="Signals" sectionKey="signals" objectiveId={objective.id}
            open={openSection === 'signals'} onToggle={() => toggleSection('signals')}>
            <ClampedText text={r.signals} linkMap={linkMap} sectionKey={`signals-${objective.id}`} objTitleMap={objTitleMap} />
          </AccordionSection>
          <AccordionSection label="What to do" sectionKey="what_to_do" objectiveId={objective.id}
            open={openSection === 'what_to_do'} onToggle={() => toggleSection('what_to_do')}>
            <ClampedText text={r.what_to_do} linkMap={linkMap} sectionKey={`what_to_do-${objective.id}`} objTitleMap={objTitleMap} />
          </AccordionSection>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-800 flex items-center justify-between">
            <span className="text-xs text-gray-600">Last sweep {timeAgo(r.computed_at)}</span>
            <div className="flex gap-2">
              <button
                onClick={() => onStateChange(objective.id, 'monitoring_lite')}
                disabled={changingState}
                title="Monitoring Lite runs a lighter sweep every 14 days and alerts you if this objective crosses a threshold. Use when the situation is stable and needs periodic watching, not daily attention."
                className="text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition disabled:opacity-40"
              >
                Move to Monitoring Lite
              </button>
              <button
                onClick={() => onStateChange(objective.id, 'paused')}
                disabled={changingState}
                title="Pause this objective — no sweeps will run. The objective and its history are preserved. Reactivate at any time."
                className="text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-600 transition disabled:opacity-40"
              >
                Pause
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── MONITORING LITE CARD ──────────────────────────────────────────────────────

function LiteCard({ objective, onStateChange, changingState }: Props) {
  const { latest_result: r } = objective

  const nextSweep = (() => {
    const base = objective.last_lite_sweep_at ?? objective.last_focus_sweep_at
    if (!base || !objective.lite_sweep_cadence_days) return 'Not scheduled'
    const next = new Date(new Date(base).getTime() + objective.lite_sweep_cadence_days * 86400000)
    return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  })()

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base flex-shrink-0">📡</span>
          <span className="font-semibold text-sm text-white truncate" style={{ fontFamily: 'EB Garamond, Georgia, serif' }}>
            {objective.title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {r && trendBadge(r.lite_trend ?? null)}
          <span className="text-xs text-gray-600">{timeAgo(r?.computed_at ?? null)}</span>
        </div>
      </div>

      {r ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              { label: r.lite_metric_1_label, value: r.lite_metric_1_value },
              { label: r.lite_metric_2_label, value: r.lite_metric_2_value },
            ].map((m, i) => (
              <div key={i} className="bg-gray-800/60 rounded-lg px-3 py-2">
                <div className="text-xs text-gray-500 mb-1">{m.label ?? 'Metric'}</div>
                <div className="text-base font-bold text-white">{m.value ?? '—'}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 leading-relaxed mb-1">
            {r.lite_summary ?? 'No summary available — run a sweep to generate.'}
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-600 mb-3">No sweep data yet — run a portfolio sweep to generate intelligence for this objective.</p>
      )}

      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-gray-700">Next lite sweep: {nextSweep}</span>
        <div className="flex gap-2">
          <button
            onClick={() => onStateChange(objective.id, 'focus')}
            disabled={changingState}
            title="Move back to full focus — this objective will be included in the next full portfolio sweep."
            className="text-xs px-3 py-1 rounded-lg border border-yellow-800/50 text-yellow-600 hover:text-yellow-400 hover:border-yellow-700 transition disabled:opacity-40"
          >
            Escalate to Focus
          </button>
          <button
            onClick={() => onStateChange(objective.id, 'paused')}
            disabled={changingState}
            title="Pause this objective — no sweeps will run. The objective and its history are preserved. Reactivate at any time."
            className="text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 transition disabled:opacity-40"
          >
            Pause
          </button>
        </div>
      </div>
    </div>
  )
}

// ── PAUSED CARD ───────────────────────────────────────────────────────────────

function PausedCard({ objective, onStateChange, changingState }: Props) {
  return (
    <div className="bg-gray-900/40 border border-gray-800/50 rounded-xl p-3 flex items-center justify-between opacity-60">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm">⏸</span>
        <span className="text-sm text-gray-500 truncate" style={{ fontFamily: 'EB Garamond, Georgia, serif' }}>
          {objective.title}
        </span>
      </div>
      <button
        onClick={() => onStateChange(objective.id, 'focus')}
        disabled={changingState}
        title="Reactivate this objective and move it back to full focus — it will be included in the next portfolio sweep."
        className="flex-shrink-0 text-xs px-3 py-1 rounded-lg border border-gray-700 text-gray-500 hover:text-gray-300 transition disabled:opacity-40 ml-3"
      >
        Reactivate → Focus
      </button>
    </div>
  )
}

// ── MAIN EXPORT ───────────────────────────────────────────────────────────────

export function ObjectiveCard(props: Props) {
  switch (props.objective.objective_state) {
    case 'focus':           return <FocusCard {...props} />
    case 'monitoring_lite': return <LiteCard {...props} />
    case 'paused':          return <PausedCard {...props} />
  }
}
