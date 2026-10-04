'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import StrikeHeader from './StrikeHeader'
import StrikePrepPanel from './StrikePrepPanel'
import StrikeBriefPanel from './StrikeBriefPanel'
import StrikeIntelPanel from './StrikeIntelPanel'
import StrikeSignalsPanel from './StrikeSignalsPanel'
import StrikeNotesPanel from './StrikeNotesPanel'
import OfflineBanner from './OfflineBanner'
import { useStrikeCache } from '@/hooks/useStrikeCache'
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { defaultStrikeTab, type StrikeTab } from '@/lib/strike/defaultTab'
import { hasStoredBrief } from '@/lib/strike/briefFreshness'

// "Brief" (not "Strike Brief") so five tabs fit at 375 px without truncation.
const TAB_LABELS: Record<StrikeTab, string> = {
  prep:    'Prep',
  strike:  'Brief',
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

type Props = {
  brief: Record<string, unknown>
  objective: ObjectiveProfile
  title: string
  // False when no strike_briefs row exists; the brief object then holds placeholder fields.
  hasBrief: boolean
  evaluation: WindowEvaluation | null
}

export default function StrikeBriefClient({
  brief: initialBrief,
  objective,
  title,
  hasBrief,
  evaluation,
}: Props) {
  const router = useRouter()
  const arcObjectiveId = (objective.objective_id ?? objective.id) as string

  const [activeTab, setActiveTab] = useState<StrikeTab>(() => defaultStrikeTab(evaluation?.state ?? null))

  const [brief, setBrief] = useState(initialBrief)
  // The server prop only covers the first load. A refresh can bring in a brief that did not exist then.
  const [briefPresent, setBriefPresent] = useState(hasBrief)
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

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      const res = await fetch(
        `/api/mip/brief?objective_id=${arcObjectiveId}&partner_key=strike`
      )
      const fresh = await res.json()
      setBrief(fresh)
      setBriefPresent(hasStoredBrief(fresh))
    } catch {}
  }, [arcObjectiveId])

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

      <div className="flex items-center justify-between gap-3 px-4 pt-2">
        <button
          onClick={() => router.push('/strike')}
          className="min-h-[44px] text-sm text-slate-200 hover:text-white transition-colors"
        >
          ← Objectives
        </button>
        <Link
          href={`/objectives/${arcObjectiveId}`}
          className="min-h-[44px] flex items-center text-sm text-blue-300 hover:text-blue-200 transition-colors"
        >
          Mission Control
        </Link>
      </div>

      <StrikeHeader
        title={title}
        taxonomyKey={objective.taxonomy_key ?? ''}
        evaluation={evaluation}
        hasBrief={briefPresent}
        brief={displayBrief}
        isOnline={isOnline}
      />

      {/* Tab bar: sticky so a long brief can switch tabs without scrolling back up */}
      <div className="sticky top-0 z-10 flex bg-slate-900 border-b border-slate-700">
        {(Object.keys(TAB_LABELS) as StrikeTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`flex-1 min-h-[44px] px-1 text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-slate-300 hover:text-white'
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
            windowState={evaluation?.state ?? null}
            tripStart={evaluation?.state === 'upcoming' ? evaluation.detail.trip_start ?? null : null}
          />
        )}
        {activeTab === 'intel' && (
          <StrikeIntelPanel brief={displayBrief} objective={objective as unknown as Record<string, unknown>} />
        )}
        {activeTab === 'signals' && (
          <StrikeSignalsPanel objectiveId={arcObjectiveId} />
        )}
        {activeTab === 'notes' && (
          <StrikeNotesPanel objectiveId={arcObjectiveId} />
        )}
      </div>
    </div>
  )
}
