import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from './SettingsClient'
import CalendarIntegrations from '@/components/settings/CalendarIntegrations'
import type { CalendarConnection } from '@/lib/utils/types'

export default async function SettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, { data: connections }] = await Promise.all([
    supabase.from('profiles').select('*, phone_number, sms_alerts_enabled, voice_mode, voice_addon').eq('id', user.id).single(),
    supabase
      .from('calendar_connections')
      .select('id, provider, label, is_active, sync_status, last_synced_at, last_error, event_count, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at'),
  ])

  return (
    <div className="max-w-2xl space-y-4">
      <SettingsClient
        email={user.email ?? ''}
        profile={profile}
      />
      <CalendarIntegrations
        initialConnections={(connections ?? []) as CalendarConnection[]}
        tier={(profile as { tier?: string } | null)?.tier ?? 'trial'}
        accountType={(profile as { account_type?: string } | null)?.account_type ?? ''}
      />
    </div>
  )
}
