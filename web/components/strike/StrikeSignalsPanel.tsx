'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { NO_DATA_PROMPT } from '@/lib/strike/sweepStatus'
import { cardModel, groupSignals, type CardModel, type SignalGroup } from '@/lib/strike/signalCards'
import MoonIcon from './MoonIcon'

function sparklinePath(values: number[], w = 80, h = 24): string {
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w
    const y = h - ((v - min) / range) * h
    return `${x},${y}`
  })
  return `M${pts.join(' L')}`
}

const EST_TAG = 'text-xs text-amber-300 border border-amber-400 rounded px-1 ml-2 align-middle'

function SignalCard({ group }: { group: SignalGroup }) {
  const [expanded, setExpanded] = useState(false)
  const m: CardModel = cardModel(group)
  const h = m.header

  return (
    <div className="bg-slate-800 rounded-xl mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 px-4 py-3 min-h-[44px] text-left"
      >
        {h.kind === 'moon'
          ? <MoonIcon percent={h.moon.percent} waxing={h.moon.waxing} size={40} />
          : <span className="text-lg">{m.icon}</span>}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">{m.label}</div>
          {m.subtitle && <div className="text-xs text-slate-300">{m.subtitle}</div>}
          <div className="text-xs text-slate-300">
            {m.readingCount} reading{m.readingCount !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="text-right">
          {h.kind === 'nodata' && <span className="text-sm text-slate-200">No data</span>}
          {h.kind === 'value' && (
            <span className="text-sm font-mono text-slate-100">
              {h.primary}
              {h.secondary && <span className="text-xs text-slate-300 ml-1">{h.secondary}</span>}
              {h.estimated && <span className={EST_TAG}>estimated</span>}
            </span>
          )}
          {h.kind === 'moon' && (
            <span className="text-sm text-slate-100">
              {h.moon.headline}
              {h.estimated && <span className={EST_TAG}>estimated</span>}
            </span>
          )}
          {m.trend && (
            <span className={`text-sm ml-2 ${
              m.trend === '↑' ? 'text-emerald-400' : m.trend === '↓' ? 'text-amber-400' : 'text-slate-300'
            }`}>{m.trend}</span>
          )}
          <span className="text-slate-300 text-xs ml-2">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {(m.note || m.help) && (
        <div className="px-4 pb-3 -mt-1 text-xs text-slate-300">
          {m.note && <div>{m.note}</div>}
          {m.help && <div>{m.help}</div>}
        </div>
      )}

      {expanded && (
        <div className="px-4 pb-4">
          {h.kind === 'moon' && (
            <div className="mb-3 text-sm text-slate-100">
              {h.moon.detail && <div>{h.moon.detail}</div>}
              {h.moon.note && <div>{h.moon.note}</div>}
            </div>
          )}
          {m.scale && <div className="mb-3 text-xs text-slate-300">{m.scale}</div>}
          {m.spark.length >= 2 && (
            <div className="mb-3">
              <svg viewBox="0 0 80 24" className="w-full h-8" preserveAspectRatio="none">
                <path
                  d={sparklinePath(m.spark)}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          )}
          <div className="space-y-1">
            {m.rows.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-300 font-mono text-xs">
                  {new Date(r.at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className="text-slate-100 font-mono text-right">
                  {r.text}
                  {r.secondary && <span className="text-xs text-slate-300 ml-1">{r.secondary}</span>}
                  {r.estimated && !r.noData && <span className={EST_TAG}>estimated</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StrikeSignalsPanel({ objectiveId, emptyPrompt, stalePrompt }: {
  objectiveId: string
  // FF-098: the Run Sweep prompt, in place of the old "check back" text, and above old data.
  emptyPrompt?: ReactNode
  stalePrompt?: ReactNode
}) {
  const [groups, setGroups] = useState<SignalGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!objectiveId) return
    setLoading(true)
    fetch(`/api/strike/signals?objective_id=${encodeURIComponent(objectiveId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setGroups(groupSignals(d.signals ?? []))
      })
      .catch(() => setError('Failed to load signals'))
      .finally(() => setLoading(false))
  }, [objectiveId])

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Agent Signals</div>
        <div className="text-slate-500 text-sm">Loading signals…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Agent Signals</div>
        <div className="text-red-400 text-sm">{error}</div>
      </div>
    )
  }

  return <SignalsBody groups={groups} emptyPrompt={emptyPrompt} stalePrompt={stalePrompt} />
}

// Presentational: the loaded state. Exported so the empty and stale states can be checked without a browser.
export function SignalsBody({ groups, emptyPrompt, stalePrompt }: {
  groups: SignalGroup[]
  emptyPrompt?: ReactNode
  stalePrompt?: ReactNode
}) {
  return (
    <div className="p-4 pb-8">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Agent Signals</div>
      {groups.length === 0 ? (
        emptyPrompt ?? <div className="text-slate-100 text-sm">{NO_DATA_PROMPT}</div>
      ) : (
        <>
          {stalePrompt && <div className="mb-3">{stalePrompt}</div>}
          {groups.map(g => <SignalCard key={g.label} group={g} />)}
        </>
      )}
    </div>
  )
}
