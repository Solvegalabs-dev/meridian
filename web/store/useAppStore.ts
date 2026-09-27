import { create } from 'zustand'
import { userVoiceTier, type VoiceTier } from '@/lib/voice/voiceTier'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'

interface AppState {
  voiceMode: boolean
  voiceTier: VoiceTier
  wakeWordActive: boolean
  drivingMode: boolean
  // FF-062: VoiceMeridian overlay state
  voiceMeridianOpen: boolean
  voiceMeridianWasOpen: boolean
  latestVoiceBrief: VoiceBrief | null
  // FF-063: voice personalization
  voiceType: string | null
  voiceRate: number
  voiceVolume: number
  voiceOnboarded: boolean
  pendingVoiceTaskCount: number
  briefReadyBadge: boolean
  lastBriefHeardAt: string | null
  setVoiceMode: (v: boolean) => void
  setWakeWordActive: (v: boolean) => void
  setDrivingMode: (v: boolean) => void
  setVoiceMeridianOpen: (v: boolean) => void
  setVoiceMeridianWasOpen: (v: boolean) => void
  setLatestVoiceBrief: (b: VoiceBrief | null) => void
  setVoicePreferences: (prefs: { voiceType?: string | null; voiceRate?: number; voiceVolume?: number }) => void
  setVoiceOnboarded: (v: boolean) => void
  setPendingVoiceTaskCount: (n: number) => void
  setBriefReadyBadge: (v: boolean) => void
  setLastBriefHeardAt: (v: string | null) => void
  initVoiceState: (profile: {
    voice_mode?: boolean | null
    tier?: string | null
    account_type?: string | null
    voice_addon?: boolean | null
    voice_type?: string | null
    voice_rate?: number | null
    voice_volume?: number | null
    voice_onboarded?: boolean | null
    last_brief_heard_at?: string | null
  }) => void
}

export const useAppStore = create<AppState>((set) => ({
  voiceMode: false,
  voiceTier: 'input',
  wakeWordActive: false,
  drivingMode: false,
  voiceMeridianOpen: false,
  voiceMeridianWasOpen: false,
  latestVoiceBrief: null,
  voiceType: null,
  voiceRate: 1.0,
  voiceVolume: 1.0,
  voiceOnboarded: false,
  pendingVoiceTaskCount: 0,
  briefReadyBadge: false,
  lastBriefHeardAt: null,
  setVoiceMode: (v) => set({ voiceMode: v }),
  setWakeWordActive: (v) => set({ wakeWordActive: v }),
  setDrivingMode: (v) => set({ drivingMode: v }),
  setVoiceMeridianOpen: (v) => set({ voiceMeridianOpen: v }),
  setVoiceMeridianWasOpen: (v) => set({ voiceMeridianWasOpen: v }),
  setLatestVoiceBrief: (b) => set({ latestVoiceBrief: b }),
  setVoicePreferences: (prefs) => set((s) => ({
    voiceType: prefs.voiceType !== undefined ? prefs.voiceType : s.voiceType,
    voiceRate: prefs.voiceRate !== undefined ? prefs.voiceRate : s.voiceRate,
    voiceVolume: prefs.voiceVolume !== undefined ? prefs.voiceVolume : s.voiceVolume,
  })),
  setVoiceOnboarded: (v) => set({ voiceOnboarded: v }),
  setPendingVoiceTaskCount: (n) => set({ pendingVoiceTaskCount: n }),
  setBriefReadyBadge: (v) => set({ briefReadyBadge: v }),
  setLastBriefHeardAt: (v) => set({ lastBriefHeardAt: v }),
  initVoiceState: (profile) => {
    set({
      voiceMode: profile.voice_mode ?? false,
      voiceTier: userVoiceTier({
        pricing_tier: profile.tier,
        account_type: profile.account_type,
        voice_addon: profile.voice_addon ?? false,
      }),
      voiceType: profile.voice_type ?? null,
      voiceRate: profile.voice_rate ?? 1.0,
      voiceVolume: profile.voice_volume ?? 1.0,
      voiceOnboarded: profile.voice_onboarded ?? false,
      lastBriefHeardAt: profile.last_brief_heard_at ?? null,
    })
  },
}))
