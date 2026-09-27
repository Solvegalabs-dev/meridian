'use client'

import { useState } from 'react'
import { DrivingMode } from './DrivingMode'
import { DeferredTasksBanner } from './DeferredTasksBanner'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'

interface DrivingModeEntryProps {
  voiceBrief: VoiceBrief
}

export function DrivingModeEntry({ voiceBrief }: DrivingModeEntryProps) {
  const [driving, setDriving] = useState(false)

  return (
    <>
      <DeferredTasksBanner />

      <button
        onClick={() => setDriving(true)}
        className="w-full rounded-2xl text-[15px] font-semibold py-4 transition-opacity hover:opacity-90"
        style={{ backgroundColor: 'var(--blue)', color: '#fff' }}
      >
        Start Driving Mode
      </button>

      {driving && (
        <DrivingMode
          brief={voiceBrief}
          onExit={() => setDriving(false)}
        />
      )}
    </>
  )
}
