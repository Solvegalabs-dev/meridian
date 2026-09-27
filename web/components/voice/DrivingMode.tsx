'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '@/store/useAppStore'
import { speak, stopSpeaking } from '@/lib/voice/ttsEngine'
import { ActionRunner } from './ActionRunner'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'

interface DrivingModeProps {
  brief: VoiceBrief
  onExit: () => void
}

export function DrivingMode({ brief, onExit }: DrivingModeProps) {
  const setDrivingMode = useAppStore(s => s.setDrivingMode)

  useEffect(() => {
    setDrivingMode(true)
    void speak(`Driving mode active. ${brief.taskers.length} item${brief.taskers.length !== 1 ? 's' : ''} waiting.`)
    return () => {
      setDrivingMode(false)
      stopSpeaking()
    }
  }, [brief.taskers.length, setDrivingMode])

  function handleComplete() {
    void speak('All done. Drive safe.', onExit)
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ backgroundColor: '#0F1E35' }}
    >
      {/* Exit button — always visible, 44px tap target */}
      <button
        onClick={() => {
          stopSpeaking()
          onExit()
        }}
        aria-label="Exit driving mode"
        className="absolute top-4 right-4 flex items-center justify-center rounded-full"
        style={{ width: 44, height: 44, backgroundColor: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
      >
        <X size={20} />
      </button>

      <p
        className="absolute top-5 left-5 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: '#7ab3e0' }}
      >
        Driving Mode
      </p>

      {/* ActionRunner — renders in center; drivingMode enforces safety rules */}
      <div className="w-full max-w-sm">
        <ActionRunner
          brief={brief}
          onComplete={handleComplete}
          drivingMode={true}
        />
      </div>
    </div>
  )
}
