'use client'

import { useState, useRef, useEffect } from 'react'

interface ObjectiveSummary {
  obj_id: string
  title: string
  status: string | null
  confidence: number | null
  success_condition: string | null
  target_date: string | null
  outcome: string | null
  goal_description: string | null
}

// ── ObjectivePopover ──────────────────────────────────────────────────────────
// Wraps an OBJ-# tag in the predictions list. Clicking it fetches and shows a
// compact summary popover for the linked objective.

interface ObjectivePopoverProps {
  objectiveId: string
  objId: string
}

export function ObjectivePopover({ objectiveId, objId }: ObjectivePopoverProps) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState<ObjectiveSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  async function handleOpen() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (summary) return
    setLoading(true)
    try {
      const res = await fetch(`/api/objectives/${objectiveId}/summary`)
      if (res.ok) {
        const data = await res.json() as { objective: ObjectiveSummary }
        setSummary(data.objective)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={handleOpen}
        className="text-[11px] font-mono hover:underline"
        style={{ color: 'var(--text3)' }}
      >
        {objId}
      </button>
      {open && (
        <div
          className="absolute left-0 top-6 z-50 w-72 rounded-xl shadow-lg p-4 text-[12px] leading-relaxed"
          style={{ backgroundColor: '#fff', border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          {loading ? (
            <p className="text-[var(--text3)]">Loading…</p>
          ) : summary ? (
            <>
              <p className="font-semibold text-[var(--text)] mb-1">{summary.title}</p>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--gray-lt)', color: 'var(--text3)' }}
                >
                  {summary.status ?? 'active'}
                </span>
                {summary.confidence !== null && (
                  <span className="text-[11px]" style={{ color: 'var(--text3)' }}>
                    {summary.confidence}% confidence
                  </span>
                )}
              </div>
              {summary.success_condition && (
                <p className="text-[11px] mb-2" style={{ color: 'var(--text2)' }}>
                  <span className="font-medium">Success: </span>{summary.success_condition}
                </p>
              )}
              {summary.target_date && (
                <p className="text-[11px]" style={{ color: 'var(--text3)' }}>
                  Target:{' '}
                  {new Date(summary.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              )}
              <a
                href={`/objectives/${objectiveId}`}
                className="inline-block mt-2 text-[11px] font-medium"
                style={{ color: 'var(--blue)' }}
              >
                View objective →
              </a>
            </>
          ) : (
            <p className="text-[var(--text3)]">Could not load summary.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── ObjectiveSummaryInline ────────────────────────────────────────────────────
// Shown below the objective select in the New Prediction form when an objective
// is selected. Renders a compact one-line summary without a popover.

interface ObjectiveSummaryInlineProps {
  objectiveId: string
}

export function ObjectiveSummaryInline({ objectiveId }: ObjectiveSummaryInlineProps) {
  const [summary, setSummary] = useState<ObjectiveSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const prevId = useRef<string>('')

  useEffect(() => {
    if (!objectiveId || objectiveId === prevId.current) return
    prevId.current = objectiveId
    setSummary(null)
    setLoading(true)
    fetch(`/api/objectives/${objectiveId}/summary`)
      .then(r => r.ok ? r.json() as Promise<{ objective: ObjectiveSummary }> : null)
      .then(d => { if (d) setSummary(d.objective) })
      .finally(() => setLoading(false))
  }, [objectiveId])

  if (loading) return <p className="text-[11px] text-[var(--text3)] mt-1">Loading…</p>
  if (!summary) return null

  return (
    <div
      className="mt-1.5 px-3 py-2 rounded-lg text-[11px]"
      style={{ backgroundColor: 'var(--gray-lt)', color: 'var(--text2)', border: '1px solid var(--border)' }}
    >
      <span className="font-medium">{summary.obj_id}</span>
      {' · '}
      <span>{summary.title}</span>
      {summary.confidence !== null && (
        <span style={{ color: 'var(--text3)' }}>{' · '}{summary.confidence}% confidence</span>
      )}
    </div>
  )
}
