// components/enterprise/RetireModal.tsx
// FF-050: 2-screen retire flow for enterprise objectives.
// Screen 1: reason (required) + notes (optional)
// Screen 2: final sweep toggle (default ON for focus objectives) + confirm

'use client'

import { useState } from 'react'

const RETIRE_REASONS = [
  { value: 'objective_achieved', label: 'Objective achieved — outcome delivered' },
  { value: 'market_shifted', label: 'Market conditions shifted — objective no longer relevant' },
  { value: 'strategy_change', label: 'Strategy change — superseded by a new objective' },
  { value: 'data_constraints', label: 'Data constraints — not enough signal to track' },
  { value: 'client_request', label: 'Client requested retirement' },
  { value: 'other', label: 'Other' },
]

interface RetireModalProps {
  objectiveId: string
  objectiveTitle: string
  objectiveState: 'focus' | 'monitoring_lite' | 'paused'
  institutionId: string
  onConfirm: (params: {
    lifecycle_reason: string
    lifecycle_notes: string | null
    run_final_sweep: boolean
  }) => Promise<void>
  onClose: () => void
}

type Screen = 1 | 2

export function RetireModal({
  objectiveTitle,
  objectiveState,
  onConfirm,
  onClose,
}: RetireModalProps) {
  const [screen, setScreen] = useState<Screen>(1)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [runFinalSweep, setRunFinalSweep] = useState(objectiveState === 'focus')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleNext = () => {
    if (!reason) return
    setScreen(2)
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm({
        lifecycle_reason: reason,
        lifecycle_notes: notes.trim() || null,
        run_final_sweep: runFinalSweep,
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <div className="font-semibold text-white">Retire Objective</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate max-w-xs">{objectiveTitle}</div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-500 hover:text-gray-300 text-xl leading-none disabled:opacity-40"
          >
            ×
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-5 pt-4 flex items-center gap-2">
          {([1, 2] as Screen[]).map(s => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  screen >= s
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-800 text-gray-500'
                }`}
              >
                {s}
              </div>
              {s < 2 && <div className="w-8 h-px bg-gray-800" />}
            </div>
          ))}
          <span className="ml-2 text-xs text-gray-500">
            {screen === 1 ? 'Reason' : 'Confirm'}
          </span>
        </div>

        {/* Screen 1 — Reason + Notes */}
        {screen === 1 && (
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Why is this objective being retired? <span className="text-red-500">*</span>
              </label>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600 transition-colors"
              >
                <option value="">Select a reason…</option>
                {RETIRE_REASONS.map(r => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Notes <span className="text-gray-600">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="What was the outcome? Any context for the record…"
                rows={3}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-emerald-600 transition-colors resize-none"
              />
            </div>

            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={onClose}
                className="text-sm px-4 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                disabled={!reason}
                className="text-sm px-4 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white font-semibold transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Screen 2 — Final sweep toggle + Confirm */}
        {screen === 2 && (
          <div className="px-5 py-4 space-y-5">
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Retiring</div>
              <div className="text-sm text-gray-200 font-medium">{objectiveTitle}</div>
              <div className="text-xs text-gray-500 mt-1">
                Reason: {RETIRE_REASONS.find(r => r.value === reason)?.label ?? reason}
              </div>
              {notes && (
                <div className="text-xs text-gray-600 mt-1 italic">{notes}</div>
              )}
            </div>

            {/* Final sweep toggle */}
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={runFinalSweep}
                onChange={e => setRunFinalSweep(e.target.checked)}
                className="mt-0.5 accent-emerald-500 flex-shrink-0"
              />
              <div>
                <div className="text-sm font-medium text-gray-200">
                  Run final sweep before retiring
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {objectiveState === 'focus'
                    ? 'Recommended — captures last intelligence snapshot for this focus objective.'
                    : 'Optional for monitoring-lite objectives.'}
                </div>
              </div>
            </label>

            {runFinalSweep && (
              <div className="text-xs text-amber-500/80 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                Final sweep will run before retirement is committed. This may take 30–60 seconds.
              </div>
            )}

            {error && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button
                onClick={() => setScreen(1)}
                disabled={submitting}
                className="text-sm px-4 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-200 transition disabled:opacity-40"
              >
                ← Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={submitting}
                className="text-sm px-5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold transition"
              >
                {submitting
                  ? runFinalSweep
                    ? 'Running sweep…'
                    : 'Retiring…'
                  : 'Confirm Retirement'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
