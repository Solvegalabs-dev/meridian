// components/enterprise/DropModal.tsx
// FF-050: 2-screen drop flow for enterprise objectives.
// Drop = objective abandoned/cancelled — no final sweep.
// Screen 1: caution gate + reason
// Screen 2: final confirmation

'use client'

import { useState } from 'react'

const DROP_REASONS = [
  { value: 'no_longer_relevant', label: 'No longer relevant to portfolio strategy' },
  { value: 'duplicate_objective', label: 'Covered by another objective' },
  { value: 'insufficient_data', label: 'Insufficient data to run — cannot track' },
  { value: 'client_request', label: 'Client requested removal' },
  { value: 'incorrect_setup', label: 'Objective was set up incorrectly' },
  { value: 'other', label: 'Other' },
]

interface DropModalProps {
  objectiveId: string
  objectiveTitle: string
  institutionId: string
  onConfirm: (params: {
    lifecycle_reason: string
    lifecycle_notes: string | null
  }) => Promise<void>
  onClose: () => void
}

type Screen = 1 | 2

export function DropModal({
  objectiveTitle,
  onConfirm,
  onClose,
}: DropModalProps) {
  const [screen, setScreen] = useState<Screen>(1)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
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
        <div className="px-5 py-4 border-b border-orange-900/40 flex items-center justify-between"
          style={{ background: 'rgba(249,115,22,0.06)' }}>
          <div>
            <div className="font-semibold text-orange-300">Drop Objective</div>
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
                    ? 'bg-orange-700 text-white'
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

        {/* Screen 1 — Caution gate + Reason + Notes */}
        {screen === 1 && (
          <div className="px-5 py-4 space-y-4">
            {/* Caution callout */}
            <div className="bg-orange-900/20 border border-orange-700/40 rounded-xl px-4 py-3">
              <div className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-1">
                Before you drop
              </div>
              <p className="text-xs text-gray-400 leading-relaxed">
                Dropping an objective removes it from active monitoring and sweep targeting.
                No final sweep will run. You can reactivate it later from the History tab
                if needed.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wide">
                Why is this objective being dropped? <span className="text-red-500">*</span>
              </label>
              <select
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-600 transition-colors"
              >
                <option value="">Select a reason…</option>
                {DROP_REASONS.map(r => (
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
                placeholder="Any context for the record…"
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none focus:border-orange-600 transition-colors resize-none"
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
                className="text-sm px-4 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-40 text-white font-semibold transition"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* Screen 2 — Final confirmation */}
        {screen === 2 && (
          <div className="px-5 py-4 space-y-4">
            <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-4">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1">Dropping</div>
              <div className="text-sm text-gray-200 font-medium">{objectiveTitle}</div>
              <div className="text-xs text-gray-500 mt-1">
                Reason: {DROP_REASONS.find(r => r.value === reason)?.label ?? reason}
              </div>
              {notes && (
                <div className="text-xs text-gray-600 mt-1 italic">{notes}</div>
              )}
            </div>

            <div className="bg-gray-800/40 rounded-xl px-4 py-3 text-xs text-gray-500">
              No final sweep will run. The objective will be removed from active monitoring
              immediately and can be found in the History tab.
            </div>

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
                className="text-sm px-5 py-1.5 rounded-lg bg-orange-700 hover:bg-orange-600 disabled:opacity-50 text-white font-semibold transition"
              >
                {submitting ? 'Dropping…' : 'Drop Objective'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
