'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, TrendingUp, X, AlertTriangle, MessageSquare } from 'lucide-react'
import { TrackRecordSummaryBar } from '@/components/predictions/TrackRecordSummaryBar'
import { ConfidenceAccuracyChart } from '@/components/predictions/ConfidenceAccuracyChart'
import { PredictionHistoryList } from '@/components/predictions/PredictionHistoryList'
import type { TrackRecordSummary, ScoredPrediction } from '@/lib/predictions/trackRecord'
import { ObjectivePopover, ObjectiveSummaryInline } from '@/components/predictions/ObjectivePopover'

interface PredictionScore {
  accuracy_score: number
  actual_outcome: string
  scored_at: string
}

interface Prediction {
  id: string
  pred_id: string | null
  statement: string
  confidence_pct: number
  horizon_date: string
  status: string | null
  outcome: string | null
  accuracy_score: number | null
  scored_at: string | null
  notes: string | null
  objective_id: string | null
  objectives?: { obj_id: string; title: string } | null
  prediction_scores?: PredictionScore[] | null
}

interface Props {
  initialPredictions: Prediction[]
  objectives: { id: string; obj_id: string; title: string }[]
  trackRecord: { summary: TrackRecordSummary; predictions: ScoredPrediction[] }
}

function getStatus(p: Prediction): 'open' | 'due' | 'scored' {
  if (p.status === 'scored' || (p.prediction_scores?.length ?? 0) > 0) return 'scored'
  if (p.accuracy_score !== null) return 'scored'
  if (new Date(p.horizon_date) <= new Date()) return 'due'
  return 'open'
}

function getEngine4Score(p: Prediction): number | null {
  return p.prediction_scores?.[0]?.accuracy_score ?? null
}

function accuracyColor(score: number): string {
  if (score >= 70) return 'var(--gold)'
  if (score >= 50) return '#D97706' // amber
  return '#DC2626' // red
}

const STATUS_STYLES = {
  open:   'bg-[#E6F1FB] text-[var(--blue)]',
  due:    'bg-[var(--amber-lt)] text-[var(--amber-brand)]',
  scored: 'bg-[var(--green-lt)] text-[var(--green)]',
}

// ── Popover component ─────────────────────────────────────────────────────────

function InfoPopover({ content, linkHref, linkLabel }: { content: string; linkHref?: string; linkLabel?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold leading-none"
        style={{ color: 'var(--text3)', backgroundColor: 'var(--gray-lt)', border: '1px solid var(--border)' }}
        aria-label="More information"
      >
        i
      </button>
      {open && (
        <div
          className="absolute left-0 top-6 z-50 w-72 rounded-xl shadow-lg p-3 text-[12px] leading-relaxed"
          style={{ backgroundColor: '#fff', border: '1px solid var(--border)', color: 'var(--text2)' }}
        >
          <p>{content}</p>
          {linkHref && linkLabel && (
            <a href={linkHref} className="inline-block mt-2 text-[11px] font-medium" style={{ color: 'var(--blue)' }}>
              {linkLabel} →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

export default function PredictionsClient({ initialPredictions, objectives, trackRecord }: Props) {
  const [predictions, setPredictions] = useState(initialPredictions)
  const [showForm, setShowForm] = useState(false)
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [accuracyId, setAccuracyId] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'due' | 'scored'>('all')
  const [activeTab, setActiveTab] = useState<'predictions' | 'track-record'>('predictions')

  // Form state
  const [statement, setStatement] = useState('')
  const [confidence, setConfidence] = useState(70)
  const [horizonDate, setHorizonDate] = useState('')
  const [objectiveId, setObjectiveId] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Scoring state (full modal — for "Score now" on due predictions)
  const [scoreOutcome, setScoreOutcome] = useState('')
  const [scoreRating, setScoreRating] = useState(3)
  const [scoringNote, setScoringNote] = useState('')

  // Accuracy-only scoring state (for tapping — on scored predictions missing accuracy)
  const [accuracyRating, setAccuracyRating] = useState(3)

  const filtered = predictions.filter(p => filterStatus === 'all' || getStatus(p) === filterStatus)

  async function handleCreate() {
    if (!statement.trim() || !horizonDate) return
    setSaving(true)
    const res = await fetch('/api/predictions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statement, confidence_pct: confidence, horizon_date: horizonDate, objective_id: objectiveId || undefined, notes: notes || undefined }),
    })
    if (res.ok) {
      const data = await res.json() as { prediction: Prediction }
      setPredictions(prev => [data.prediction, ...prev].sort((a, b) => new Date(a.horizon_date).getTime() - new Date(b.horizon_date).getTime()))
      setShowForm(false)
      setStatement(''); setConfidence(70); setHorizonDate(''); setObjectiveId(''); setNotes('')
    }
    setSaving(false)
  }

  async function handleScore(id: string) {
    const res = await fetch('/api/predictions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, outcome: scoreOutcome, accuracy_score: scoreRating, scoring_note: scoringNote || undefined }),
    })
    if (res.ok) {
      const data = await res.json() as { prediction: Prediction }
      setPredictions(prev => prev.map(p => p.id === id ? data.prediction : p))
      setScoringId(null)
      setScoreOutcome(''); setScoreRating(3); setScoringNote('')
    }
  }

  async function handleAccuracy(id: string) {
    const res = await fetch('/api/predictions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, accuracy_score: accuracyRating, scoring_note: scoringNote || undefined }),
    })
    if (res.ok) {
      const data = await res.json() as { prediction: Prediction }
      setPredictions(prev => prev.map(p => p.id === id ? data.prediction : p))
      setAccuracyId(null)
      setAccuracyRating(3)
      setScoringNote('')
    }
  }

  const dueCount = predictions.filter(p => getStatus(p) === 'due').length

  return (
    <div className="max-w-4xl">
      {/* Tab selector */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setActiveTab('predictions')}
          className={`text-[13px] px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'predictions'
              ? 'bg-navy text-white'
              : 'bg-white border border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue-mid)]'
          }`}
        >
          Prediction Log
        </button>
        <button
          onClick={() => setActiveTab('track-record')}
          className={`text-[13px] px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'track-record'
              ? 'bg-navy text-white'
              : 'bg-white border border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue-mid)]'
          }`}
        >
          Track Record
        </button>
      </div>

      {/* Track Record panel */}
      {activeTab === 'track-record' && (
        <div>
          <TrackRecordSummaryBar summary={trackRecord.summary} />
          <div className="bg-white border border-[var(--border)] rounded-2xl p-5 mb-4">
            <ConfidenceAccuracyChart predictions={trackRecord.predictions} />
          </div>
          <PredictionHistoryList predictions={trackRecord.predictions} />
        </div>
      )}

      {/* Prediction Log panel */}
      {activeTab === 'predictions' && <>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] font-medium text-[var(--text)]">Prediction Log</h1>
            <InfoPopover
              content="The Prediction Log captures specific, time-bound forecasts about your objectives. Each prediction is scored for accuracy when its horizon date is reached — building a calibrated record of what the system anticipated versus what actually happened. This is how Meridian measures its own intelligence over time."
              linkHref="/faq#what-is-a-prediction"
              linkLabel="Learn more"
            />
          </div>
          <p className="text-[13px] text-[var(--text3)] mt-0.5">
            {predictions.length} predictions · {dueCount} ready to score
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-[var(--night)] transition-colors"
          >
            <Plus size={14} /> New prediction
          </button>
          <InfoPopover
            content="Add a prediction when you have a specific belief about how an objective will unfold — a date you expect something to happen, a threshold you expect to reach, or an outcome you're tracking toward. Logging it now means Meridian can score it later. The more predictions you log, the more calibrated your confidence picture becomes."
            linkHref="/faq#adding-a-prediction"
            linkLabel="Learn more"
          />
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all','open','due','scored'] as const).map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`text-[12px] px-3 py-1.5 rounded-lg capitalize transition-colors ${filterStatus === s ? 'bg-navy text-white' : 'bg-white border border-[var(--border)] text-[var(--text2)] hover:border-[var(--blue-mid)]'}`}>
            {s === 'due' ? 'Score my predictions' : s}
          </button>
        ))}
      </div>

      {/* New prediction form */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-5 mb-4">
          <h2 className="text-[14px] font-semibold text-[var(--text)] mb-4">New prediction</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">Statement *</label>
              <textarea rows={2} value={statement} onChange={e => setStatement(e.target.value)}
                placeholder="By [date], [specific outcome] will happen..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] resize-none" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">Confidence: {confidence}%</label>
                <input type="range" min={10} max={95} value={confidence} onChange={e => setConfidence(parseInt(e.target.value))} className="w-full" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">Horizon date *</label>
                <input type="date" value={horizonDate} onChange={e => setHorizonDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[16px] bg-white focus:outline-none focus:border-[var(--blue)]" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">Objective</label>
                <select value={objectiveId} onChange={e => setObjectiveId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-[16px] bg-white focus:outline-none focus:border-[var(--blue)]">
                  <option value="">— None —</option>
                  {objectives.map(o => <option key={o.id} value={o.id}>{o.obj_id}</option>)}
                </select>
                {objectiveId && <ObjectiveSummaryInline objectiveId={objectiveId} />}
              </div>
            </div>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes (optional)"
              className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)]" />
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text2)] hover:bg-[var(--gray-lt)]">Cancel</button>
              <button onClick={handleCreate} disabled={saving || !statement.trim() || !horizonDate}
                className="flex-1 py-2 rounded-lg bg-navy text-white text-[13px] font-medium disabled:opacity-50">
                {saving ? 'Saving...' : 'Create prediction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Predictions table */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-12 text-center">
          <TrendingUp size={32} className="text-[var(--text3)] mx-auto mb-3" />
          {filterStatus === 'due' ? (
            <>
              <p className="text-[14px] font-medium text-[var(--text)] mb-1">No predictions ready to score</p>
              <p className="text-[13px] text-[var(--text3)] mb-2">No predictions you created have passed their horizon date yet.</p>
              <p className="text-[12px] text-[var(--text3)] italic">Only predictions you created are eligible to score. Meridian-generated predictions are scored automatically by the engine.</p>
            </>
          ) : (
            <>
              <p className="text-[14px] font-medium text-[var(--text)] mb-1">No predictions yet</p>
              <p className="text-[13px] text-[var(--text3)]">Make a prediction about one of your objectives to start tracking accuracy.</p>
            </>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-[13px] min-w-[520px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--gray-lt)]">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider">Prediction ID</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider">Statement</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider w-16">Conf</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider">Horizon</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[var(--text3)] uppercase tracking-wider w-20">Accuracy</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const status = getStatus(p)
                return (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--gray-lt)/30]">
                    <td className="px-4 py-3 font-mono text-[11px] text-[var(--text3)]">{p.pred_id ?? '—'}</td>
                    <td className="px-4 py-3 text-[var(--text2)] max-w-xs">
                      <p className="line-clamp-2">{p.statement}</p>
                      {p.objectives && p.objective_id && (
                        <div className="mt-0.5">
                          <ObjectivePopover objectiveId={p.objective_id} objId={p.objectives.obj_id} />
                        </div>
                      )}
                      {p.objectives && !p.objective_id && (
                        <p className="text-[11px] text-[var(--text3)] mt-0.5">{p.objectives.obj_id}</p>
                      )}
                      {p.accuracy_score && (
                        <div className="flex items-center gap-1.5 mt-1">
                          <div className="flex gap-0.5">
                            {[1,2,3,4,5].map(s => (
                              <span key={s} className={`text-[11px] ${s <= p.accuracy_score! ? 'text-[var(--gold)]' : 'text-[var(--border)]'}`}>★</span>
                            ))}
                          </div>
                          {p.notes?.includes('[Scoring note') && (
                            <span title="Has scoring note" style={{ flexShrink: 0, lineHeight: 1 }}>
                              <MessageSquare size={11} style={{ color: 'var(--text3)' }} />
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--text)]">{p.confidence_pct}%</td>
                    <td className="px-4 py-3 text-[var(--text2)]">
                      {new Date(p.horizon_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      {status === 'due' ? (
                        <button onClick={() => { setScoringId(p.id); setScoreOutcome(''); setScoreRating(3) }}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES.due} hover:opacity-80`}>
                          Score now
                        </button>
                      ) : (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[status]}`}>
                          {status === 'scored' ? 'Scored' : 'Open'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {(() => {
                        const score = getEngine4Score(p)
                        if (score === null) return (
                          <button
                            onClick={() => { setAccuracyId(p.id); setAccuracyRating(3); setScoringNote('') }}
                            className="text-[11px] font-semibold underline"
                            style={{ color: 'var(--gold)', cursor: 'pointer' }}
                          >
                            Score
                          </button>
                        )
                        return (
                          <span className="text-[13px] font-semibold tabular-nums" style={{ color: accuracyColor(score) }}>
                            {Math.round(score)}
                          </span>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      </>}

      {/* Full scoring modal — triggered by "Score now" on due predictions */}
      {scoringId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setScoringId(null); setScoringNote('') }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-[15px] font-semibold text-[var(--text)] mb-4">Score this prediction</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">What actually happened?</label>
                <textarea rows={3} value={scoreOutcome} onChange={e => setScoreOutcome(e.target.value)}
                  placeholder="Describe the actual outcome..."
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] resize-none" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-2">Accuracy (1–5)</label>
                <div className="flex gap-2">
                  {[1,2,3,4,5].map(s => (
                    <button key={s} onClick={() => setScoreRating(s)}
                      className={`text-[24px] transition-colors ${s <= scoreRating ? 'text-[var(--gold)]' : 'text-[var(--border)]'}`}>★</button>
                  ))}
                </div>
                <p className="text-[11px] text-[var(--text3)] mt-1">1 = Completely wrong · 5 = Exactly right</p>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">What happened? (optional)</label>
                <textarea rows={2} value={scoringNote} onChange={e => setScoringNote(e.target.value)}
                  placeholder="Describe what changed, what the engine missed, or what drove this outcome..."
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] resize-none" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => { setScoringId(null); setScoringNote('') }} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text2)]">Cancel</button>
                <button onClick={() => handleScore(scoringId)} disabled={!scoreOutcome.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium disabled:opacity-50">
                  Submit score
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Accuracy-only modal — triggered by tapping — in accuracy column */}
      {accuracyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setAccuracyId(null); setScoringNote('') }} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold text-[var(--text)]">Score accuracy</span>
                <InfoPopover
                  content="Accuracy measures how well a prediction matched what actually happened — not how successful the outcome was. Score 1–5: 5 = exactly right, 3 = partially correct (right direction, wrong timing/magnitude), 1 = incorrect. Accuracy scores feed directly into Meridian's engine calibration — score honestly."
                  linkHref="/faq#what-is-accuracy"
                  linkLabel="Read the full guide"
                />
              </div>
              <button onClick={() => { setAccuracyId(null); setScoringNote('') }} style={{ color: 'var(--text3)' }}>
                <X size={16} />
              </button>
            </div>

            {/* Advisory banner */}
            <div
              className="flex gap-2 rounded-xl p-3 mb-4 text-[12px] leading-relaxed"
              style={{ backgroundColor: 'rgba(201,162,39,0.10)', border: '1px solid rgba(201,162,39,0.3)' }}
            >
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--gold)' }} />
              <p style={{ color: 'var(--text2)' }}>
                Before scoring, please read:{' '}
                <a href="/faq#what-is-accuracy" className="font-medium underline" style={{ color: 'var(--gold)' }}>
                  What is Accuracy and How is it Determined
                </a>
                {' '}in the FAQ. Scoring inaccurately affects your engine&apos;s calibration.
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-2">Accuracy (1–5)</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(s => (
                  <button key={s} onClick={() => setAccuracyRating(s)}
                    className={`text-[28px] transition-colors ${s <= accuracyRating ? 'text-[var(--gold)]' : 'text-[var(--border)]'}`}>★</button>
                ))}
              </div>
              <p className="text-[11px] text-[var(--text3)] mt-1">1 = Completely wrong · 5 = Exactly right</p>
            </div>

            <div className="mb-4">
              <label className="block text-[11px] font-semibold text-[var(--text2)] uppercase tracking-wide mb-1">What happened? (optional)</label>
              <textarea rows={2} value={scoringNote} onChange={e => setScoringNote(e.target.value)}
                placeholder="Describe what changed, what the engine missed, or what drove this outcome..."
                className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)] text-[13px] focus:outline-none focus:border-[var(--blue)] resize-none" />
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setAccuracyId(null); setScoringNote('') }} className="flex-1 py-2.5 rounded-lg border border-[var(--border)] text-[13px] text-[var(--text2)]">Cancel</button>
              <button onClick={() => handleAccuracy(accuracyId)}
                className="flex-1 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium">
                Save score
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
