'use client'

import { useState, useEffect } from 'react'
import { X, Check, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type OutcomeType = 'HIT' | 'PARTIAL' | 'MISS'
type ConfidenceRetro = 'realistic' | 'overconfident' | 'underconfident'
type Screen = 'outcome' | 'retrospective' | 'predictions' | 'ancestor'

interface ActivePred {
  id: string
  statement: string
  confidence_pct: number
}

interface Props {
  objectiveId: string
  objectiveTitle: string
  objectiveCategory: string
  objectiveContext: Record<string, unknown>
  currentConfidence: number | null
  onClose: () => void
  onComplete: () => void
}

function outcomeColor(t: OutcomeType) {
  if (t === 'HIT') return 'var(--ov-green)'
  if (t === 'PARTIAL') return 'var(--ov-amber)'
  return 'var(--ov-red)'
}

const RETRO_OPTIONS: { value: ConfidenceRetro; label: string; sub: string }[] = [
  { value: 'realistic',      label: 'Realistic',      sub: 'My starting confidence matched how it played out' },
  { value: 'overconfident',  label: 'Overconfident',  sub: 'I was more sure than I should have been' },
  { value: 'underconfident', label: 'Underconfident', sub: 'I undersold how likely this was' },
]

export default function CloseModal({
  objectiveId,
  objectiveTitle,
  objectiveCategory,
  objectiveContext,
  currentConfidence,
  onClose,
  onComplete,
}: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [screen, setScreen] = useState<Screen>('outcome')
  const [outcomeType, setOutcomeType] = useState<OutcomeType | null>(null)
  const [outcomeNote, setOutcomeNote] = useState('')
  const [actualCompletedAt, setActualCompletedAt] = useState(new Date().toISOString().split('T')[0])
  const [confidenceRetro, setConfidenceRetro] = useState<ConfidenceRetro | null>(null)
  const [activePreds, setActivePreds] = useState<ActivePred[]>([])
  const [predScores, setPredScores] = useState<Record<string, OutcomeType>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('predictions')
      .select('id, statement, confidence_pct')
      .eq('objective_id', objectiveId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setActivePreds(data ?? [])
      })
  }, [objectiveId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitClose(): Promise<string | null> {
    setSaving(true)
    setError(null)

    const predictionScores = Object.entries(predScores).map(([prediction_id, outcome]) => ({
      prediction_id,
      outcome: outcome.toLowerCase(),
    }))

    try {
      const res = await fetch(`/api/objectives/${objectiveId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outcome_type: outcomeType!.toLowerCase(),
          outcome_note: outcomeNote.trim() || null,
          actual_completed_at: actualCompletedAt,
          confidence_retrospective: confidenceRetro,
          prediction_scores: predictionScores,
        }),
      })

      if (!res.ok) {
        const d = await res.json() as { error?: string }
        setError(d.error ?? 'Save failed — please try again.')
        setSaving(false)
        return null
      }

      const { outcome_id } = await res.json() as { outcome_id: string }
      setSaving(false)
      return outcome_id
    } catch {
      setError('Network error — please try again.')
      setSaving(false)
      return null
    }
  }

  function goNext() {
    if (screen === 'outcome') {
      if (!outcomeType || !actualCompletedAt) return
      setScreen('retrospective')
    } else if (screen === 'retrospective') {
      if (!confidenceRetro) return
      // Pre-populate prediction scores with Screen 1 outcome
      if (activePreds.length > 0) {
        const defaults: Record<string, OutcomeType> = {}
        activePreds.forEach(p => { defaults[p.id] = outcomeType! })
        setPredScores(defaults)
        setScreen('predictions')
      } else {
        setScreen('ancestor')
      }
    } else if (screen === 'predictions') {
      setScreen('ancestor')
    }
  }

  async function handleNoAncestor() {
    const id = await submitClose()
    if (id) onComplete()
  }

  async function handleYesAncestor() {
    const id = await submitClose()
    if (!id) return

    const preTitle = encodeURIComponent(objectiveTitle)
    const preContext = encodeURIComponent(JSON.stringify(objectiveContext))
    router.push(
      `/objectives/new?parent_objective_id=${objectiveId}&pre_title=${preTitle}&pre_category=${encodeURIComponent(objectiveCategory)}&pre_context=${preContext}&outcome_id=${id}`
    )
  }

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
      gap: '20px',
    },
    label: { fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.05em', color: 'var(--ov-text-dim)' },
    cardBtn: (active: boolean, color?: string) => ({
      width: '100%',
      padding: '12px 14px',
      borderRadius: '10px',
      textAlign: 'left' as const,
      border: `1px solid ${active ? (color ?? 'var(--ov-blue)') : 'var(--ov-border-md)'}`,
      backgroundColor: active ? `${color ?? 'var(--ov-blue)'}18` : 'transparent',
      cursor: 'pointer',
      transition: 'all .15s',
    }),
  }

  const stepLabels: Record<Screen, string> = {
    outcome: '1 of 4 — Outcome',
    retrospective: '2 of 4 — Confidence review',
    predictions: '3 of 4 — Predictions',
    ancestor: '4 of 4 — Next chapter',
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={screen === 'ancestor' ? undefined : onClose} />
      <div style={s.card}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p style={{ fontSize: '11px', color: 'var(--ov-text-dim)' }}>{stepLabels[screen]}</p>
            <h2 style={{ fontSize: '17px', fontWeight: 600, color: 'var(--ov-text-hi)', marginTop: '2px' }}>Close Goal</h2>
          </div>
          {screen !== 'ancestor' && (
            <button onClick={onClose} style={{ color: 'var(--ov-text-dim)', padding: '4px' }}>
              <X size={18} />
            </button>
          )}
        </div>
        <p style={{ fontSize: '13px', color: 'var(--ov-text-mid)', marginTop: '-12px' }}>{objectiveTitle}</p>

        {/* ── Screen 1: Outcome ── */}
        {screen === 'outcome' && (
          <>
            <div>
              <p style={s.label}>Outcome <span style={{ color: 'var(--ov-red)' }}>*</span></p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                {(['HIT', 'PARTIAL', 'MISS'] as OutcomeType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setOutcomeType(t)}
                    style={{
                      flex: 1, padding: '10px 4px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                      border: `1px solid ${outcomeType === t ? outcomeColor(t) : 'var(--ov-border-md)'}`,
                      backgroundColor: outcomeType === t ? `${outcomeColor(t)}20` : 'transparent',
                      color: outcomeType === t ? outcomeColor(t) : 'var(--ov-text-dim)',
                      cursor: 'pointer', transition: 'all .15s',
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p style={{ ...s.label, marginBottom: '6px' }}>What happened? <span style={{ color: 'var(--ov-text-dim)', textTransform: 'none', fontWeight: 400 }}>(optional)</span></p>
              <textarea
                rows={3}
                value={outcomeNote}
                onChange={e => setOutcomeNote(e.target.value.slice(0, 500))}
                placeholder="What happened?"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', resize: 'none',
                  backgroundColor: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <p style={{ ...s.label, marginBottom: '6px' }}>Completion date <span style={{ color: 'var(--ov-red)' }}>*</span></p>
              <input
                type="date"
                value={actualCompletedAt}
                onChange={e => setActualCompletedAt(e.target.value)}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: '8px', fontSize: '13px',
                  backgroundColor: 'var(--ov-navy)', border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-hi)',
                  outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              onClick={goNext}
              disabled={!outcomeType || !actualCompletedAt}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                background: 'var(--gold)', color: '#0a1628', cursor: 'pointer', opacity: (!outcomeType || !actualCompletedAt) ? 0.4 : 1,
              }}
            >
              Next <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
            </button>
          </>
        )}

        {/* ── Screen 2: Confidence Retrospective ── */}
        {screen === 'retrospective' && (
          <>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ov-text-hi)' }}>
                Looking back, was your starting confidence realistic?
              </p>
              {currentConfidence !== null && (
                <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', marginTop: '4px' }}>
                  Filed at: unknown · Current confidence: {currentConfidence}%
                </p>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {RETRO_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setConfidenceRetro(opt.value)}
                  style={s.cardBtn(confidenceRetro === opt.value)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ov-text-hi)' }}>{opt.label}</span>
                    {confidenceRetro === opt.value && <Check size={14} style={{ color: 'var(--ov-blue)' }} />}
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', marginTop: '2px' }}>{opt.sub}</p>
                </button>
              ))}
            </div>

            <button
              onClick={goNext}
              disabled={!confidenceRetro}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                background: 'var(--gold)', color: '#0a1628', cursor: 'pointer', opacity: !confidenceRetro ? 0.4 : 1,
              }}
            >
              Next <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
            </button>
          </>
        )}

        {/* ── Screen 3: Predictions ── */}
        {screen === 'predictions' && (
          <>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ov-text-hi)' }}>Score your predictions</p>
              <p style={{ fontSize: '12px', color: 'var(--ov-text-dim)', marginTop: '4px' }}>
                {activePreds.length} active prediction{activePreds.length !== 1 ? 's' : ''} — pre-filled from your outcome
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {activePreds.map(pred => {
                const score = predScores[pred.id] ?? null
                return (
                  <div
                    key={pred.id}
                    style={{
                      padding: '12px', borderRadius: '10px',
                      border: '1px solid var(--ov-border-md)', backgroundColor: 'var(--ov-navy)',
                    }}
                  >
                    <p style={{ fontSize: '13px', color: 'var(--ov-text-hi)', marginBottom: '4px' }}>
                      {pred.statement.length > 80 ? `${pred.statement.slice(0, 80)}…` : pred.statement}
                    </p>
                    <p style={{ fontSize: '11px', color: 'var(--ov-text-dim)', marginBottom: '8px' }}>
                      {pred.confidence_pct}% confidence
                    </p>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {(['HIT', 'PARTIAL', 'MISS'] as OutcomeType[]).map(t => (
                        <button
                          key={t}
                          onClick={() => setPredScores(prev => ({ ...prev, [pred.id]: t }))}
                          style={{
                            flex: 1, padding: '6px 4px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                            border: `1px solid ${score === t ? outcomeColor(t) : 'var(--ov-border-md)'}`,
                            backgroundColor: score === t ? `${outcomeColor(t)}20` : 'transparent',
                            color: score === t ? outcomeColor(t) : 'var(--ov-text-dim)',
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

            <button
              onClick={goNext}
              style={{
                width: '100%', padding: '12px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                background: 'var(--gold)', color: '#0a1628', cursor: 'pointer',
              }}
            >
              Next <ChevronRight size={14} style={{ display: 'inline', verticalAlign: 'middle' }} />
            </button>
          </>
        )}

        {/* ── Screen 4: Ancestor Chain ── */}
        {screen === 'ancestor' && (
          <>
            <div>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ov-text-hi)' }}>
                Did completing this goal open a new one?
              </p>
              <p style={{ fontSize: '13px', color: 'var(--ov-text-dim)', marginTop: '6px' }}>
                Some goals are stepping stones. If closing this one revealed or unlocked a next chapter, we can start it now.
              </p>
            </div>

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: '8px', backgroundColor: 'rgba(200,90,84,.12)', color: '#C85A54', fontSize: '12px' }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={handleYesAncestor}
                disabled={saving}
                style={{
                  width: '100%', padding: '14px', borderRadius: '10px', fontSize: '14px', fontWeight: 500,
                  background: 'var(--gold)', color: '#0a1628', cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : 'Yes — start the next goal'}
              </button>
              <button
                onClick={handleNoAncestor}
                disabled={saving}
                style={{
                  width: '100%', padding: '14px', borderRadius: '10px', fontSize: '14px',
                  border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)',
                  backgroundColor: 'transparent', cursor: 'pointer', opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving...' : 'No — just close it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
