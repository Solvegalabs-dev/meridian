'use client'

import { useEffect, useState, useRef } from 'react'
import type { StrikeBriefRow } from '@/lib/strikeBrief/strikeBriefGenerator'
import { isClosedBrief } from '@/lib/strikeBrief/goNoGo'
import { verdictStyle, TIER_CHIP } from '@/lib/strike/verdictStyles'
import { isStaleBrief, staleBriefNote, updatedLabel } from '@/lib/strike/briefFreshness'

interface Props {
  objectiveId: string
  domain: string
  // Evaluated window state is "active". Gates the stale-brief note.
  huntActive?: boolean
}

const TIER_COLOR: Record<string, string> = {
  T1: '#4ade80', T2: '#60a5fa', T3: '#C9A227', T4: '#cbd5e1',
}

type FieldQA = { question: string; answer: string; confidence_tier: string }

// Probability bar — renders a text-based bar like ████████░░ 82%
function ProbBar({ probability, label, reason, tier, isCurrent }: {
  probability: number; label: string; reason: string; tier: string; isCurrent: boolean
}) {
  const filled = Math.round(probability * 10)
  const empty = 10 - filled
  const bar = '█'.repeat(filled) + '░'.repeat(empty)
  const pct = Math.round(probability * 100)
  return (
    <div
      className="flex items-start gap-2 py-1 px-2 rounded"
      style={{ backgroundColor: isCurrent ? 'rgba(96,165,250,.08)' : 'transparent', borderLeft: isCurrent ? '2px solid #60a5fa' : '2px solid transparent' }}
    >
      <span className="font-mono text-[11px] w-8 flex-shrink-0" style={{ color: TIER_COLOR[tier] ?? TIER_COLOR.T4 }}>{label}</span>
      <span className="font-mono text-[11px] flex-shrink-0" style={{ color: '#60a5fa', letterSpacing: '-0.5px' }}>{bar}</span>
      <span className="font-mono text-[11px] w-8 flex-shrink-0 text-right" style={{ color: 'var(--ov-text-mid)' }}>{pct}%</span>
      <span className="text-[13px] leading-snug" style={{ color: 'var(--ov-text-mid)' }}>{reason}</span>
    </div>
  )
}

export default function StrikeBriefCard({ objectiveId, domain, huntActive = false }: Props) {
  const [brief, setBrief]     = useState<StrikeBriefRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // CyberScout state
  const [qaHistory, setQaHistory]   = useState<FieldQA[]>([])
  const [question, setQuestion]     = useState('')
  const [qaLoading, setQaLoading]   = useState(false)
  const [qaError, setQaError]       = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Section open state
  const [movOpen, setMovOpen]   = useState(true)
  const [terrOpen, setTerrOpen] = useState(false)
  const [qaOpen, setQaOpen]     = useState(false)
  // Agent hits (9-11 px chips) live behind a Sources toggle, closed by default.
  const [sourcesOpen, setSourcesOpen] = useState(false)

  useEffect(() => {
    if (domain !== 'elk_hunt') { setLoading(false); return }
    fetch(`/api/strike-brief?objectiveId=${encodeURIComponent(objectiveId)}`)
      .then(res => res.ok ? res.json() as Promise<StrikeBriefRow> : Promise.reject(res.statusText))
      .then(data => { setBrief(data); setLoading(false) })
      .catch(e => { setError(String(e)); setLoading(false) })
  }, [objectiveId, domain])

  async function handleAsk() {
    if (!question.trim() || qaLoading) return
    setQaLoading(true)
    setQaError(null)
    try {
      const res = await fetch('/api/field-query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), objectiveId }),
      })
      const data = await res.json() as { answer?: string; confidence_tier?: string; error?: string }
      if (!res.ok) { setQaError(data.error ?? 'Query failed'); return }
      setQaHistory(prev => [{ question: question.trim(), answer: data.answer ?? '', confidence_tier: data.confidence_tier ?? 'T4' }, ...prev].slice(0, 3))
      setQuestion('')
    } catch (e) {
      setQaError(String(e))
    } finally {
      setQaLoading(false)
    }
  }

  if (domain !== 'elk_hunt') return null
  if (loading) {
    return (
      <div className="rounded-xl p-4 mt-4" style={{ border: '1px solid var(--ov-border)', backgroundColor: 'var(--ov-navy-card)' }}>
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--ov-blue)' }} />
          <span className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>Loading strike brief…</span>
        </div>
      </div>
    )
  }
  if (error || !brief) return null

  const gng = verdictStyle(brief.go_no_go)

  // Determine current time window for movement highlight
  const now = new Date()
  const mtHour = (now.getUTCHours() - 6 + 24) % 24
  const mtMin = now.getUTCMinutes()
  const mtHHMM = `${String(mtHour).padStart(2, '0')}${String(mtMin).padStart(2, '0')}`

  // FF-089 P0: a closed hunt shows no time window, movement windows or terrain.
  const closed = isClosedBrief(brief)
  const windows = closed ? [] : (brief.movement_windows ?? [])
  const terrain = closed ? null : brief.terrain_intel
  const updatedAt = brief.created_at
  const stale = !closed && isStaleBrief(updatedAt, now, huntActive)

  return (
    <div className="rounded-xl mt-4 flex flex-col overflow-hidden" style={{ border: '1px solid var(--ov-border-md)', backgroundColor: 'var(--ov-navy-card)' }}>
      {/* Header: verdict first, tier beside it, then the updated time */}
      <div className="px-4 pt-4 pb-3 flex flex-col gap-2" style={{ borderBottom: '1px solid var(--ov-border)' }}>
        <div className="flex items-center gap-2 flex-wrap">
          {gng && (
            <span className="text-xl font-bold leading-none px-3 py-2 rounded-lg"
              style={{ backgroundColor: gng.bg, color: gng.color }}>
              {gng.label}
            </span>
          )}
          {!closed && brief.confidence_tier && TIER_CHIP[brief.confidence_tier] && (
            <span className="text-sm font-bold px-2 py-1 rounded"
              style={{ backgroundColor: TIER_CHIP[brief.confidence_tier].bg, color: TIER_CHIP[brief.confidence_tier].color }}>
              {brief.confidence_tier}
            </span>
          )}
          {!closed && (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-bold tracking-wider uppercase"
              style={{ backgroundColor: 'rgba(96,165,250,.15)', color: '#93c5fd', border: '1px solid rgba(96,165,250,.3)' }}>
              {brief.time_window}
            </span>
          )}
          <span className="text-[11px] ml-auto" style={{ color: 'var(--ov-text-dim)' }}>STRIKE BRIEF · {brief.brief_date}</span>
        </div>
        {!closed && (
          <div className="text-[13px]" style={{ color: 'var(--ov-text-mid)' }}>{updatedLabel(updatedAt)}</div>
        )}
        {stale && (
          <div className="rounded-lg px-3 py-2 text-[13px] font-medium" style={{ backgroundColor: '#451a03', color: '#fde68a' }}>
            {staleBriefNote(updatedAt, now)}
          </div>
        )}
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Lead signal */}
        {brief.lead_signal && (
          <div className="px-3 py-2 rounded-lg text-[13px] font-medium leading-snug"
            style={{ backgroundColor: 'rgba(201,162,39,.1)', border: '1px solid rgba(201,162,39,.25)', color: '#C9A227' }}>
            {brief.lead_signal}
          </div>
        )}

        {/* Synthesis */}
        <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>{brief.synthesis}</p>

        {/* Condition delta */}
        {brief.condition_delta && (
          <p className="text-[13px] italic" style={{ color: 'var(--ov-text-dim)' }}>Delta: {brief.condition_delta}</p>
        )}

        {/* Footer row */}
        <div className="flex items-center gap-3 flex-wrap pt-1" style={{ borderTop: '1px solid var(--ov-border)' }}>
          {brief.pattern_match_year && (
            <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>Pattern: {brief.pattern_match_year}</span>
          )}
          {brief.agent_hits.length > 0 && (
            <button
              onClick={() => setSourcesOpen(o => !o)}
              className="ml-auto min-h-[44px] flex items-center text-[11px] font-semibold tracking-wider uppercase"
              style={{ color: 'var(--ov-text-mid)' }}
              aria-expanded={sourcesOpen}
            >
              Sources {sourcesOpen ? '▲' : '▼'}
            </button>
          )}
        </div>
        {sourcesOpen && brief.agent_hits.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {brief.agent_hits.map(key => (
              <span key={key} className="px-2 py-1 rounded text-[11px] font-mono"
                style={{ backgroundColor: 'rgba(96,165,250,.1)', color: '#93c5fd', border: '1px solid rgba(96,165,250,.2)' }}>
                {key}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Section 1: Movement Windows ── */}
      {windows.length > 0 && (
        <div style={{ borderTop: '1px solid var(--ov-border)' }}>
          <button
            onClick={() => setMovOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ov-text-dim)' }}>
              Movement Probability
            </span>
            <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>{movOpen ? '▲' : '▼'}</span>
          </button>
          {movOpen && (
            <div className="px-3 pb-3 flex flex-col gap-0.5">
              {windows.map(w => (
                <ProbBar
                  key={w.time}
                  label={w.time}
                  probability={w.probability}
                  reason={w.reason}
                  tier={w.confidence_tier}
                  isCurrent={mtHHMM >= w.time && mtHHMM < (windows[windows.findIndex(x => x.time === w.time) + 1]?.time ?? '2359')}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Section 2: Terrain Intelligence ── */}
      {terrain && (terrain.bedding.length > 0 || terrain.feeding.length > 0 || terrain.corridors.length > 0) && (
        <div style={{ borderTop: '1px solid var(--ov-border)' }}>
          <button
            onClick={() => setTerrOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ov-text-dim)' }}>
                Terrain Intel
              </span>
              {brief.terrain_source && (
                <span className="px-1.5 py-0.5 rounded text-[11px] uppercase font-bold"
                  style={{
                    backgroundColor: brief.terrain_source === '3DEP' ? 'rgba(74,222,128,.1)' : 'rgba(201,162,39,.1)',
                    color: brief.terrain_source === '3DEP' ? '#4ade80' : '#C9A227',
                    border: `1px solid ${brief.terrain_source === '3DEP' ? 'rgba(74,222,128,.3)' : 'rgba(201,162,39,.3)'}`,
                  }}>
                  {brief.terrain_source === '3DEP' ? '3DEP' : 'Field Description'}
                </span>
              )}
            </div>
            <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>{terrOpen ? '▲' : '▼'}</span>
          </button>
          {terrOpen && (
            <div className="px-4 pb-3 flex flex-col gap-2">
              {terrain.bedding.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold tracking-wider uppercase block mb-1" style={{ color: 'rgba(96,165,250,.7)' }}>Bedding</span>
                  {terrain.bedding.map((b, i) => (
                    <p key={i} className="text-[13px] leading-snug" style={{ color: 'var(--ov-text-mid)' }}>{b}</p>
                  ))}
                </div>
              )}
              {terrain.feeding.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold tracking-wider uppercase block mb-1" style={{ color: '#4ade80' }}>Feeding</span>
                  {terrain.feeding.map((f, i) => (
                    <p key={i} className="text-[13px] leading-snug" style={{ color: 'var(--ov-text-mid)' }}>{f}</p>
                  ))}
                </div>
              )}
              {terrain.corridors.length > 0 && (
                <div>
                  <span className="text-[11px] font-bold tracking-wider uppercase block mb-1" style={{ color: '#C9A227' }}>Corridors</span>
                  {terrain.corridors.map((c, i) => (
                    <p key={i} className="text-[13px] leading-snug" style={{ color: 'var(--ov-text-mid)' }}>{c}</p>
                  ))}
                </div>
              )}
              {terrain.elevation_range && (
                <p className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
                  Elevation: {terrain.elevation_range.min}m – {terrain.elevation_range.max}m
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section 3: CyberScout Field Query ── */}
      <div style={{ borderTop: '1px solid var(--ov-border)' }}>
        <button
          onClick={() => setQaOpen(o => !o)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        >
          <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--ov-text-dim)' }}>
            CyberScout
          </span>
          <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>{qaOpen ? '▲' : '▼'}</span>
        </button>
        {qaOpen && (
          <div className="px-4 pb-4 flex flex-col gap-3">
            {/* Q&A history */}
            {qaHistory.map((qa, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-lg p-3"
                style={{ backgroundColor: 'rgba(255,255,255,.03)', border: '1px solid var(--ov-border)' }}>
                <p className="text-[11px] font-medium" style={{ color: 'var(--ov-text-dim)' }}>Q: {qa.question}</p>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>{qa.answer}</p>
                <span className="text-[11px] font-bold self-end" style={{ color: TIER_COLOR[qa.confidence_tier] ?? TIER_COLOR.T4 }}>
                  {qa.confidence_tier}
                </span>
              </div>
            ))}

            {/* Input */}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAsk()}
                placeholder='"Is this bedding terrain?" · "What does this track pattern indicate?"'
                className="flex-1 px-3 py-2 rounded-lg text-[13px] focus:outline-none"
                style={{
                  backgroundColor: 'var(--ov-navy)',
                  border: '1px solid var(--ov-border-md)',
                  color: 'var(--ov-text-hi)',
                }}
              />
              <button
                onClick={handleAsk}
                disabled={qaLoading || !question.trim()}
                className="px-3 py-2 rounded-lg text-[13px] font-medium disabled:opacity-40 transition-opacity flex-shrink-0"
                style={{ backgroundColor: 'rgba(96,165,250,.2)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.3)' }}
              >
                {qaLoading ? '…' : 'Ask'}
              </button>
            </div>
            {qaError && (
              <p className="text-[11px]" style={{ color: '#C85A54' }}>{qaError}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
