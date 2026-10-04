'use client'

type Window = { window: string; action: string; priority: 'high' | 'medium' | 'low' }

const PRIORITY_STYLE: Record<Window['priority'], { text: string; weight: string; dot: string }> = {
  high:   { text: 'text-white',                     weight: 'font-semibold', dot: '#16A34A' },
  medium: { text: 'text-white',                     weight: 'font-normal',   dot: '#D97706' },
  low:    { text: '',                                weight: 'font-normal',   dot: 'rgba(255,255,255,0.3)' },
}

export default function TimeWindows({ windows }: { windows: Window[] }) {
  if (windows.length === 0) return null

  return (
    <div className="px-4 flex flex-col gap-3">
      {windows.map((w, i) => {
        const style = PRIORITY_STYLE[w.priority]
        return (
          <div key={i} className="flex items-start gap-3">
            <span className="mt-1.5 h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: style.dot }} />
            <div className="min-w-0">
              <div
                className={`text-sm ${style.weight} ${style.text}`}
                style={w.priority === 'low' ? { color: 'var(--ov-text-dim)' } : undefined}
              >
                {w.window}
              </div>
              <div
                className={`text-sm ${w.priority === 'low' ? '' : 'text-white/80'}`}
                style={w.priority === 'low' ? { color: 'var(--ov-text-dim)' } : undefined}
              >
                {w.action}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
