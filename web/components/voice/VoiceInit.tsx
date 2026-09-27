'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/useAppStore'
import { WakeWordListener } from './WakeWordListener'
import { FloatingVoiceButton } from './FloatingVoiceButton'
import type { VoiceTier } from '@/lib/voice/voiceTier'

interface VoiceInitProps {
  voiceTier: VoiceTier
  voiceMode: boolean
  tier?: string | null
  accountType?: string | null
  voiceAddon?: boolean
  voiceType?: string | null
  voiceRate?: number
  voiceVolume?: number
  voiceOnboarded?: boolean
  lastBriefHeardAt?: string | null
}

export function VoiceInit({ voiceTier, voiceMode, tier, accountType, voiceAddon, voiceType, voiceRate, voiceVolume, voiceOnboarded, lastBriefHeardAt }: VoiceInitProps) {
  const initVoiceState = useAppStore(s => s.initVoiceState)

  useEffect(() => {
    initVoiceState({
      voice_mode: voiceMode,
      tier,
      account_type: accountType,
      voice_addon: voiceAddon ?? false,
      voice_type: voiceType ?? null,
      voice_rate: voiceRate ?? 1.0,
      voice_volume: voiceVolume ?? 1.0,
      voice_onboarded: voiceOnboarded ?? false,
      last_brief_heard_at: lastBriefHeardAt ?? null,
    })
  }, [voiceMode, tier, accountType, voiceAddon, voiceType, voiceRate, voiceVolume, voiceOnboarded, lastBriefHeardAt, initVoiceState])

  return (
    <>
      {voiceTier === 'full' && voiceMode && <WakeWordListener />}
      <FloatingVoiceButton />
    </>
  )
}
