'use client'
import { useState } from 'react'
import { closeCaseAction } from '@/app/(app)/enterprise/actions'

const CLOSE_OUTCOME_LABELS: Record<string, string> = {
  sold:       'Sold',
  off_market: 'Off Market',
  relist:     'Relist',
  other:      'Other',
}

interface Props {
  caseRef: string
  caseDisplay: string
  institutionId: string
  onClose: () => void
  onConfirm: (outcome: string) => void
}

export function CloseCaseModal({ caseRef, caseDisplay, institutionId, onClose, onConfirm }: Props) {
  const [outcome, setOutcome] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleConfirm() {
    if (!outcome) return
    setSaving(true)
    const result = await closeCaseAction(
      caseRef,
      institutionId,
      outcome as 'sold' | 'off_market' | 'relist' | 'other',
      note.trim() || null
    )
    if (result.ok) onConfirm(outcome)
    setSaving(false)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        backgroundColor: '#111827', borderRadius: 12, padding: 28,
        width: 420, color: '#f9fafb',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>Close Case</span>
          <button onClick={onClose} style={{ color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>{caseDisplay}</div>

        <div style={{ marginBottom: 12, fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>
          OUTCOME <span style={{ color: '#ef4444' }}>*</span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          {Object.entries(CLOSE_OUTCOME_LABELS).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setOutcome(value)}
              style={{
                flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid',
                borderColor: outcome === value ? '#10b981' : '#374151',
                backgroundColor: outcome === value ? '#10b981' : 'transparent',
                color: outcome === value ? '#ffffff' : '#d1d5db',
                cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 12, fontSize: 12, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 1 }}>
          NOTES (optional)
        </div>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What happened?"
          rows={3}
          style={{
            width: '100%', backgroundColor: '#1f2937', border: '1px solid #374151',
            borderRadius: 8, padding: 10, color: '#111111', fontSize: 14,
            marginBottom: 20, resize: 'none', boxSizing: 'border-box',
          }}
        />

        <button
          onClick={handleConfirm}
          disabled={!outcome || saving}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 8,
            backgroundColor: !outcome || saving ? '#374151' : '#10b981',
            color: '#ffffff', fontSize: 15, fontWeight: 600,
            border: 'none', cursor: !outcome || saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Closing…' : 'Confirm Close'}
        </button>
      </div>
    </div>
  )
}
