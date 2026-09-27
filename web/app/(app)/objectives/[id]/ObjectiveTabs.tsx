'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import ActionsList from './ActionsList'
import InferencePanel from '@/components/objectives/InferencePanel'
import type { Factor } from './page'

export interface SignalAccuracyRow {
  signal_class: string
  outcomes_scored: number
  accuracy_avg: number | null
  weight_modifier: number
}

interface TabSignal {
  id: string
  title: string
  body: string | null
  source: string | null
  source_type: string | null
  signal_class: string | null
  created_at: string
}

export interface Episode {
  id: string
  episode_number: number
  confidence_start: number | null
  confidence_end: number
  confidence_delta: number | null
  narrative: string | null
  top_action: string | null
  recommended_actions: string[] | null
  signal_gap: string | null
  top_signals: { title: string; signal_class: string; relevance: string; body_excerpt: string | null }[] | null
  cross_deps_detected: { obj_id: string; objective_id: string | null; title: string | null; relationship: string | null }[] | null
  inference_block: import('@/lib/anthropic/prompts/output').InferenceBlock | null
  source: string
  signal_count: number
  created_at: string
}

interface ObjectiveTabsProps {
  factors: Factor[]
  actions: string[]
  objId: string
  objectiveId: string
  signals: TabSignal[]
  goalDescription: string | null
  goalContext: string | null
  tier: string
  hasCalendar: boolean
  episodes: Episode[]
  objectiveDomain: string
  signalAccuracy: SignalAccuracyRow[]
  askWidget?: ReactNode
}

const DOT_COLORS: Record<Factor['color'], string> = {
  red: 'var(--ov-red)',
  amber: 'var(--ov-amber)',
  green: 'var(--ov-green)',
  blue: 'var(--blue-mid)',
}

const SOURCE_BADGES: Record<string, { label: string; color: string }> = {
  news: { label: 'News', color: 'var(--blue-mid)' },
  calendar: { label: 'Calendar', color: '#2EA88C' },
  inbox: { label: 'Inbox', color: 'var(--gold)' },
  manual: { label: 'Manual', color: 'var(--ov-text-dim)' },
  user_action: { label: 'You', color: 'var(--gold)' },
  sweep: { label: 'Sweep analysis', color: '#8B7FD4' },
}

const ACTION_CLASSES = [
  { value: '', label: 'Action type (optional)' },
  { value: 'applied_submitted', label: 'Applied / Submitted' },
  { value: 'contacted', label: 'Contacted / Reached out' },
  { value: 'research', label: 'Research / Gathered info' },
  { value: 'decision', label: 'Decision made' },
  { value: 'task_completed', label: 'Task completed' },
  { value: 'meeting_call', label: 'Meeting / Call' },
  { value: 'other', label: 'Other' },
]

const TABS = ["What's affecting it", 'What this Means', 'What to do', 'Signals', 'History', 'Signal Intel', 'Goal'] as const

export default function ObjectiveTabs({ factors, actions, objId, objectiveId, signals, goalDescription, goalContext, tier, hasCalendar, episodes, objectiveDomain, signalAccuracy, askWidget }: ObjectiveTabsProps) {
  const router = useRouter()
  const [active, setActive] = useState<typeof TABS[number]>(TABS[0])
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set())
  const [showAllDeps, setShowAllDeps] = useState(false)
  const [showAllActions, setShowAllActions] = useState(false)
  const [showAllSignals, setShowAllSignals] = useState(false)
  const [showAllEpisodes, setShowAllEpisodes] = useState(false)

  function toggleEpisode(id: string) {
    setExpandedEpisodes(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  // "I did this" form state
  const [logOpen, setLogOpen] = useState(false)
  const [logDesc, setLogDesc] = useState('')
  const [logDate, setLogDate] = useState(new Date().toISOString().split('T')[0])
  const [logClass, setLogClass] = useState('')
  const [logSaving, setLogSaving] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logResult, setLogResult] = useState<{ newConfidence: number; reasoning: string } | null>(null)

  async function handleLogAction() {
    if (!logDesc.trim()) return
    setLogSaving(true)
    setLogError(null)
    setLogResult(null)
    try {
      const res = await fetch(`/api/objectives/${objectiveId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: logDesc.trim(),
          action_date: logDate,
          action_class: logClass || null,
          source: 'user_logged',
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Could not save — please try again.')
      }
      const data = await res.json() as { new_confidence?: number; confidence_reasoning?: string }
      setLogResult({
        newConfidence: data.new_confidence ?? 0,
        reasoning: data.confidence_reasoning ?? '',
      })
      router.refresh()
      setLogDesc('')
      setLogClass('')
      setLogDate(new Date().toISOString().split('T')[0])
    } catch (err) {
      setLogError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setLogSaving(false)
    }
  }

  return (
    <div>
      <div className="flex gap-1 mb-4 overflow-x-auto" style={{ borderBottom: '1px solid var(--ov-border)' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className="text-[12px] font-medium px-3 py-2.5 -mb-px whitespace-nowrap flex-shrink-0"
            style={{
              color: active === tab ? 'var(--gold)' : 'var(--ov-text-dim)',
              borderBottom: active === tab ? '2px solid var(--gold)' : '2px solid transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="rounded-2xl p-4" style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)' }}>
        {active === "What's affecting it" && (() => {
          const depSignals = signals.filter(s => s.signal_class === 'dependency')
          const userActionSignals = signals.filter(s => s.signal_class === 'user_action')
          const hasContent = factors.length > 0 || depSignals.length > 0 || userActionSignals.length > 0
          if (!hasContent) {
            return <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>Run a scan to see what&apos;s affecting this goal.</p>
          }
          return (
            <div className="space-y-4">
              {factors.length > 0 && (
                <ul className="space-y-3">
                  {factors.map((f, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: DOT_COLORS[f.color] }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>{f.title}</p>
                        <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--ov-text-mid)' }}>{f.description}</p>
                        <p className="text-[10px] uppercase tracking-wide mt-1" style={{ color: 'var(--ov-text-dim)' }}>{f.impact}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {depSignals.length > 0 && (
                <div>
                  {factors.length > 0 && <div className="mb-3" style={{ borderTop: '1px solid var(--ov-border)' }} />}
                  <p className="text-[10px] uppercase tracking-wide mb-2.5" style={{ color: 'var(--ov-text-dim)' }}>Cross-goal dependencies</p>
                  {/* Summary: first sentence of first dep as a synthesized lead */}
                  {depSignals[0] && (
                    <p className="text-[12px] leading-relaxed mb-2.5" style={{ color: 'var(--ov-text-mid)' }}>
                      {(depSignals[0].body ?? depSignals[0].title ?? '').split(/\.\s/)[0].replace(/\.$/, '') + (depSignals.length > 1 ? `, along with ${depSignals.length - 1} other cross-goal link${depSignals.length > 2 ? 's' : ''}.` : '.')}
                    </p>
                  )}
                  <ul className="space-y-3">
                    {(showAllDeps ? depSignals : depSignals.slice(0, 5)).map(sig => (
                      <li key={sig.id} className="flex gap-3">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: 'var(--blue-mid)' }} />
                        <div className="min-w-0 flex-1">
                          {/* body exists only when title was sliced at 120 chars — show full text */}
                          <p className="text-[13px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>{sig.body ?? sig.title}</p>
                          <p className="text-[10px] mt-1" style={{ color: 'var(--ov-text-dim)' }}>
                            {new Date(sig.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {depSignals.length > 5 && (
                    <button onClick={() => setShowAllDeps(v => !v)} className="text-[10px] mt-2 block" style={{ color: 'var(--ov-text-dim)' }}>
                      {showAllDeps ? 'Show less ↑' : `Show all ${depSignals.length} →`}
                    </button>
                  )}
                </div>
              )}
              {userActionSignals.length > 0 && (
                <div>
                  {(factors.length > 0 || depSignals.length > 0) && <div className="mb-3" style={{ borderTop: '1px solid var(--ov-border)' }} />}
                  <p className="text-[10px] uppercase tracking-wide mb-2.5" style={{ color: 'var(--ov-text-dim)' }}>What you&apos;ve done</p>
                  <ul className="space-y-3">
                    {(showAllActions ? userActionSignals : userActionSignals.slice(0, 5)).map(sig => (
                      <li key={sig.id} className="flex gap-3">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: 'var(--gold)' }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>{sig.title}</p>
                          {sig.body && (
                            <p className="text-[12px] leading-relaxed mt-0.5" style={{ color: 'var(--ov-text-mid)' }}>{sig.body}</p>
                          )}
                          <p className="text-[10px] mt-1" style={{ color: 'var(--ov-text-dim)' }}>
                            {new Date(sig.created_at).toLocaleDateString()}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {userActionSignals.length > 5 && (
                    <button onClick={() => setShowAllActions(v => !v)} className="text-[10px] mt-2 block" style={{ color: 'var(--ov-text-dim)' }}>
                      {showAllActions ? 'Show less ↑' : `Show all ${userActionSignals.length} →`}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {active === 'What this Means' && (() => {
          // Find the most recent episode that has an inference_block
          const latestWithInference = episodes.find(ep => ep.inference_block)
          if (!latestWithInference?.inference_block) {
            return (
              <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>
                Run a scan to generate inferences for this goal. Meridian will surface the blind spots and forward-looking conclusions you may be missing.
              </p>
            )
          }
          return (
            <InferencePanel
              inferenceBlock={latestWithInference.inference_block}
              defaultExpanded={true}
            />
          )
        })()}

        {active === 'What to do' && (
          <div className="space-y-4">
            {actions.length === 0 ? (
              <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>Run a scan to get action items for this goal.</p>
            ) : (
              <ActionsList
                actions={actions}
                objId={objId}
                objectiveId={objectiveId}
                tier={tier}
                hasCalendar={hasCalendar}
              />
            )}

            {/* "I did this" free-form action log */}
            <div style={{ borderTop: '1px solid var(--ov-border)', paddingTop: 16 }}>
              {!logOpen && !logResult && (
                <button
                  onClick={() => setLogOpen(true)}
                  className="text-[12px] font-medium"
                  style={{ color: 'var(--gold)' }}
                >
                  + I did something — log it
                </button>
              )}

              {logResult && (
                <div
                  className="rounded-xl p-3 mb-3"
                  style={{ backgroundColor: 'rgba(201,162,39,0.1)', border: '1px solid rgba(201,162,39,0.25)' }}
                >
                  <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'var(--gold)' }}>
                    Confidence updated to {logResult.newConfidence}%
                  </p>
                  {logResult.reasoning && (
                    <p className="text-[11px] leading-relaxed" style={{ color: 'var(--ov-text-mid)' }}>{logResult.reasoning}</p>
                  )}
                  <button
                    onClick={() => { setLogResult(null); setLogOpen(true) }}
                    className="mt-2 text-[11px]"
                    style={{ color: 'var(--ov-text-dim)' }}
                  >
                    Log another
                  </button>
                </div>
              )}

              {logOpen && (
                <div className="rounded-xl p-4" style={{ backgroundColor: 'rgba(201,162,39,0.06)', border: '1px solid rgba(201,162,39,0.2)' }}>
                  <p className="text-[12px] font-semibold mb-3" style={{ color: 'var(--gold)' }}>What did you do?</p>

                  {logError && (
                    <div className="mb-3 px-3 py-2 rounded-lg text-[11px]" style={{ backgroundColor: 'rgba(192,64,42,0.14)', color: 'var(--ov-red)' }}>
                      {logError}
                    </div>
                  )}

                  <div className="mb-2.5">
                    <textarea
                      rows={2}
                      value={logDesc}
                      onChange={e => setLogDesc(e.target.value)}
                      placeholder="Describe what you did and the result..."
                      className="w-full px-3 py-2 rounded-lg text-[12px] resize-none focus:outline-none"
                      style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: '#fff' }}
                    />
                  </div>

                  <div className="flex gap-2 mb-3">
                    <div className="flex-1">
                      <input
                        type="date"
                        value={logDate}
                        onChange={e => setLogDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-[12px] focus:outline-none"
                        style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: '#fff' }}
                      />
                    </div>
                    <div className="flex-1">
                      <select
                        value={logClass}
                        onChange={e => setLogClass(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-[12px] focus:outline-none"
                        style={{ backgroundColor: 'var(--ov-navy-card)', border: '1px solid var(--ov-border-md)', color: logClass ? '#fff' : 'var(--ov-text-dim)' }}
                      >
                        {ACTION_CLASSES.map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => { setLogOpen(false); setLogError(null); setLogDesc(''); setLogClass('') }}
                      className="flex-1 py-1.5 rounded-lg text-[12px]"
                      style={{ border: '1px solid var(--ov-border-md)', color: 'var(--ov-text-mid)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleLogAction}
                      disabled={logSaving || !logDesc.trim()}
                      className="flex-1 py-1.5 rounded-lg text-[12px] font-medium disabled:opacity-50"
                      style={{ backgroundColor: 'var(--gold)', color: '#0a1628' }}
                    >
                      {logSaving ? 'Saving...' : 'Log action'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {active === 'Signals' && (() => {
          // Dependency, user_action belong in "What's affecting it" — not here.
          const feedSignals = signals.filter(s => s.signal_class !== 'dependency' && s.signal_class !== 'user_action')
          return feedSignals.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>No signals yet for this goal.</p>
          ) : (
            <>
            <ul className="space-y-2.5">
              {(showAllSignals ? feedSignals : feedSignals.slice(0, 7)).map(sig => {
                const badge = SOURCE_BADGES[sig.source_type ?? ''] ?? { label: sig.source_type ?? 'Signal', color: 'var(--ov-text-dim)' }
                return (
                  <li key={sig.id} className="flex items-start gap-2.5">
                    <span
                      className="text-[9px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 whitespace-nowrap"
                      style={{ backgroundColor: `${badge.color}22`, color: badge.color }}
                    >
                      {badge.label}
                    </span>
                    <div className="flex-1 min-w-0">
                      {/* body exists only when title was sliced at 120 chars — show full text */}
                      <p className="text-[12px]" style={{ color: 'var(--ov-text-hi)' }}>{sig.body ?? sig.title}</p>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--ov-text-dim)' }}>
                        {new Date(sig.created_at).toLocaleDateString()}
                      </p>
                      {sig.source && (
                        sig.source.startsWith('http') ? (
                          <a
                            href={sig.source}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] mt-0.5 inline-block"
                            style={{ color: 'var(--blue-mid)' }}
                          >
                            View source ↗
                          </a>
                        ) : (
                          <p className="text-[10px] mt-0.5" style={{ color: 'var(--ov-text-dim)' }}>{sig.source}</p>
                        )
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {feedSignals.length > 7 && (
              <button onClick={() => setShowAllSignals(v => !v)} className="text-[10px] mt-2 block" style={{ color: 'var(--ov-text-dim)' }}>
                {showAllSignals ? 'Show less ↑' : `Show all ${feedSignals.length} →`}
              </button>
            )}
            </>
          )
        })()}

        {active === 'History' && (() => {
          if (episodes.length === 0) {
            return (
              <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>
                No sweep history yet. Run your first sweep to begin building your objective&apos;s confidence timeline.
              </p>
            )
          }

          const SOURCE_LABEL: Record<string, string> = {
            sweep: 'Sweep',
            user_action: 'You logged',
            manual: 'Manual',
          }

          const visibleEpisodes = showAllEpisodes ? episodes : episodes.slice(0, 5)
          return (
            <>
            <ul className="space-y-3">
              {visibleEpisodes.map(ep => {
                const expanded = expandedEpisodes.has(ep.id)
                const delta = ep.confidence_delta
                const deltaStr = delta !== null
                  ? (delta >= 0 ? `+${delta}` : `${delta}`)
                  : null
                const deltaColor = delta === null ? 'var(--ov-text-dim)'
                  : delta > 0 ? 'var(--ov-green)'
                  : delta < 0 ? 'var(--ov-red)'
                  : 'var(--ov-text-dim)'

                return (
                  <li key={ep.id} className="rounded-xl p-3" style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid var(--ov-border)' }}>
                    {/* Header */}
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-semibold" style={{ color: 'var(--ov-text-hi)' }}>
                          Episode #{ep.episode_number}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--ov-text-dim)' }}>
                          {new Date(ep.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'rgba(201,162,39,0.12)', color: 'var(--gold)' }}
                        >
                          {SOURCE_LABEL[ep.source] ?? ep.source}
                        </span>
                      </div>
                    </div>

                    {/* Confidence row */}
                    <div className="flex items-center gap-2 mb-2.5 text-[12px]">
                      {ep.confidence_start !== null ? (
                        <>
                          <span style={{ color: 'var(--ov-text-mid)' }}>{ep.confidence_start}%</span>
                          <span style={{ color: 'var(--ov-text-dim)' }}>→</span>
                        </>
                      ) : null}
                      <span className="font-semibold" style={{ color: 'var(--ov-text-hi)' }}>{ep.confidence_end}%</span>
                      {deltaStr && (
                        <span className="text-[11px] font-medium" style={{ color: deltaColor }}>
                          ({deltaStr})
                        </span>
                      )}
                      <span className="text-[10px]" style={{ color: 'var(--ov-text-dim)' }}>
                        · {ep.signal_count} signal{ep.signal_count !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Narrative */}
                    {ep.narrative && (
                      <p className="text-[12px] leading-relaxed mb-2.5" style={{ color: 'var(--ov-text-mid)' }}>
                        {ep.narrative}
                      </p>
                    )}

                    {/* Expand toggle */}
                    {(ep.top_action || (ep.recommended_actions?.length ?? 0) > 0 || ep.signal_gap || (ep.top_signals?.length ?? 0) > 0 || (ep.cross_deps_detected?.length ?? 0) > 0) && (
                      <button
                        onClick={() => toggleEpisode(ep.id)}
                        className="text-[11px]"
                        style={{ color: 'var(--ov-text-dim)' }}
                      >
                        {expanded ? '↑ Less' : '↓ More'}
                      </button>
                    )}

                    {/* Expanded detail */}
                    {expanded && (
                      <div className="mt-3 space-y-3" style={{ borderTop: '1px solid var(--ov-border)', paddingTop: 12 }}>
                        {(ep.top_signals?.length ?? 0) > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--ov-text-dim)' }}>Top signals</p>
                            <ul className="space-y-1.5">
                              {ep.top_signals!.map((s, i) => (
                                <li key={i} className="text-[12px]" style={{ color: 'var(--ov-text-mid)' }}>
                                  <span
                                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full mr-1.5"
                                    style={{ backgroundColor: 'rgba(255,255,255,0.07)', color: 'var(--ov-text-dim)' }}
                                  >
                                    {s.relevance}
                                  </span>
                                  {s.title}
                                  {s.body_excerpt && (
                                    <span className="block text-[11px] mt-0.5 ml-0.5" style={{ color: 'var(--ov-text-dim)' }}>{s.body_excerpt}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {(ep.recommended_actions?.length ?? 0) > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--ov-text-dim)' }}>Recommended actions</p>
                            <ul className="space-y-1">
                              {ep.recommended_actions!.map((a, i) => (
                                <li key={i} className="text-[12px] flex gap-2" style={{ color: 'var(--ov-text-mid)' }}>
                                  <span style={{ color: 'var(--ov-text-dim)' }}>{i + 1}.</span>
                                  {a}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {ep.signal_gap && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--ov-text-dim)' }}>Signal gap</p>
                            <p className="text-[12px]" style={{ color: 'var(--ov-text-mid)' }}>{ep.signal_gap}</p>
                          </div>
                        )}

                        {(ep.cross_deps_detected?.length ?? 0) > 0 && (
                          <div>
                            <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--ov-text-dim)' }}>Cross-goal links</p>
                            <ul className="space-y-1">
                              {ep.cross_deps_detected!.map((d, i) => (
                                <li key={i} className="text-[12px]" style={{ color: 'var(--ov-text-mid)' }}>
                                  <span className="font-medium block" style={{ color: 'var(--ov-text-hi)' }}>{d.title ?? d.obj_id}</span>
                                  {d.relationship && <span className="block">{d.relationship}</span>}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {episodes.length > 5 && (
              <button onClick={() => setShowAllEpisodes(v => !v)} className="text-[10px] mt-3 block" style={{ color: 'var(--ov-text-dim)' }}>
                {showAllEpisodes ? 'Show less ↑' : `Show all ${episodes.length} →`}
              </button>
            )}
            </>
          )
        })()}

        {active === 'Signal Intel' && (() => {
          if (signalAccuracy.length === 0) {
            return (
              <div className="space-y-3">
                <p className="text-[13px] font-medium" style={{ color: 'var(--ov-text-hi)' }}>
                  Signal Class Accuracy — {objectiveDomain}
                </p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--ov-text-dim)' }}>
                  Signal accuracy data builds as your predictions are scored. First calibration data expected after your first outcome is recorded.
                </p>
              </div>
            )
          }

          return (
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--ov-text-dim)' }}>
                Signal Class Accuracy — {objectiveDomain}
              </p>
              <ul className="space-y-4">
                {signalAccuracy.map(row => {
                  const avg = row.accuracy_avg ?? 0
                  const pct = Math.round(avg)
                  const active = row.outcomes_scored >= 3
                  const needed = 3 - row.outcomes_scored
                  const barColor = pct >= 70 ? 'var(--gold)' : pct >= 50 ? '#D97706' : 'var(--ov-red)'

                  return (
                    <li key={row.signal_class}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-mono" style={{ color: 'var(--ov-text-hi)', minWidth: 100 }}>
                          {row.signal_class}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold tabular-nums" style={{ color: barColor }}>
                            {row.accuracy_avg !== null ? `${pct}%` : '—'}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--ov-text-dim)' }}>
                            ({row.outcomes_scored} outcome{row.outcomes_scored !== 1 ? 's' : ''})
                          </span>
                        </div>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(255,255,255,0.08)', height: 6 }}>
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: barColor }}
                        />
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: active ? barColor : 'var(--ov-text-dim)' }}>
                        {active
                          ? `${row.weight_modifier.toFixed(2)}× weight active`
                          : `Weight pending — ${needed} more outcome${needed !== 1 ? 's' : ''} needed`}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })()}

        {active === 'Goal' && (
          goalDescription ? (
            <div className="space-y-4">
              <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ov-text-hi)' }}>
                {goalDescription}
              </p>
              {goalContext && (
                <div className="pt-3" style={{ borderTop: '1px solid var(--ov-border)' }}>
                  <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--ov-text-dim)' }}>
                    Additional context
                  </p>
                  <p className="text-[12px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--ov-text-mid)' }}>
                    {goalContext}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[13px]" style={{ color: 'var(--ov-text-dim)' }}>
              No original description saved for this goal — it was likely created before this feature existed.
            </p>
          )
        )}
      </div>

      {(active === "What's affecting it" || active === 'What this Means' || active === 'What to do') && askWidget && (
        <div className="mt-4">
          {askWidget}
        </div>
      )}
    </div>
  )
}
