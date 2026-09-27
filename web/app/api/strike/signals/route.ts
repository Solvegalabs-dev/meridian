import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const objectiveId = req.nextUrl.searchParams.get('objective_id')
  if (!objectiveId) return NextResponse.json({ error: 'objective_id required' }, { status: 400 })

  // Columns: id, agent_key, objective_id, observed_value (numeric), source, recorded_at
  const { data, error } = await supabase
    .from('agent_signal_history')
    .select('id, agent_key, objective_id, observed_value, source, recorded_at')
    .eq('objective_id', objectiveId)
    .order('recorded_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ signals: data ?? [] })
}
