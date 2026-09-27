'use client'

type Props = { brief: Record<string, unknown> | null; objective: Record<string, unknown> }

export default function StrikeIntelPanel({ brief }: Props) {
  const chips = (brief?.signal_chips ?? []) as Array<{ label: string; value: string; status: string }>
  const statusColor = (s: string) =>
    s === 'ok' ? 'text-green-400' : s === 'critical' ? 'text-red-400' : 'text-amber-400'

  return (
    <div className="p-4">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Signal Chips</div>
      {chips.length === 0 ? (
        <div className="text-slate-500 text-sm">No signal data yet.</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {chips.map((c, i) => (
            <div key={i} className="bg-slate-800 rounded-lg p-3">
              <div className="text-xs text-slate-400">{c.label}</div>
              <div className={`text-sm font-medium mt-0.5 ${statusColor(c.status)}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
