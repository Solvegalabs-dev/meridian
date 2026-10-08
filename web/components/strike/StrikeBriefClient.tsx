'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import StrikeHeader from './StrikeHeader'
import StrikePrepPanel from './StrikePrepPanel'
import StrikeBriefPanel from './StrikeBriefPanel'
import StrikeIntelPanel from './StrikeIntelPanel'
import StrikeSignalsPanel from './StrikeSignalsPanel'
import StrikeNotesPanel from './StrikeNotesPanel'
import OfflineBanner from './OfflineBanner'
import ObjectiveMenu from './ObjectiveMenu'
import RunSweepButton from './RunSweepButton'
import RunSweepPrompt from './RunSweepPrompt'
import { sweepPromptFor, emptyTabPrompt, type SweepInfo } from '@/lib/strike/sweepStatus'
import { useStrikeCache } from '@/hooks/useStrikeCache'
import type { WindowEvaluation } from '@/lib/objectives/windowState'
import { defaultStrikeTab, type StrikeTab } from '@/lib/strike/defaultTab'
import { checkForNewerBrief, type BriefRefreshResult } from '@/lib/strike/briefRefresh'
import { hasLocation } from '@/lib/agents/geoLocation'
import { isFishingObjective } from '@/lib/strike/objectiveKind'

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
  // objectives.notes, shown and edited on the Prep tab (FF-096).
  note?: string | null
  // FF-098: last sweep, when the next one is allowed, and the newest sweep data for this objective.
  sweep?: SweepInfo
  // False for a campaign unit: it cannot be removed from here yet (FF-096).
  canRemove?: boolean
  // False when no strike_briefs row exists; the brief object then holds placeholder fields.
  hasBrief: boolean
  evaluation: WindowEvaluation | null
}

export default function StrikeBriefClient({
  brief: initialBrief,
  objective,
  title,
  note = null,
  canRemove = false,
  sweep = { lastSweepAt: null, nextSweepAt: null, latestDataAt: null },
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

  // Read by refresh() so it compares against the brief on screen without re-creating the callback on every update.
  const briefRef = useRef(brief)
  useEffect(() => { briefRef.current = brief }, [brief])

  const refresh = useCallback(async (): Promise<BriefRefreshResult> => {
    const outcome = await checkForNewerBrief({
      objectiveId: arcObjectiveId,
      currentGeneratedAt: (briefRef.current?.brief_generated_at as string | null) ?? null,
      online: navigator.onLine,
    })
    // Only a validated, newer brief replaces the one on screen. Errors and "same" leave it alone.
    if (outcome.brief) {
      setBrief(outcome.brief)
      setBriefPresent(true)
    }
    return outcome.result
  }, [arcObjectiveId])

  useEffect(() => {
    const interval = setInterval(() => { void refresh() }, 30 * 60 * 1000)
    return () => clearInterval(interval)
  }, [refresh])

  // No sweep data, or old data: the tabs point at Run Sweep (nothing runs a user sweep on a schedule).
  const stale = sweepPromptFor(sweep.latestDataAt)
  const promptFor = (p: Parameters<typeof RunSweepPrompt>[0]['prompt']) => (
    <RunSweepPrompt prompt={p} lastSweepAt={sweep.lastSweepAt} nextSweepAt={sweep.nextSweepAt} />
  )
  const emptyPrompt = promptFor(emptyTabPrompt(sweep.latestDataAt))
  const stalePrompt = stale.kind === 'stale' ? promptFor(stale) : null

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
        <div className="flex items-center gap-1">
          <Link
            href={`/objectives/${arcObjectiveId}`}
            className="min-h-[44px] flex items-center text-sm text-blue-300 hover:text-blue-200 transition-colors"
          >
            Mission Control
          </Link>
          <ObjectiveMenu objectiveId={objective.id} title={title} canRemove={canRemove} />
        </div>
      </div>

      {/* One sweep covers every active objective. Same action as Mission Control. */}
      <div className="px-4 pb-1">
        <RunSweepButton lastSweepAt={sweep.lastSweepAt} nextSweepAt={sweep.nextSweepAt} />
      </div>

      <StrikeHeader
        title={title}
        huntCode={isFishingObjective(objective) ? null : (objective.hunt_code as string | null | undefined) ?? null}
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
          <StrikePrepPanel objective={objective as unknown as Record<string, unknown>} brief={displayBrief} title={title} note={note} />
        )}
        {activeTab === 'strike' && (
          <StrikeBriefPanel
            brief={displayBrief as Parameters<typeof StrikeBriefPanel>[0]['brief']}
            isOnline={isOnline}
            onRefresh={refresh}
            windowState={evaluation?.state ?? null}
            tripStart={evaluation?.state === 'upcoming' ? evaluation.detail.trip_start ?? null : null}
            noLocation={!hasLocation(objective as Parameters<typeof hasLocation>[0])}
            onGoToPrep={() => setActiveTab('prep')}
            emptyPrompt={emptyPrompt}
            stalePrompt={stalePrompt}
          />
        )}
        {activeTab === 'intel' && (
          <StrikeIntelPanel brief={displayBrief} objective={objective as unknown as Record<string, unknown>} emptyPrompt={emptyPrompt} stalePrompt={stalePrompt} />
        )}
        {activeTab === 'signals' && (
          <StrikeSignalsPanel objectiveId={arcObjectiveId} emptyPrompt={emptyPrompt} stalePrompt={stalePrompt} />
        )}
        {activeTab === 'notes' && (
          <StrikeNotesPanel objectiveId={arcObjectiveId} />
        )}
      </div>
    </div>
  )
}
