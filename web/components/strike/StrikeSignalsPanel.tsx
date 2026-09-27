'use client'

import { useState, useEffect } from 'react'

type Signal = {
  id: string
  agent_key: string
  objective_id: string
  observed_value: number | null
  source: string
  recorded_at: string
}

type SignalGroup = {
  label: string
  icon: string
  signals: Signal[]
}

function getGroup(agentKey: string): { label: string; icon: string } {
  const k = agentKey.toUpperCase()
  if (k.includes('MOON'))    return { label: 'Moon Phase',   icon: '🌙' }
  if (k.includes('NOAA_TEMP')) return { label: 'Temperature', icon: '🌡' }
  if (k.includes('DROUGHT')) return { label: 'Drought',      icon: '🏜' }
  if (k.includes('FIRE'))    return { label: 'Fire Risk',    icon: '🔥' }
  if (k.includes('WINDY') || k.includes('WIND')) return { label: 'Wind', icon: '💨' }
  if (k.includes('USGS'))    return { label: 'Streamflow',   icon: '💧' }
  if (k.includes('DWR'))     return { label: 'Herd / Permits', icon: '🦌' }
  if (k.includes('INAT'))    return { label: 'Sightings',    icon: '👁' }
  if (k.includes('NOAA_PRECIP')) return { label: 'Precipitation', icon: '🌧' }
  if (k.includes('TERRAIN')) return { label: 'Terrain Intel', icon: '⛰' }
  if (k.includes('HATCH') || k.includes('FISH')) return { label: 'Fishing', icon: '🎣' }
  if (k.includes('SALMON') || k.includes('USACE')) return { label: 'Salmon Run', icon: '🐟' }
  return { label: agentKey.replace(/^OUTDOOR_/, '').replace(/_/g, ' '), icon: '📡' }
}

function groupSignals(signals: Signal[]): SignalGroup[] {
  const map = new Map<string, SignalGroup>()
  for (const s of signals) {
    const { label, icon } = getGroup(s.agent_key)
    if (!map.has(label)) map.set(label, { label, icon, signals: [] })
    map.get(label)!.signals.push(s)
  }
  return Array.from(map.values())
}

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

function SignalCard({ group }: { group: SignalGroup }) {
  const [expanded, setExpanded] = useState(false)
  const latest = group.signals[0]
  const values = group.signals
    .slice(0, 5)
    .map(s => Number(s.observed_value))
    .filter(v => !isNaN(v))
    .reverse()

  const latestVal = latest?.observed_value != null ? Number(latest.observed_value).toFixed(2) : '—'
  const trend = values.length >= 2
    ? values[values.length - 1] > values[0] ? '↑' : values[values.length - 1] < values[0] ? '↓' : '→'
    : ''

  return (
    <div className="bg-slate-800 rounded-xl mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-lg">{group.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white">{group.label}</div>
          <div className="text-xs text-slate-400">
            {group.signals.length} reading{group.signals.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-slate-200">{latestVal}</span>
          {trend && (
            <span className={`text-xs ${
              trend === '↑' ? 'text-emerald-400' : trend === '↓' ? 'text-amber-400' : 'text-slate-400'
            }`}>{trend}</span>
          )}
          <span className="text-slate-500 text-xs ml-1">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {values.length >= 2 && (
            <div className="mb-3">
              <svg viewBox="0 0 80 24" className="w-full h-8" preserveAspectRatio="none">
                <path
                  d={sparklinePath(values)}
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
            {group.signals.slice(0, 5).map(s => (
              <div key={s.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-mono">
                  {new Date(s.recorded_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </span>
                <span className="text-slate-200 font-mono">
                  {s.observed_value != null ? Number(s.observed_value).toFixed(2) : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function StrikeSignalsPanel({ objectiveId }: { objectiveId: string }) {
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

  return (
    <div className="p-4 pb-8">
      <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Agent Signals</div>
      {groups.length === 0 ? (
        <div className="text-slate-500 text-sm">
          Signals are building — check back after the next sweep.
        </div>
      ) : (
        groups.map(g => <SignalCard key={g.label} group={g} />)
      )}
    </div>
  )
}
