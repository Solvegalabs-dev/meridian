'use client'

type Props = {
  objective: Record<string, unknown>
  brief: Record<string, unknown> | null
  isOnline: boolean
}

export default function StrikeHeader({ objective, brief, isOnline }: Props) {
  const taxonomyKey = objective.taxonomy_key as string ?? ''
  const tierStr = brief?.confidence_tier as string ?? 'T4'
  const tierColors: Record<string, string> = {
    T1: 'bg-green-600', T2: 'bg-blue-600', T3: 'bg-amber-600', T4: 'bg-slate-600',
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
      <div>
        <div className="text-xs text-slate-400 uppercase tracking-wider">Strike Brief</div>
        <div className="text-white font-semibold">{taxonomyKey.replace(/\./g, ' · ')}</div>
      </div>
      <div className="flex items-center gap-2">
        {!isOnline && <span className="text-xs text-amber-400">Offline</span>}
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${tierColors[tierStr] ?? tierColors.T4} text-white`}>
          {tierStr}
        </span>
      </div>
    </div>
  )
}
