'use client'

// Real signal chips (FF-099 Part 4), used on the Brief tab and the Intel tab. Tap a chip to see when the reading
// was taken, in the viewer's own timezone. Opaque colors only; 44px targets.
import { useState } from 'react'
import MoonIcon from './MoonIcon'

export type ChipView = {
  label: string
  value: string
  status?: string
  recorded_at?: string
  moon?: { percent: number; waxing: boolean }
}

function readingTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Chips from an old payload (no recorded_at) still render, without the tap detail.
export function parseChips(raw: unknown): ChipView[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is ChipView => !!c && typeof c === 'object' && typeof (c as ChipView).label === 'string' && typeof (c as ChipView).value === 'string')
}

function Chip({ chip }: { chip: ChipView }) {
  const [open, setOpen] = useState(false)
  const time = chip.recorded_at ? readingTime(chip.recorded_at) : ''
  return (
    <button
      type="button"
      onClick={() => time && setOpen(o => !o)}
      aria-expanded={time ? open : undefined}
      className="bg-slate-800 rounded-lg px-3 py-2 min-h-[44px] text-left flex items-center gap-2"
    >
      {chip.moon && <MoonIcon percent={chip.moon.percent} waxing={chip.moon.waxing} size={40} />}
      <span className="min-w-0">
        <span className="block text-xs text-slate-300">{chip.label}</span>
        <span className="block text-sm font-medium text-white">{chip.value}</span>
        {open && time && <span className="block text-xs text-slate-300">Reading taken {time}</span>}
      </span>
    </button>
  )
}

export default function SignalChipRow({ chips }: { chips: ChipView[] }) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => <Chip key={c.label} chip={c} />)}
    </div>
  )
}
