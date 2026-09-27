'use client'

import { ConciergePanel } from '@/components/concierge/ConciergePanel'
import { useAppStore } from '@/store/useAppStore'
import { useEffect } from 'react'
import type { VoiceTier } from '@/lib/voice/voiceTier'

interface ConciergePageProps {
  voiceTier: VoiceTier
  askCredits: number
}

export function ConciergePage({ voiceTier, askCredits }: ConciergePageProps) {
  const initVoiceState = useAppStore(s => s.initVoiceState)

  // Ensure Zustand voiceTier is in sync when navigating directly to this page
  useEffect(() => {
    initVoiceState({ voice_mode: undefined, tier: voiceTier === 'full' ? 'command' : voiceTier === 'brief' ? 'accelerator' : 'explorer' })
  }, [voiceTier, initVoiceState])

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[22px] font-medium" style={{ color: 'var(--text)' }}>Ask Meridian</h1>
        {askCredits > 0 && (
          <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--gray-lt)', color: 'var(--text3)' }}>
            {askCredits} credit{askCredits !== 1 ? 's' : ''} remaining
          </span>
        )}
      </div>
      <ConciergePanel />
    </div>
  )
}
