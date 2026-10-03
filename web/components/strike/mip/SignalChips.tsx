'use client'

type Chip = { label: string; value: string; status: 'ok' | 'warn' | 'critical' }

const STATUS_COLOR: Record<Chip['status'], string> = {
  ok: '#16A34A',
  warn: '#D97706',
  critical: '#DC2626',
}

export default function SignalChips({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null

  return (
    <div className="flex gap-2 overflow-x-auto px-4 py-1" style={{ scrollbarWidth: 'none' }}>
      {chips.map((chip, i) => (
        <div
          key={`${chip.label}-${i}`}
          className="shrink-0 rounded-lg px-3 py-2"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderLeft: `3px solid ${STATUS_COLOR[chip.status]}` }}
        >
          <div className="text-[11px] uppercase tracking-wide whitespace-nowrap" style={{ color: 'var(--ov-text-mid)' }}>
            {chip.label}
          </div>
          <div className="text-sm font-semibold text-white whitespace-nowrap">{chip.value}</div>
        </div>
      ))}
    </div>
  )
}
