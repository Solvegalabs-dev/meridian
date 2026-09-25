'use client'

import { useState, useEffect } from 'react'
import { isFishingTaxonomyKey, FISHING_PREP_PHASES } from '@/lib/strike/config/fishing-taxonomy'

type Cadence = 'monthly' | 'biweekly' | 'weekly'

type Props = {
  objective: Record<string, unknown>
  brief: Record<string, unknown> | null
}

type ArcStep = { label: string; icon: string; status: 'done' | 'active' | 'future' }

function fmt(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateMinusDays(base: string, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() - days)
  return fmt(d)
}

function datePlusDays(base: string, days: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return fmt(d)
}

// ─── Fishing prep ────────────────────────────────────────────────────────────

type FishingPhase = 'pre_season' | 'pre_run' | 'peak_run' | 'tail_end'
const FISHING_PHASES = ['pre_season', 'pre_run', 'peak_run', 'tail_end'] as const

function getFishingCurrentPhase(tripStart: string): FishingPhase {
  const daysOut = Math.floor((new Date(tripStart).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysOut > 90) return 'pre_season'
  if (daysOut > 14) return 'pre_run'
  if (daysOut >= 0) return 'peak_run'
  return 'tail_end'
}

function getFishingArcSteps(tripStart: string, tripEnd?: string): ArcStep[] {
  const now = new Date()
  const start = new Date(tripStart)
  const end = tripEnd ? new Date(tripEnd) : new Date(start.getTime() + 7 * 86400000)
  const daysOut = Math.floor((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  const pastTrip = now > end

  if (pastTrip) return [
    { label: 'License + permits',    icon: '📋', status: 'done' },
    { label: 'Water scouting',       icon: '🎣', status: 'done' },
    { label: 'Conditions baseline',  icon: '📡', status: 'done' },
    { label: 'Daily brief active',   icon: '⚡', status: 'done' },
    { label: 'Catch outcome scored', icon: '✅', status: 'active' },
  ]

  if (now >= start) return [
    { label: 'License + permits',    icon: '📋', status: 'done' },
    { label: 'Water scouting',       icon: '🎣', status: 'done' },
    { label: 'Conditions baseline',  icon: '📡', status: 'done' },
    { label: 'Daily brief active',   icon: '⚡', status: 'active' },
    { label: 'Catch outcome scored', icon: '✅', status: 'future' },
  ]

  if (daysOut <= 14) return [
    { label: 'License + permits',    icon: '📋', status: 'done' },
    { label: 'Water scouting',       icon: '🎣', status: 'done' },
    { label: 'Conditions baseline',  icon: '📡', status: 'active' },
    { label: 'Daily brief active',   icon: '⚡', status: 'future' },
    { label: 'Catch outcome scored', icon: '✅', status: 'future' },
  ]

  if (daysOut <= 60) return [
    { label: 'License + permits',    icon: '📋', status: 'done' },
    { label: 'Water scouting',       icon: '🎣', status: 'active' },
    { label: 'Conditions baseline',  icon: '📡', status: 'future' },
    { label: 'Daily brief active',   icon: '⚡', status: 'future' },
    { label: 'Catch outcome scored', icon: '✅', status: 'future' },
  ]

  return [
    { label: 'License + permits',    icon: '📋', status: 'active' },
    { label: 'Water scouting',       icon: '🎣', status: 'future' },
    { label: 'Conditions baseline',  icon: '📡', status: 'future' },
    { label: 'Daily brief active',   icon: '⚡', status: 'future' },
    { label: 'Catch outcome scored', icon: '✅', status: 'future' },
  ]
}

function FishingPrepContent({ objective }: { objective: Record<string, unknown> }) {
  const timing = (objective.timing as { trip_start?: string; trip_end?: string }) ?? {}
  const tripStart = timing.trip_start ?? ''
  const objectiveId = (objective.objective_id ?? objective.id) as string

  const currentPhase: FishingPhase = tripStart ? getFishingCurrentPhase(tripStart) : 'pre_season'
  const [activePhase, setActivePhase] = useState<FishingPhase>(currentPhase)
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [checks, setChecks] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`strike_cadence_${objectiveId}`) as Cadence | null
      if (stored) setCadence(stored)
    } catch {}
  }, [objectiveId])

  const saveCadence = (c: Cadence) => {
    setCadence(c)
    try { localStorage.setItem(`strike_cadence_${objectiveId}`, c) } catch {}
  }

  const taskKey = `strike_tasks_${objectiveId}_${activePhase}`
  useEffect(() => {
    try {
      const stored = localStorage.getItem(taskKey)
      if (stored) setChecks(JSON.parse(stored))
      else setChecks({})
    } catch { setChecks({}) }
  }, [taskKey])

  const toggleCheck = (i: number) => {
    setChecks(prev => {
      const next = { ...prev, [i]: !prev[i] }
      try { localStorage.setItem(taskKey, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const arcSteps = tripStart ? getFishingArcSteps(tripStart, timing.trip_end) : []
  const activePhaseDef = FISHING_PREP_PHASES[activePhase]

  return (
    <div className="pb-8">
      {/* Annual Intelligence Arc */}
      {arcSteps.length > 0 && (
        <div className="px-4 pt-4 pb-5">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Annual Intelligence Arc</div>
          <div className="flex items-start gap-0">
            {arcSteps.map((step, i) => (
              <div key={i} className="flex-1 flex flex-col items-center text-center relative">
                {i < arcSteps.length - 1 && (
                  <div className={`absolute top-3 left-1/2 w-full h-px ${
                    step.status === 'done' ? 'bg-emerald-600' : 'bg-slate-700'
                  }`} />
                )}
                <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs mb-1 ${
                  step.status === 'done'   ? 'bg-emerald-700 text-white' :
                  step.status === 'active' ? 'bg-blue-600 text-white ring-2 ring-blue-400' :
                                             'bg-slate-700 text-slate-500'
                }`}>
                  {step.status === 'done' ? '✓' : step.icon}
                </div>
                <div className={`text-[10px] leading-tight mt-1 px-0.5 ${
                  step.status === 'active' ? 'text-blue-300' :
                  step.status === 'done'   ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase nav */}
      <div className="flex gap-1 px-4 mb-4">
        {FISHING_PHASES.map(p => (
          <button
            key={p}
            onClick={() => setActivePhase(p)}
            className={`flex-1 text-xs py-1.5 rounded font-medium transition-colors ${
              activePhase === p
                ? p === currentPhase
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {FISHING_PREP_PHASES[p].label}
            {p === currentPhase && (
              <span className="ml-1 text-blue-300">·</span>
            )}
          </button>
        ))}
      </div>

      {/* Phase card */}
      <div className="mx-4 bg-slate-800 rounded-xl p-4 mb-4">
        <div className="font-semibold text-white text-sm mb-1">{activePhaseDef.label}</div>
        <p className="text-xs text-slate-400 mb-4">{activePhaseDef.description}</p>

        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Tasks</div>
        <div className="space-y-2">
          {activePhaseDef.tasks.map((task, i) => (
            <button
              key={i}
              onClick={() => toggleCheck(i)}
              className="w-full flex items-start gap-2 text-left"
            >
              <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs transition-colors ${
                checks[i]
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-600 bg-slate-700'
              }`}>
                {checks[i] && '✓'}
              </div>
              <span className={`text-sm ${checks[i] ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                {task}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Brief cadence */}
      <div className="mx-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Brief cadence</div>
        <div className="flex gap-2">
          {(['monthly', 'biweekly', 'weekly'] as Cadence[]).map(c => (
            <button
              key={c}
              onClick={() => saveCadence(c)}
              className={`flex-1 text-xs py-2 rounded border transition-colors ${
                cadence === c
                  ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {c === 'biweekly' ? 'Bi-weekly' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Elk prep (existing logic) ────────────────────────────────────────────────

type Phase = 'scouting' | 'prerut' | 'opener' | 'peakrut'

function getCurrentPhase(tripStart: string): Phase {
  const opener = new Date(tripStart)
  const now = new Date()
  const daysOut = Math.floor((opener.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (daysOut > 60) return 'scouting'
  if (daysOut > 21) return 'prerut'
  if (daysOut > 0)  return 'opener'
  return 'peakrut'
}

const PHASE_DEFS = {
  scouting: {
    label: 'Scouting',
    dateRange: (t: string) => `Jul 15 – ${dateMinusDays(t, 60)}`,
    description: 'Water source mapping, herd location, unit familiarization.',
    tasks: [
      'Glass upper basin water sources dawn and dusk',
      'Locate active wallows and wallow clusters',
      'Confirm access routes — note 4WD requirements',
      'Review recent burn scars for elk staging areas',
    ],
  },
  prerut: {
    label: 'Pre-rut',
    dateRange: (t: string) => `${dateMinusDays(t, 60)} – ${dateMinusDays(t, 21)}`,
    description: 'Bulls separating from bachelor groups. Monitor bugling onset.',
    tasks: [
      'Monitor bugling onset — note time and elevation',
      'Track cold front timing — activity spikes within 48h',
      'Confirm water source consolidation from drought',
      'Locate primary wallow — check for daily use',
    ],
  },
  opener: {
    label: 'Opener',
    dateRange: (t: string) => `${fmt(new Date(t))} – ${datePlusDays(t, 7)}`,
    description: 'Early rut transition. Bulls locating cows, not yet committed.',
    tasks: [
      'Glass upper basin water sources dawn and dusk',
      'Locate active wallows at target elevation band',
      'Monitor bugling — note elevation and time of day',
      'Confirm wind advantage before committing approach',
    ],
  },
  peakrut: {
    label: 'Peak rut',
    dateRange: (t: string) => `${datePlusDays(t, 7)} – ${datePlusDays(t, 21)}`,
    description: 'Bulls committed to cows. Switch from locate to intercept.',
    tasks: [
      'Switch to intercept strategy — bulls committed to cows',
      'Cow call + estrus bleat most effective in this window',
      'Monitor thermals — rutting bulls move unpredictably',
      'Watch for satellite bulls near timber edges',
    ],
  },
}

const PHASES = ['scouting', 'prerut', 'opener', 'peakrut'] as const

function getArcSteps(tripStart: string, tripEnd?: string): ArcStep[] {
  const now = new Date()
  const start = new Date(tripStart)
  const end = tripEnd ? new Date(tripEnd) : new Date(start.getTime() + 14 * 86400000)

  const month = now.getMonth()
  const pastTrip = now > end

  const active = (condition: boolean) => condition ? 'active' : 'future'
  const done = 'done' as const

  if (pastTrip) {
    return [
      { label: 'Draw application', icon: '📋', status: done },
      { label: 'Tag confirmed',    icon: '🏷',  status: done },
      { label: 'Conditions baseline', icon: '📡', status: done },
      { label: 'Daily Strike Brief',  icon: '⚡', status: done },
      { label: 'Harvest outcome',     icon: '🦌', status: 'active' },
    ]
  }

  if (now >= start) {
    return [
      { label: 'Draw application',    icon: '📋', status: done },
      { label: 'Tag confirmed',       icon: '🏷',  status: done },
      { label: 'Conditions baseline', icon: '📡', status: done },
      { label: 'Daily Strike Brief',  icon: '⚡', status: 'active' },
      { label: 'Harvest outcome',     icon: '🦌', status: 'future' },
    ]
  }

  if (month >= 6) {
    return [
      { label: 'Draw application',    icon: '📋', status: done },
      { label: 'Tag confirmed',       icon: '🏷',  status: done },
      { label: 'Conditions baseline', icon: '📡', status: done },
      { label: 'Daily Strike Brief',  icon: '⚡', status: active(month >= 8) },
      { label: 'Harvest outcome',     icon: '🦌', status: 'future' },
    ]
  }

  if (month >= 3) {
    return [
      { label: 'Draw application',    icon: '📋', status: done },
      { label: 'Tag confirmed',       icon: '🏷',  status: 'active' },
      { label: 'Conditions baseline', icon: '📡', status: 'future' },
      { label: 'Daily Strike Brief',  icon: '⚡', status: 'future' },
      { label: 'Harvest outcome',     icon: '🦌', status: 'future' },
    ]
  }

  return [
    { label: 'Draw application',    icon: '📋', status: 'active' },
    { label: 'Tag confirmed',       icon: '🏷',  status: 'future' },
    { label: 'Conditions baseline', icon: '📡', status: 'future' },
    { label: 'Daily Strike Brief',  icon: '⚡', status: 'future' },
    { label: 'Harvest outcome',     icon: '🦌', status: 'future' },
  ]
}

function ElkPrepContent({ objective }: { objective: Record<string, unknown> }) {
  const timing = (objective.timing as { trip_start?: string; trip_end?: string }) ?? {}
  const tripStart = timing.trip_start ?? ''
  const objectiveId = (objective.objective_id ?? objective.id) as string

  const currentPhase: Phase = tripStart ? getCurrentPhase(tripStart) : 'scouting'

  const [activePhase, setActivePhase] = useState<Phase>(currentPhase)
  const [cadence, setCadence] = useState<Cadence>('weekly')
  const [checks, setChecks] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`strike_cadence_${objectiveId}`) as Cadence | null
      if (stored) setCadence(stored)
    } catch {}
  }, [objectiveId])

  const saveCadence = (c: Cadence) => {
    setCadence(c)
    try { localStorage.setItem(`strike_cadence_${objectiveId}`, c) } catch {}
  }

  const taskKey = `strike_tasks_${objectiveId}_${activePhase}`
  useEffect(() => {
    try {
      const stored = localStorage.getItem(taskKey)
      if (stored) setChecks(JSON.parse(stored))
      else setChecks({})
    } catch { setChecks({}) }
  }, [taskKey])

  const toggleCheck = (i: number) => {
    setChecks(prev => {
      const next = { ...prev, [i]: !prev[i] }
      try { localStorage.setItem(taskKey, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const arcSteps = tripStart ? getArcSteps(tripStart, timing.trip_end) : []
  const activePhaseDef = PHASE_DEFS[activePhase]

  return (
    <div className="pb-8">
      {/* Annual Arc */}
      {arcSteps.length > 0 && (
        <div className="px-4 pt-4 pb-5">
          <div className="text-xs text-slate-400 uppercase tracking-wider mb-3">Annual Intelligence Arc</div>
          <div className="flex items-start gap-0">
            {arcSteps.map((step, i) => (
              <div key={i} className="flex-1 flex flex-col items-center text-center relative">
                {i < arcSteps.length - 1 && (
                  <div className={`absolute top-3 left-1/2 w-full h-px ${
                    step.status === 'done' ? 'bg-emerald-600' : 'bg-slate-700'
                  }`} />
                )}
                <div className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs mb-1 ${
                  step.status === 'done'   ? 'bg-emerald-700 text-white' :
                  step.status === 'active' ? 'bg-blue-600 text-white ring-2 ring-blue-400' :
                                             'bg-slate-700 text-slate-500'
                }`}>
                  {step.status === 'done' ? '✓' : step.icon}
                </div>
                <div className={`text-[10px] leading-tight mt-1 px-0.5 ${
                  step.status === 'active' ? 'text-blue-300' :
                  step.status === 'done'   ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  {step.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Phase nav */}
      <div className="flex gap-1 px-4 mb-4">
        {PHASES.map(p => (
          <button
            key={p}
            onClick={() => setActivePhase(p)}
            className={`flex-1 text-xs py-1.5 rounded font-medium transition-colors ${
              activePhase === p
                ? p === currentPhase
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {PHASE_DEFS[p].label}
            {p === currentPhase && (
              <span className="ml-1 text-blue-300">·</span>
            )}
          </button>
        ))}
      </div>

      {/* Phase card */}
      <div className="mx-4 bg-slate-800 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between mb-1">
          <div className="font-semibold text-white text-sm">{activePhaseDef.label}</div>
          {tripStart && (
            <div className="text-xs text-slate-400 ml-2 text-right">
              {activePhaseDef.dateRange(tripStart)}
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400 mb-4">{activePhaseDef.description}</p>

        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Tasks</div>
        <div className="space-y-2">
          {activePhaseDef.tasks.map((task, i) => (
            <button
              key={i}
              onClick={() => toggleCheck(i)}
              className="w-full flex items-start gap-2 text-left"
            >
              <div className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs transition-colors ${
                checks[i]
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'border-slate-600 bg-slate-700'
              }`}>
                {checks[i] && '✓'}
              </div>
              <span className={`text-sm ${checks[i] ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                {task}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Brief cadence */}
      <div className="mx-4">
        <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">Brief cadence</div>
        <div className="flex gap-2">
          {(['monthly', 'biweekly', 'weekly'] as Cadence[]).map(c => (
            <button
              key={c}
              onClick={() => saveCadence(c)}
              className={`flex-1 text-xs py-2 rounded border transition-colors ${
                cadence === c
                  ? 'border-blue-500 bg-blue-900/40 text-blue-300'
                  : 'border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {c === 'biweekly' ? 'Bi-weekly' : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Router ───────────────────────────────────────────────────────────────────

export default function StrikePrepPanel({ objective }: Props) {
  const taxonomyKey = (objective.taxonomy_key as string) ?? ''
  if (isFishingTaxonomyKey(taxonomyKey)) return <FishingPrepContent objective={objective} />
  return <ElkPrepContent objective={objective} />
}
