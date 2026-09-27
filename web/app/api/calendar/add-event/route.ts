import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { googleCalendarLink } from '@/lib/calendar/googleCalendarLink'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Require at least one active calendar connection
  const { data: conn } = await supabase
    .from('calendar_connections')
    .select('id')
    .eq('user_id', user.id)
    .eq('sync_status', 'ok')
    .limit(1)
    .maybeSingle()

  if (!conn) {
    return NextResponse.json({ error: 'no_calendar_connected' }, { status: 400 })
  }

  const body = await request.json() as {
    title?: string
    date?: string
    time?: string
    notes?: string
    objective_id?: string
  }

  const title = body.title?.trim() || 'Goal reminder'
  const date = body.date?.trim() ?? ''
  const time = body.time?.trim() ?? '09:00'
  const notes = body.notes?.trim() ?? ''

  if (!date) {
    return NextResponse.json({ error: 'date_required' }, { status: 400 })
  }

  const start = new Date(`${date}T${time}:00`)
  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  }

  const url = googleCalendarLink({
    title,
    description: notes || undefined,
    start,
    durationMinutes: 60,
  })

  return NextResponse.json({ success: true, url })
}
