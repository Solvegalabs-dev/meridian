import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userVoiceTier, canUseBrief } from '@/lib/voice/voiceTier'
import { cleanTranscript, parseDate, parseVoiceIntent } from '@/lib/voice/smartPipe'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, account_type, voice_addon')
    .eq('id', user.id)
    .single()

  const tier = userVoiceTier({
    pricing_tier: (profile as { tier?: string | null } | null)?.tier ?? null,
    account_type: profile?.account_type ?? null,
    voice_addon: (profile as { voice_addon?: boolean | null } | null)?.voice_addon ?? false,
  })

  if (!canUseBrief(tier)) {
    return NextResponse.json({ upgrade: true }, { status: 403 })
  }

  const body = await request.json() as {
    transcript: string
    tasker_type: string
    objective_title: string
    objective_id: string
    prediction_title?: string
  }

  const cleaned = cleanTranscript(body.transcript)
  const resolvedDate = parseDate(body.transcript)
  const intent = await parseVoiceIntent(cleaned, resolvedDate, {
    tasker_type: body.tasker_type,
    objective_title: body.objective_title,
    prediction_title: body.prediction_title,
  })

  return NextResponse.json({ intent })
}
