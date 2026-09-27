'use client'

import { useState } from 'react'
import { TrendingUp, TrendingDown, AlertTriangle, Info, Eye } from 'lucide-react'
import type { InferenceBlock } from '@/lib/anthropic/prompts/output'

interface InferencePanelProps {
  inferenceBlock: InferenceBlock
  defaultExpanded?: boolean
}

const FLAG_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  conflict:    { bg: 'rgba(200,90,84,.15)',   color: 'var(--ov-red)',   label: 'Conflict'    },
  dependency:  { bg: 'rgba(201,162,39,.15)',  color: 'var(--ov-amber)', label: 'Dependency'  },
  sequence:    { bg: 'rgba(56,139,206,.15)',  color: 'var(--blue-mid)', label: 'Sequence'    },
  opportunity: { bg: 'rgba(45,187,133,.15)', color: 'var(--ov-green)', label: 'Opportunity' },
}

const CONFIDENCE_COLORS: Record<string, string> = {
  high:   'var(--ov-green)',
  medium: 'var(--ov-amber)',
  low:    'var(--ov-red)',
}

export default function InferencePanel({ inferenceBlock: ib, defaultExpanded = true }: InferencePanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  const hasDecisionGate = ib.decision_gate.exists && ib.decision_gate.description
  const decisionDays = ib.decision_gate.deadline_days
  const gateIsUrgent   = hasDecisionGate && decisionDays !== null && decisionDays <= 14
  const gateIsUpcoming = hasDecisionGate && decisionDays !== null && decisionDays > 14 && decisionDays <= 45

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--ov-border-md)', backgroundColor: 'var(--ov-navy-card)' }}
    >
      {/* Panel header */}
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ borderBottom: expanded ? '1px solid var(--ov-border)' : 'none' }}
      >
        <div className="flex items-center gap-2">
          <Eye size={14} style={{ color: 'var(--gold)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--ov-text-hi)' }}>
            What this Means
          </span>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
          {expanded ? '↑ collapse' : '↓ expand'}
        </span>
      </button>

      {/* Always-visible blind spot (shown even when collapsed) */}
      {ib.user_blind_spot && (
        <div
          className="px-4 py-3"
          style={{
            borderLeft: '3px solid var(--gold)',
            backgroundColor: 'rgba(201,162,39,0.07)',
            borderBottom: expanded ? '1px solid var(--ov-border)' : 'none',
          }}
        >
          <p
            className="text-[9px] font-semibold uppercase tracking-widest mb-1"
            style={{ color: 'var(--gold)' }}
          >
            Meridian Arc Sees This
          </p>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ov-text-hi)' }}>
            {ib.user_blind_spot}
          </p>
        </div>
      )}

      {expanded && (
        <div className="divide-y" style={{ borderColor: 'var(--ov-border)' }}>

          {/* Decision gate */}
          {hasDecisionGate && (
            <div
              className="px-4 py-3 flex gap-3"
              style={{
                backgroundColor: gateIsUrgent
                  ? 'rgba(201,162,39,0.10)'
                  : gateIsUpcoming
                  ? 'rgba(56,139,206,0.08)'
                  : 'transparent',
              }}
            >
              {gateIsUrgent ? (
                <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--ov-amber)' }} />
              ) : (
                <Info size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--blue-mid)' }} />
              )}
              <div>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wide mb-0.5"
                  style={{ color: gateIsUrgent ? 'var(--ov-amber)' : 'var(--blue-mid)' }}
                >
                  Decision gate
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
                  {ib.decision_gate.description}
                </p>
              </div>
            </div>
          )}

          {/* Unstated implications */}
          {ib.unstated_implications.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--ov-text-dim)' }}>
                What signals imply
              </p>
              <ol className="space-y-2">
                {ib.unstated_implications.map((impl, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span
                      className="flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold mt-0.5"
                      style={{ backgroundColor: 'rgba(201,162,39,0.15)', color: 'var(--gold)' }}
                    >
                      {i + 1}
                    </span>
                    <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
                      {impl}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Confidence pivot */}
          {(ib.confidence_pivot.upside_trigger || ib.confidence_pivot.downside_trigger) && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--ov-text-dim)' }}>
                Confidence triggers
              </p>
              <div className="space-y-2">
                {ib.confidence_pivot.upside_trigger && (
                  <div className="flex items-start gap-2">
                    <TrendingUp size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--ov-green)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
                        {ib.confidence_pivot.upside_trigger}
                      </p>
                    </div>
                    {ib.confidence_pivot.upside_delta > 0 && (
                      <span
                        className="text-[11px] font-semibold flex-shrink-0"
                        style={{ color: 'var(--ov-green)' }}
                      >
                        +{ib.confidence_pivot.upside_delta}pts
                      </span>
                    )}
                  </div>
                )}
                {ib.confidence_pivot.downside_trigger && (
                  <div className="flex items-start gap-2">
                    <TrendingDown size={13} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--ov-red)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
                        {ib.confidence_pivot.downside_trigger}
                      </p>
                    </div>
                    {ib.confidence_pivot.downside_delta < 0 && (
                      <span
                        className="text-[11px] font-semibold flex-shrink-0"
                        style={{ color: 'var(--ov-red)' }}
                      >
                        {ib.confidence_pivot.downside_delta}pts
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Cross-objective flags */}
          {ib.cross_objective_flags.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide mb-2" style={{ color: 'var(--ov-text-dim)' }}>
                Goal interactions
              </p>
              <div className="space-y-2">
                {ib.cross_objective_flags.map((flag, i) => {
                  const style = FLAG_COLORS[flag.flag_type] ?? FLAG_COLORS.dependency
                  return (
                    <div
                      key={i}
                      className="rounded-xl p-3"
                      style={{ backgroundColor: style.bg, border: `1px solid ${style.color}33` }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: `${style.color}22`, color: style.color }}
                        >
                          {style.label}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>
                          {flag.related_objective}
                        </span>
                      </div>
                      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>
                        {flag.description}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Absence signal — "The Bottom Line": forward-looking synthesis, most actionable content on this tab */}
          {/* DO NOT string-replace stored AI output — only template variables */}
          {ib.absence_signal.is_meaningful && ib.absence_signal.description && (
            <div className="px-4 py-3">
              <p
                className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
                style={{ color: 'var(--gold)' }}
              >
                The Bottom Line
              </p>
              <p
                className="text-[13px] leading-relaxed font-medium"
                style={{ color: 'var(--ov-text-hi)' }}
              >
                {ib.absence_signal.description}
              </p>
            </div>
          )}

          {/* Inference confidence badge */}
          <div className="px-4 py-2.5 flex items-center justify-end gap-2">
            <span className="text-[10px]" style={{ color: 'var(--ov-text-dim)' }}>
              Inference confidence
            </span>
            <span
              className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: `${CONFIDENCE_COLORS[ib.inference_confidence]}22`,
                color: CONFIDENCE_COLORS[ib.inference_confidence],
              }}
            >
              {ib.inference_confidence}
            </span>
          </div>

        </div>
      )}
    </div>
  )
}
