import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const objectiveId = req.nextUrl.searchParams.get('objective_id')
  if (!objectiveId) return NextResponse.json({ error: 'objective_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('field_notes')
    .select('*')
    .eq('objective_id', objectiveId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { objective_id, note_text, location } = body
  if (!objective_id || !note_text) {
    return NextResponse.json({ error: 'objective_id and note_text required' }, { status: 400 })
  }

  // Read community consent from profiles
  const { data: profile } = await supabase
    .from('profiles')
    .select('cohort_data_consent')
    .eq('id', user.id)
    .maybeSingle()

  const communityConsented = (profile?.cohort_data_consent as boolean | null) ?? false

  const { data, error } = await supabase
    .from('field_notes')
    .insert({
      objective_id,
      user_id: user.id,
      note_text,
      location: location ?? null,
      community_consented: communityConsented,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data }, { status: 201 })
}
