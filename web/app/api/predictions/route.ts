import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('predictions')
    .select('*, objectives(obj_id, title)')
    .eq('user_id', user.id)
    .order('horizon_date', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ predictions: data ?? [] })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    statement: string
    confidence_pct: number
    horizon_date: string
    objective_id?: string
    notes?: string
  }

  // Auto-generate pred_id
  const { count } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const pred_id = `PRED-${String((count ?? 0) + 1).padStart(3, '0')}`

  const { data, error } = await supabase
    .from('predictions')
    .insert({
      user_id: user.id,
      pred_id,
      statement: body.statement,
      confidence_pct: body.confidence_pct,
      horizon_date: body.horizon_date,
      objective_id: body.objective_id ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ prediction: data })
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    id: string
    outcome?: string
    accuracy_score: number
    scoring_note?: string
  }

  let updatedNotes: string | undefined
  if (body.scoring_note?.trim()) {
    const { data: existing } = await supabase
      .from('predictions')
      .select('notes')
      .eq('id', body.id)
      .eq('user_id', user.id)
      .single()

    const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const noteBlock = `[Scoring note — ${dateStr}]: ${body.scoring_note.trim()}`
    const prior = (existing?.notes ?? '').trim()
    updatedNotes = prior ? `${prior}\n\n${noteBlock}` : noteBlock
  }

  const updatePayload: Record<string, unknown> = {
    accuracy_score: body.accuracy_score,
    scored_at: new Date().toISOString(),
  }
  if (body.outcome !== undefined) updatePayload.outcome = body.outcome
  if (updatedNotes !== undefined) updatePayload.notes = updatedNotes

  const { data, error } = await supabase
    .from('predictions')
    .update(updatePayload)
    .eq('id', body.id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // FF-061: scoring a prediction counts as user activity — reset the FAC activity gate
  if (data?.objective_id) {
    await supabase.from('objectives')
      .update({ last_user_action_at: new Date().toISOString() })
      .eq('id', data.objective_id)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ prediction: data })
}
