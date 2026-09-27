import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    full_name?: string
    tone_pref?: string
    depth_pref?: string
    onboarded_at?: string
    onboarding_context?: string
    cohort_data_consent?: boolean
    phone_number?: string | null
    sms_alerts_enabled?: boolean
    voice_mode?: boolean
    voice_type?: string | null
    voice_rate?: number | null
    voice_volume?: number | null
    voice_onboarded?: boolean | null
    last_brief_heard_at?: string | null
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ profile: data })
}
