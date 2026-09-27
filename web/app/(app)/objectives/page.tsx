import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import ObjectivesClient from './ObjectivesClient'
import { userVoiceTier } from '@/lib/voice/voiceTier'
import type { VoiceBrief } from '@/lib/voice/voiceBriefTypes'

export default async function ObjectivesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: objectives, error }, { data: unseenAlerts }, { data: profile }, { data: latestSweep }] = await Promise.all([
    supabase
      .from('objectives')
      .select('*, objective_outcomes(outcome_type, outcome_note, actual_completed_at, swept_at_close, prediction_id, recorded_at)')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('watch_alerts')
      .select('objective_id')
      .eq('user_id', user.id)
      .is('user_seen_at', null),
    supabase
      .from('profiles')
      .select('tier, account_type, voice_addon, voice_mode')
      .eq('id', user.id)
      .single(),
    supabase
      .from('sweeps')
      .select('voice_brief')
      .eq('user_id', user.id)
      .eq('status', 'complete')
      .not('voice_brief', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single(),
  ])

  const alertObjectiveIds = new Set(
    (unseenAlerts ?? []).map(a => a.objective_id as string).filter(Boolean)
  )

  const voiceTier = userVoiceTier({
    pricing_tier: (profile as { tier?: string | null } | null)?.tier ?? null,
    account_type: profile?.account_type ?? null,
    voice_addon: (profile as { voice_addon?: boolean | null } | null)?.voice_addon ?? false,
  })

  const voiceBrief = (latestSweep?.voice_brief ?? null) as VoiceBrief | null

  return (
    <ObjectivesClient
      objectives={objectives ?? []}
      error={error?.message ?? null}
      alertObjectiveIds={alertObjectiveIds}
      voiceTier={voiceTier}
      voiceBrief={voiceBrief}
    />
  )
}
