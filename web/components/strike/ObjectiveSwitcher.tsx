'use client'

// Compact "Switch objective" control in the objective header (FF-106 Stage 2 Part C). Lists the
// user's other non-removed Strike objectives, ordered by focus group then soonest trip start
// (same order GET /api/strike/objectives already returns). Lazy: nothing is fetched until the
// control is opened, so the page itself loads no slower.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { WINDOW_CHIP_TONE, type WindowChip } from '@/lib/strike/windowStatus'

type SwitcherObjective = { id: string; title: string; chip: WindowChip | null; group: string; tripStart: string | null }

type LoadState = 'idle' | 'loading' | 'error' | { objectives: SwitcherObjective[] }

export default function ObjectiveSwitcher({ currentId }: { currentId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState>('idle')

  async function toggle() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (state !== 'idle' && state !== 'error') return
    setState('loading')
    try {
      const res = await fetch('/api/strike/objectives')
      if (!res.ok) { setState('error'); return }
      const body = await res.json() as { objectives: SwitcherObjective[] }
      setState({ objectives: body.objectives })
    } catch {
      setState('error')
    }
  }

  // Nothing to switch to: the control disappears rather than opening onto an empty list.
  if (typeof state === 'object' && state.objectives.length <= 1) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="min-h-[44px] px-2 flex items-center gap-1 text-sm text-slate-200 hover:text-white transition-colors"
      >
        Switch objective <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <div role="menu" className="absolute left-0 top-full z-20 w-64 max-h-80 overflow-y-auto rounded-lg bg-slate-800 border border-slate-600 shadow-lg">
          {state === 'loading' && <div className="px-4 py-3 text-sm text-slate-300">Loading…</div>}
          {state === 'error' && <div className="px-4 py-3 text-sm text-red-300">Could not load objectives.</div>}
          {typeof state === 'object' && state.objectives.map(o => (
            <button
              key={o.id}
              type="button"
              role="menuitem"
              onClick={() => { if (o.id !== currentId) router.push(`/strike/${o.id}`); setOpen(false) }}
              aria-current={o.id === currentId ? 'true' : undefined}
              className={`w-full min-h-[44px] px-4 flex items-center justify-between gap-2 text-left text-sm transition-colors hover:bg-slate-700 ${
                o.id === currentId ? 'text-white font-medium' : 'text-slate-100'
              }`}
            >
              <span className="truncate">{o.id === currentId ? '✓ ' : ''}{o.title}</span>
              {o.chip && (
                <span
                  className="flex-shrink-0 text-xs font-medium px-2 py-1 rounded"
                  style={{ backgroundColor: WINDOW_CHIP_TONE[o.chip.tone].bg, color: WINDOW_CHIP_TONE[o.chip.tone].color }}
                >
                  {o.chip.label}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
