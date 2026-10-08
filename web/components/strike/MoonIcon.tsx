// The moon as a picture (FF-099 Part 3): a dark disc with the lit part drawn from percent illuminated and the
// waxing or waning flag. Waxing lights the right side, waning the left, as seen from the northern hemisphere.

// Pure, so the shape can be tested without rendering. The lit region is the right half-limb plus the terminator,
// an ellipse of width r*|1-2f|: a crescent curves back the way it came (sweep 0), a gibbous bulges past the
// middle (sweep 1). New moon draws nothing lit, full moon the whole disc.
export function moonIconGeometry(percent: number, waxing: boolean, r = 18, c = 20): {
  kind: 'new' | 'full' | 'partial'
  d: string
  mirrored: boolean
  rx: number
  sweep: 0 | 1
} {
  const f = Math.min(1, Math.max(0, percent / 100))
  const mirrored = !waxing
  if (f < 0.01) return { kind: 'new', d: '', mirrored, rx: r, sweep: 0 }
  if (f > 0.99) return { kind: 'full', d: '', mirrored, rx: 0, sweep: 1 }
  const rx = Number((r * Math.abs(1 - 2 * f)).toFixed(2))
  const sweep: 0 | 1 = f < 0.5 ? 0 : 1
  const top = c - r
  const bottom = c + r
  return { kind: 'partial', d: `M${c},${top} A${r},${r} 0 0 1 ${c},${bottom} A${rx},${r} 0 0 ${sweep} ${c},${top} Z`, mirrored, rx, sweep }
}

export default function MoonIcon({ percent, waxing, size = 40 }: { percent: number; waxing: boolean; size?: number }) {
  const g = moonIconGeometry(percent, waxing)
  const label = `Moon, ${Math.round(percent)}% lit, ${waxing ? 'waxing' : 'waning'}`
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={label} className="shrink-0">
      <circle cx="20" cy="20" r="18" fill="#1e293b" stroke="#64748b" strokeWidth="1" />
      {g.kind === 'full' && <circle cx="20" cy="20" r="18" fill="#e2e8f0" />}
      {g.kind === 'partial' && (
        <path d={g.d} fill="#e2e8f0" transform={g.mirrored ? 'translate(40,0) scale(-1,1)' : undefined} />
      )}
    </svg>
  )
}
