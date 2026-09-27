'use client'

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import type { ScoredPrediction } from '@/lib/predictions/trackRecord'

interface Props {
  predictions: ScoredPrediction[]
}

const OUTCOME_COLOR = {
  HIT: '#0F6E56',
  PARTIAL: '#BA7517',
  MISS: '#A32D2D',
  OPEN: '#9CA3AF',
} as const

interface ChartDot {
  x: number
  y: number
  status: keyof typeof OUTCOME_COLOR
  label: string
  horizon: string
}

interface TooltipPayload {
  payload: ChartDot
}

export function ConfidenceAccuracyChart({ predictions }: Props) {
  if (predictions.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-[13px] text-[var(--text3)]">
        No predictions filed yet
      </div>
    )
  }

  // oldest first for left-to-right timeline
  const chartData: ChartDot[] = predictions
    .slice()
    .reverse()
    .map((p, i) => ({
      x: i + 1,
      y: p.filed_confidence,
      status: p.outcome_type,
      label: p.objective_title ?? p.statement.slice(0, 48) + (p.statement.length > 48 ? '…' : ''),
      horizon: new Date(p.horizon_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }))

  return (
    <div className="mb-6">
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-[13px] font-medium text-[var(--text2)]">Confidence vs Outcome</span>
        <span className="text-[11px] text-[var(--text3)]">Each dot = one prediction · Color = outcome</span>
      </div>

      <div className="flex gap-4 mb-3">
        {(Object.entries(OUTCOME_COLOR) as [keyof typeof OUTCOME_COLOR, string][]).map(([outcome, color]) => (
          <div key={outcome} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
            <span className="text-[11px] text-[var(--text3)]">{outcome}</span>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E0DA" />
          <XAxis
            dataKey="x"
            type="number"
            name="Prediction #"
            tick={{ fontSize: 10, fill: '#8098B4' }}
            tickLine={false}
            label={{ value: 'Predictions (oldest → newest)', position: 'insideBottom', offset: -12, fontSize: 10, fill: '#8098B4' }}
          />
          <YAxis
            dataKey="y"
            type="number"
            name="Filed Confidence"
            domain={[0, 100]}
            tick={{ fontSize: 10, fill: '#8098B4' }}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = (payload[0] as TooltipPayload).payload
              return (
                <div className="bg-white border border-[var(--border)] rounded-xl p-3 shadow text-[11px] max-w-[200px]">
                  <div className="font-medium text-[var(--text)] mb-1 leading-snug">{d.label}</div>
                  <div className="text-[var(--text3)]">Confidence: {d.y}%</div>
                  <div className="text-[var(--text3)]">Horizon: {d.horizon}</div>
                  <div className="font-semibold mt-1" style={{ color: OUTCOME_COLOR[d.status] }}>
                    {d.status}
                  </div>
                </div>
              )
            }}
          />
          <Scatter data={chartData}>
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={OUTCOME_COLOR[entry.status]} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}
