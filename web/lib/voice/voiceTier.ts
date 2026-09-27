export type VoiceTier = 'none' | 'input' | 'brief' | 'full'

export function userVoiceTier(profile: {
  pricing_tier?: string | null
  account_type?: string | null
  voice_addon?: boolean
}): VoiceTier {
  const tier = profile.pricing_tier ?? profile.account_type
  if (tier === 'command') return 'full'
  if (tier === 'accelerator') return 'brief'
  if (tier === 'explorer' && profile.voice_addon) return 'brief'
  if (tier === 'explorer') return 'input'
  if (profile.voice_addon) return 'brief'
  return 'input' // Trial and unknown — mic input free
}

export const canUseBrief = (t: VoiceTier) => t === 'brief' || t === 'full'
export const canUseFull = (t: VoiceTier) => t === 'full'
