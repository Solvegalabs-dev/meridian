'use client'

import type { TrackRecordSummary } from '@/lib/predictions/trackRecord'

interface Props {
  summary: TrackRecordSummary
}

const TREND_LABEL = {
  improving: { text: '↑ Improving', color: 'var(--green)' },
  declining: { text: '↓ Declining', color: '#A32D2D' },
  stable: { text: '→ Stable', color: 'var(--text3)' },
  insufficient_data: { text: '—', color: 'var(--text3)' },
} as const

export function TrackRecordSummaryBar({ summary }: Props) {
  const hitPct = summary.total_scored > 0
    ? Math.round(summary.hit_rate * 100)
    : null

  const trend = TREND_LABEL[summary.accuracy_trend]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
        <div className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wider mb-1">Scored</div>
        <div className="text-[24px] font-semibold text-[var(--text)]">{summary.total_scored}</div>
        <div className="text-[11px] text-[var(--text3)]">{summary.total_open} open</div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
        <div className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wider mb-1">Hit Rate</div>
        <div className="text-[24px] font-semibold text-[var(--text)]">
          {hitPct !== null ? `${hitPct}%` : '—'}
        </div>
        <div className="text-[11px] text-[var(--text3)]">
          {summary.hit_count}H · {summary.partial_count}P · {summary.miss_count}M
        </div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
        <div className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wider mb-1">Avg Confidence Filed</div>
        <div className="text-[24px] font-semibold text-[var(--text)]">
          {summary.avg_filed_confidence > 0 ? `${Math.round(summary.avg_filed_confidence)}%` : '—'}
        </div>
        <div className="text-[11px] text-[var(--text3)]">at time of prediction</div>
      </div>

      <div className="bg-white border border-[var(--border)] rounded-xl p-4">
        <div className="text-[10px] font-semibold text-[var(--text3)] uppercase tracking-wider mb-1">Accuracy Trend</div>
        <div className="text-[24px] font-semibold" style={{ color: trend.color }}>{trend.text}</div>
        <div className="text-[11px] text-[var(--text3)]">recent vs prior scored</div>
      </div>
    </div>
  )
}
