import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { prediction_id?: string; spawned_objective_id?: string }
  if (!body.prediction_id && !body.spawned_objective_id) {
    return NextResponse.json({ error: 'prediction_id or spawned_objective_id required' }, { status: 400 })
  }

  const updates: Record<string, string> = {}
  if (body.prediction_id) updates.prediction_id = body.prediction_id
  if (body.spawned_objective_id) updates.spawned_objective_id = body.spawned_objective_id

  const { error } = await supabase
    .from('objective_outcomes')
    .update(updates)
    .eq('id', params.id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
