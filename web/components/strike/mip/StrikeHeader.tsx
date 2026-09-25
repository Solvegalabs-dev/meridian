'use client'

const TIER_STYLE: Record<number, { label: string; bg: string }> = {
  1: { label: 'T1', bg: '#16A34A' }, // green
  2: { label: 'T2', bg: '#CA8A04' }, // yellow
  3: { label: 'T3', bg: '#EA580C' }, // orange
  4: { label: 'T4', bg: '#DC2626' }, // red
}

type Props = {
  objectiveTitle: string
  confidenceTier: number
  confidencePct: number
  briefGeneratedAt: string
}

export default function StrikeHeader({ objectiveTitle, confidenceTier, confidencePct, briefGeneratedAt }: Props) {
  const tier = TIER_STYLE[confidenceTier] ?? TIER_STYLE[4]
  const date = new Date(briefGeneratedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ov-text-mid)' }}>
          Strike Brief · {date}
        </div>
        <h1 className="text-xl font-semibold text-white truncate">{objectiveTitle}</h1>
      </div>
      <span
        className="shrink-0 flex flex-col items-center justify-center rounded-lg px-3 py-1.5 text-white"
        style={{ backgroundColor: tier.bg }}
      >
        <span className="text-sm font-bold leading-none">{tier.label}</span>
        <span className="text-[10px] leading-none mt-0.5">{confidencePct}%</span>
      </span>
    </div>
  )
}
