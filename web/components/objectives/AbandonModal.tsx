'use client'

import { useState, useEffect } from 'react'
import { X, AlertTriangle, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type AbandonReason =
  | 'circumstances_changed'
  | 'lost_interest'
  | 'achieved_informally'
  | 'blocked_external'
  | 'replaced_by_new'
  | 'other'

type AbandonPermanent = 'permanent' | 'may_return'
type Screen = 'caution' | 'context' | 'predictions'
type PredOutcome = 'MISS' | 'PARTIAL'

interface ActivePred {
  id: string
  statement: string
  confidence_pct: number
}

interface ContextStats {
  confidence: number | null
  predCount: number
  daysSinceCreated: number
}

interface Props {
  objectiveId: string
  objectiveTitle: string
  activeChildObjectives: Array<{ id: string; title: string }>
  onClose: () => void
  onAbandon: () => void
  onArchiveInstead: () => void
}

const REASONS: { value: AbandonReason; label: string }[] = [
  { value: 'circumstances_changed', label: 'Circumstances changed' },
  { value: 'lost_interest',         label: 'Lost interest' },
  { value: 'achieved_informally',   label: 'Achieved informally' },
  { value: 'blocked_external',      label: 'Blocked by something outside my control' },
  { value: 'replaced_by_new',       label: 'Replaced by a new objective' },
  { value: 'other',                 label: 'Other' },
]

export default function AbandonModal({
  objectiveId,
  objectiveTitle,
  activeChildObjectives,
  onClose,
  onAbandon,
  onArchiveInstead,
}: Props) {
  const supabase = createClient()

  const [screen, setScreen] = useState<Screen>('caution')
  const [stats, setStats] = useState<ContextStats | null>(null)
  const [childAction, setChildAction] = useState<'archive_all' | 'leave_active' | null>(null)
  const [reason, setReason] = useState<AbandonReason | null>(null)
  const [permanent, setPermanent] = useState<AbandonPermanent | null>(null)
  const [note, setNote] = useState('')
  const [activePreds, setActivePreds] = useState<ActivePred[]>([])
  const [predScores, setPredScores] = useState<Record<string, PredOutcome>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadStats() {
      const [objRes, predsRes] = await Promise.all([
        supabase.from('objectives').select('confidence, created_at').eq('id', objectiveId).single(),
        supabase.from('predictions').select('id, statement, confidence_pct').eq('objective_id', objectiveId).eq('status', 'active'),
      ])

      const obj = objRes.data
      const preds = (predsRes.data ?? []) as ActivePred[]
      setActivePreds(preds)

      // Pre-score predictions: MISS by default
      const defaults: Record<string, PredOutcome> = {}
      preds.forEach((p: ActivePred) => { defaults[p.id] = 'MISS' })
      setPredScores(defaults)

      const daysSince = obj?.created_at
        ? Math.floor((Date.now() - new Date(obj.created_at).getTime()) / 86400000)
        : 0

      setStats({
        confidence: obj?.confidence ?? null,
        predCount: preds.length,
        daysSinceCreated: daysSince,
      })
    }
    loadStats()
  }, [objectiveId]) // eslint-disable-line react-hooks/exhaustive-deps

  // When reason changes to achieved_informally, flip defaults to PARTIAL
  useEffect(() => {
    if (activePreds.length === 0) return
    const score: PredOutcome = reason === 'achieved_informally' ? 'PARTIAL' : 'MISS'
    const updated: Record<string, PredOutcome> = {}
    activePreds.forEach(p => { updated[p.id] = score })
    setPredScores(updated)
  }, [reason]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    setSaving(true)
    setError(null)

    const predictionScores = Object.entries(predScores).map(([prediction_id, outcome]) => ({
      prediction_id,
      outcome: outcome.toLowerCase(),
    }))

    try {
      const res = await fetch(`/api/objectives/${objectiveId}/abandon`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          abandonment_reason: reason,
          abandonment_permanent: permanent === 'permanent',
          abandonment_note: note.trim() || null,
          child_action: childAction,
          prediction_scores: predictionScores,
        }),
      })

      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Save failed — please try again.')
        setSaving(false)
        return
      }

      onAbandon()
    } catch {
      setError('Network error — please try again.')
      setSaving(false)
    }
  }

  const screenOk2 = reason !== null && permanent !== null

  const s = {
    card: {
      position: 'relative' as const,
      width: '100%',
      maxWidth: '420px',
      borderRadius: '16px',
      padding: '24px',
      backgroundColor: 'var(--ov-navy-card)',
      border: '1px solid var(--ov-border-md)',
      maxHeight: '90vh',
      overflowY: 'auto' as const,
      display: 'flex',
      flexDirection: 'column' as const,
      gap: '18px',
    },
    label: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ov-text-dim)' },
    cardBtn: (active: boolean) => ({
      width: '100%',
      padding: '11px 14px',
      borderRadius: '10px',
      textAlign: 'left' as const,
      border: `1px solid ${active ? 'var(--ov-amber)' : 'var(--ov-border-md)'}`,
      backgroundColor: active ? 'rgba(201,162,39,.12)' : 'transparent',
      cursor: 'pointer',
      transition: 'all .15s',
    }),
  }

  const stepLabels: Record<Screen, string> = {
    caution:     '1 of 3 — Confirm',
    context:     '2 of 3 — Context',
    predictions: '3 of 3 — Predictions',
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={screen === 'context' || screen === 'predictions' ? undefined : onClose} />
      <div style={s.card}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: '11px', color: 'var(--ov-text-dim)' }}>{stepLabels[screen]}</p>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: '#C85A54', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <AlertTriangle size={16} /> Abandon Goal
            </h2>
          </div>
          <button onClick={onClose} style={{ color: 'var(--ov-text-dim)', padding: '4px' }}>
            <X size={18} />
          </button>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--ov-text-mid)', marginTop: '-10px' }}>{objectiveTitle}</p>

        <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', lineHeight: '1.5', marginTop: '-8px' }}>
          Abandon is for goals that fizzled — lost interest, no real movement, or never got traction. If you reached a conscious decision about this goal — even if you&apos;re not completing it — use Close Goal instead.
        </p>

        {/* ── Screen 1: Caution Gate ── */}
        {screen === 'caution' && (
          <>
            <div style={{ padding: '14px', borderRadius: '10px', backgroundColor: 'rgba(200,90,84,.08)', border: '1px solid rgba(200,90,84,.25)' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: '#C85A54', marginBottom: '10px' }}>
                This permanently closes the goal.
              </p>
              {stats ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {stats.confidence !== null && (
                    <p style={{ fontSize: '12px', color: 'var(--ov-text-mid)' }}>Current confidence: {stats.confidence}%</p>
                  )}
                  <p style={{ fontSize: '12px', color: 'var(--ov-text-mid)' }}>Active predictions: {stats.predCount}</p>
                  <p style={{ fontSize: '12px', color: 'var(--ov-text-mid)' }}>Days tracked: {stats.daysSinceCreated}</p>
                </div>
              ) : (
                <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)' }}>Loading...</p>
              )}
            </div>

            {activeChildObjectives.length > 0 && (
              <div>
                <p style={{ fontSize: '13px', color: 'var(--ov-text-hi)', marginBottom: '8px' }}>
                  This goal has {activeChildObjectives.length} related goal{activeChildObjectives.length > 1 ? 's' : ''}:
                </p>
                <ul style={{ listStyle: 'none', padding: 0, marginBottom: '10px' }}>
                  {activeChildObjectives.map(c => (
                    <li key={c.id} style={{ fontSize: '12px', color: 'var(--ov-text-mid)', padding: '3px 0', borderBottom: '1px solid var(--ov-border)' }}>
                      {c.title}
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', marginBottom: '8px' }}>What should happen to them?</p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['archive_all', 'leave_active'] as const).map(opt => (
                    <button
                      key={opt}
                      onClick={() => setChildAction(opt)}
                      style={{
                        flex: 1, padding: '8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                        border: `1px solid ${childAction === opt ? 'var(--ov-amber)' : 'var(--ov-border-md)'}`,
                        backgroundColor: childAction === opt ? 'rgba(201,162,39,.12)' : 'transparent',
                        color: childAction === opt ? 'var(--ov-amber)' : 'var(--ov-text-dim)',
                        cursor: 'pointer',
                      }}
                    >
                      {opt === 'archive_all' ? 'Archive All' : 'Leave Active'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setScreen('context')}
              disabled={activeChildObjectives.length > 0 && childAction === null}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                backgroundColor: '#C85A54', color: '#fff', cursor: 'pointer',
                opacity: (activeChildObjectives.length > 0 && childAction === null) ? 0.4 : 1,
              }}
            >
              Yes, I want to abandon this
            </button>
            <button
              onClick={onArchiveInstead}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px',
                border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)',
                backgroundColor: 'transparent', cursor: 'pointer', marginTop: '-8px',
              }}
            >
              Pause instead
            </button>
          </>
        )}

        {/* ── Screen 2: Abandonment Context ── */}
        {screen === 'context' && (
          <>
            <div>
              <p style={{ ...s.label, marginBottom: '8px' }}>Why are you abandoning this? <span style={{ color: 'var(--ov-red)' }}>*</span></p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {REASONS.map(r => (
                  <button key={r.value} onClick={() => setReason(r.value)} style={s.cardBtn(reason === r.value)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '13px', color: 'var(--ov-text-hi)' }}>{r.label}</span>
                      {reason === r.value && <Check size={13} style={{ color: 'var(--ov-amber)' }} />}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p style={{ ...s.label, marginBottom: '8px' }}>Is this permanent? <span style={{ color: 'var(--ov-red)' }}>*</span></p>
              <div style={{ display: 'flex', gap: '8px' }}>
                {([
                  { value: 'permanent' as AbandonPermanent, label: 'Yes, permanently closed' },
                  { value: 'may_return' as AbandonPermanent, label: 'No, I might return' },
                ]).map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setPermanent(opt.value)}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, textAlign: 'left' as const,
                      border: `1px solid ${permanent === opt.value ? 'var(--ov-amber)' : 'var(--ov-border-md)'}`,
                      backgroundColor: permanent === opt.value ? 'rgba(201,162,39,.12)' : 'transparent',
                      color: permanent === opt.value ? 'var(--ov-amber)' : 'var(--ov-text-dim)',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p style={{ ...s.label, marginBottom: '6px' }}>Anything Meridian should know? <span style={{ fontWeight: 400, textTransform: 'none', color: 'var(--ov-text-dim)' }}>(optional)</span></p>
              <textarea
                rows={3}
                value={note}
                onChange={e => setNote(e.target.value.slice(0, 500))}
                placeholder="Anything Meridian should know?"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', resize: 'none',
                  backgroundColor: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              onClick={() => {
                if (activePreds.length > 0) {
                  setScreen('predictions')
                } else {
                  handleSubmit()
                }
              }}
              disabled={!screenOk2 || saving}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                background: 'var(--gold)', color: '#0a1628', cursor: 'pointer', opacity: (!screenOk2 || saving) ? 0.4 : 1,
              }}
            >
              {saving ? 'Saving...' : activePreds.length > 0 ? 'Next' : 'Confirm & Abandon'}
            </button>
          </>
        )}

        {/* ── Screen 3: Prediction Disposition ── */}
        {screen === 'predictions' && (
          <>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ov-text-hi)' }}>Score your predictions</p>
              <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', marginTop: '4px' }}>
                Pre-scored as {reason === 'achieved_informally' ? 'PARTIAL' : 'MISS'} — override as needed
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activePreds.map(pred => {
                const score = predScores[pred.id] ?? 'MISS'
                return (
                  <div
                    key={pred.id}
                    style={{ padding: '12px', borderRadius: '10px', border: '1px solid var(--ov-border-md)', backgroundColor: 'var(--ov-navy)' }}
                  >
                    <p style={{ fontSize: '13px', color: 'var(--ov-text-hi)', marginBottom: '4px' }}>
                      {pred.statement.length > 80 ? `${pred.statement.slice(0, 80)}…` : pred.statement}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--ov-text-dim)', marginBottom: '8px' }}>
                      {pred.confidence_pct}% confidence
                    </p>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['MISS', 'PARTIAL'] as PredOutcome[]).map(t => (
                        <button
                          key={t}
                          onClick={() => setPredScores(prev => ({ ...prev, [pred.id]: t }))}
                          style={{
                            flex: 1, padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                            border: `1px solid ${score === t ? (t === 'PARTIAL' ? 'var(--ov-amber)' : 'var(--ov-red)') : 'var(--ov-border-md)'}`,
                            backgroundColor: score === t ? `${t === 'PARTIAL' ? 'var(--ov-amber)' : 'var(--ov-red)'}20` : 'transparent',
                            color: score === t ? (t === 'PARTIAL' ? 'var(--ov-amber)' : 'var(--ov-red)') : 'var(--ov-text-dim)',
                            cursor: 'pointer', transition: 'all .15s',
                          }}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(200,90,84,.12)', color: '#C85A54', fontSize: '12px' }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={saving}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                backgroundColor: '#C85A54', color: '#fff', cursor: 'pointer', opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Confirm & Abandon'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
