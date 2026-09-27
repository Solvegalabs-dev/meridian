'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import ObjectiveCard from '@/components/objectives/ObjectiveCard'
import { ArchivedGoalRow } from '@/components/objectives/ArchivedGoalRow'
import { Objective } from '@/lib/utils/types'
import { canUseBrief, type VoiceTier } from '@/lib/voice/voiceTier'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'
import { VoiceBriefPlayer } from '@/components/voice/VoiceBriefPlayer'
import { ActionRunner } from '@/components/voice/ActionRunner'

type Tab = 'active' | 'archived' | 'all'

interface OutcomeData {
  outcome_type: string | null
  outcome_note: string | null
  actual_completed_at: string | null
  swept_at_close: number | null
  prediction_id: string | null
  recorded_at: string
}

type ObjectiveWithOutcome = Objective & {
  objective_outcomes?: OutcomeData[] | null
}

interface Props {
  objectives: ObjectiveWithOutcome[]
  error: string | null
  alertObjectiveIds?: Set<string>
  voiceTier?: VoiceTier
  voiceBrief?: VoiceBrief | null
}

export default function ObjectivesClient({ objectives, error, alertObjectiveIds, voiceTier, voiceBrief }: Props) {
  const [tab, setTab] = useState<Tab>('active')
  const [voicePhase, setVoicePhase] = useState<'idle' | 'brief' | 'runner' | 'done'>('idle')
  const showVoiceEntry = canUseBrief(voiceTier ?? 'input') && voiceBrief && voiceBrief.taskers.length > 0

  const active   = objectives.filter(o => o.status === 'active' || o.status === 'paused')
  const archived = objectives.filter(o =>
    o.status === 'closed' || o.status === 'achieved' ||
    o.status === 'abandoned' || o.status === 'archived'
  )

  // Sort archived: most recently closed first
  const archivedSorted = [...archived].sort((a, b) => {
    const dateA = a.objective_outcomes?.[0]?.actual_completed_at ?? a.updated_at
    const dateB = b.objective_outcomes?.[0]?.actual_completed_at ?? b.updated_at
    return new Date(dateB).getTime() - new Date(dateA).getTime()
  })

  const displayed = tab === 'active'
    ? active
    : tab === 'archived'
    ? archivedSorted
    : objectives

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'active',   label: 'Active',   count: active.length },
    { id: 'archived', label: 'Archived', count: archived.length },
    { id: 'all',      label: 'All',      count: objectives.length },
  ]

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[22px] font-medium text-[var(--text)]">Goals</h1>
        <Link
          href="/objectives/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-[var(--night)] transition-colors"
        >
          <Plus size={14} />
          Add goal
        </Link>
      </div>

      {/* Voice session widget */}
      {showVoiceEntry && voiceBrief && voicePhase === 'idle' && (
        <div className="mb-5 rounded-2xl border border-[var(--border)] p-4 flex items-center justify-between" style={{ backgroundColor: 'rgba(46,124,184,0.04)' }}>
          <div>
            <p className="text-[13px] font-medium" style={{ color: 'var(--text)' }}>Voice Brief ready</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text3)' }}>
              {voiceBrief.taskers.length} tasker{voiceBrief.taskers.length !== 1 ? 's' : ''} from your last sweep
            </p>
          </div>
          <button
            onClick={() => setVoicePhase('brief')}
            className="px-4 py-2 rounded-lg text-[13px] font-medium"
            style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
          >
            Play Brief
          </button>
        </div>
      )}
      {showVoiceEntry && voiceBrief && voicePhase === 'brief' && (
        <div className="mb-5 rounded-2xl border border-[var(--border)] p-4">
          <VoiceBriefPlayer brief={voiceBrief} onTaskersReady={() => setVoicePhase('runner')} />
        </div>
      )}
      {showVoiceEntry && voiceBrief && voicePhase === 'runner' && (
        <div className="mb-5 rounded-2xl border border-[var(--border)] p-4">
          <ActionRunner brief={voiceBrief} onComplete={() => setVoicePhase('done')} />
        </div>
      )}
      {voicePhase === 'done' && (
        <div className="mb-5 rounded-2xl border border-[var(--border)] p-4">
          <p className="text-[13px] font-medium" style={{ color: 'var(--green)' }}>✓ Voice session complete</p>
        </div>
      )}

      {/* Tab links */}
      <div className="flex items-center gap-6 mb-6">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`group flex items-baseline gap-1.5 text-[11px] font-semibold tracking-widest uppercase transition-colors ${
              tab === t.id
                ? 'text-[var(--blue)]'
                : 'text-[var(--text3)] hover:text-[var(--blue)]'
            }`}
          >
            <span className={tab === t.id ? '' : 'group-hover:animate-pulse'}>
              {t.label}
            </span>
            <span className={`text-[10px] font-normal tracking-normal normal-case ${
              tab === t.id ? 'text-[var(--blue)]' : 'text-[var(--text3)]'
            }`}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-[var(--red-lt)] text-[var(--red)] text-[13px]">
          Error loading goals: {error}
        </div>
      )}

      {tab === 'archived' ? (
        archivedSorted.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[var(--border)] p-12 text-center">
            <h2 className="text-[16px] font-medium text-[var(--text)] mb-2">No archived goals yet</h2>
            <p className="text-[13px] text-[var(--text2)]">
              When you close or abandon a goal, it will appear here.
            </p>
          </div>
        ) : (
          <div>
            {/* Column headers */}
            <div className="grid gap-3 px-4 pb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text3)]" style={{ gridTemplateColumns: '1fr 100px 120px 100px 40px' }}>
              <span>Goal</span>
              <span>Outcome</span>
              <span>Confidence at close</span>
              <span>Closed</span>
              <span />
            </div>
            <div className="flex flex-col gap-2">
              {archivedSorted.map(obj => (
                <ArchivedGoalRow key={obj.id} goal={obj} />
              ))}
            </div>
          </div>
        )
      ) : displayed.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[var(--border)] p-12 text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--gray-lt)] flex items-center justify-center mx-auto mb-4">
            <Plus size={24} className="text-[var(--text3)]" />
          </div>
          {tab === 'active' ? (
            <>
              <h2 className="text-[16px] font-medium text-[var(--text)] mb-2">No active goals</h2>
              <p className="text-[13px] text-[var(--text2)] mb-5">Add your first goal to start tracking your progress.</p>
              <Link
                href="/objectives/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-navy text-white text-[13px] font-medium hover:bg-[var(--night)] transition-colors"
              >
                <Plus size={14} />
                Add first goal
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-[16px] font-medium text-[var(--text)] mb-2">No goals yet</h2>
              <p className="text-[13px] text-[var(--text2)]">Add your first goal to get started.</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayed.map(obj => (
            <ObjectiveCard key={obj.id} obj={obj} hasAlert={alertObjectiveIds?.has(obj.id) ?? false} />
          ))}
        </div>
      )}
    </div>
  )
}
