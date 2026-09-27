'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import StrikeHeader from './StrikeHeader'
import StrikePrepPanel from './StrikePrepPanel'
import StrikeBriefPanel from './StrikeBriefPanel'
import StrikeIntelPanel from './StrikeIntelPanel'
import StrikeSignalsPanel from './StrikeSignalsPanel'
import StrikeNotesPanel from './StrikeNotesPanel'
import OfflineBanner from './OfflineBanner'
import { useStrikeCache } from '@/hooks/useStrikeCache'

type Tab = 'prep' | 'strike' | 'intel' | 'signals' | 'notes'

const TAB_LABELS: Record<Tab, string> = {
  prep:    'Prep',
  strike:  'Strike Brief',
  intel:   'Intel',
  signals: 'Signals',
  notes:   'Notes',
}

type ObjectiveProfile = {
  id: string
  objective_id?: string | null
  taxonomy_key: string
  geo: Record<string, unknown>
  timing: { trip_start?: string; trip_end?: string; [k: string]: unknown }
  assigned_agents: string[]
  agent_build_status: string
  [k: string]: unknown
}

export default function StrikeBriefClient({
  brief: initialBrief,
  objective,
}: {
  brief: Record<string, unknown>
  objective: ObjectiveProfile
}) {
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const opener = objective.timing?.trip_start ? new Date(objective.timing.trip_start) : null
    if (opener) {
      const weeksOut = (opener.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 7)
      return weeksOut > 4 ? 'prep' : 'strike'
    }
    return 'strike'
  })

  const [brief, setBrief] = useState(initialBrief)
  const [isOnline, setIsOnline] = useState(true)
  const { cachedBrief, cacheBrief } = useStrikeCache(objective.id)

  useEffect(() => {
    if (brief?.summary) cacheBrief(brief)
  }, [brief]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online',  handleOnline)
    window.addEventListener('offline', handleOffline)
    setIsOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online',  handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const refreshObjectiveId = (objective.objective_id ?? objective.id) as string
  const refresh = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const res = await fetch(
        `/api/mip/brief?objective_id=${refreshObjectiveId}&partner_key=strike`
      )
      const fresh = await res.json()
      setBrief(fresh)
    } catch {}
  }, [refreshObjectiveId])

  useEffect(() => {
    const interval = setInterval(refresh, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [refresh])

  const displayBrief = isOnline ? brief : (cachedBrief as unknown as Record<string, unknown> | null ?? brief)

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {!isOnline && (
        <OfflineBanner cachedAt={(cachedBrief as { cached_at?: string } | null)?.cached_at} />
      )}

      <button
        onClick={() => router.push('/strike')}
        className="strike-back-btn"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          fontSize: 13,
          color: 'var(--text-secondary, #7aad8a)',
          cursor: 'pointer',
          padding: '8px 16px 4px',
          fontFamily: 'inherit',
        }}
      >
        ← Objectives
      </button>

      <StrikeHeader
        objective={objective as unknown as Record<string, unknown>}
        brief={displayBrief}
        isOnline={isOnline}
      />

      {/* Tab bar */}
      <div className="flex border-b border-slate-700">
        {(Object.keys(TAB_LABELS) as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 text-sm py-3 font-medium transition-colors ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'prep' && (
          <StrikePrepPanel objective={objective as unknown as Record<string, unknown>} brief={displayBrief} />
        )}
        {activeTab === 'strike' && (
          <StrikeBriefPanel
            brief={displayBrief as Parameters<typeof StrikeBriefPanel>[0]['brief']}
            isOnline={isOnline}
            onRefresh={refresh}
          />
        )}
        {activeTab === 'intel' && (
          <StrikeIntelPanel brief={displayBrief} objective={objective as unknown as Record<string, unknown>} />
        )}
        {activeTab === 'signals' && (
          <StrikeSignalsPanel objectiveId={(objective.objective_id ?? objective.id) as string} />
        )}
        {activeTab === 'notes' && (
          <StrikeNotesPanel objectiveId={(objective.objective_id ?? objective.id) as string} />
        )}
      </div>
    </div>
  )
}
