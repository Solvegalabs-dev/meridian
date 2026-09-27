import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recomputeConfidenceFromAction } from '@/lib/sweep/recomputeConfidence'

export const dynamic = 'force-dynamic'

const VALID_ACTION_CLASSES = ['listed', 'price_change', 'inquiry', 'offer', 'showing', 'other'] as const
type ActionClass = typeof VALID_ACTION_CLASSES[number]

// GET — list objective_actions for this objective (owner-scoped via RLS)
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('objective_actions')
    .select('*')
    .eq('objective_id', params.id)
    .order('action_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ actions: data ?? [] })
}

// POST — log a user action, emit a signal, run lightweight confidence recompute
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    description?: string
    action_date?: string
    action_class?: string | null
    source?: 'user_logged' | 'engine_recommended'
    engine_action_text?: string | null
  }

  const description = (body.description ?? '').trim()
  if (!description) return NextResponse.json({ error: 'description_required' }, { status: 400 })

  const source = body.source ?? 'user_logged'
  const action_date = body.action_date ?? new Date().toISOString().split('T')[0]
  const action_class = VALID_ACTION_CLASSES.includes(body.action_class as ActionClass)
    ? (body.action_class as ActionClass)
    : null

  // Verify the objective belongs to this user (RLS will also enforce, but
  // we need the current confidence/context for the recompute)
  const { data: objective } = await supabase
    .from('objectives')
    .select('id, title, outcome, confidence, deadline_type, reservation_price, target_date, user_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  if (!objective) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // 1. Create a sweep record for the confidence_scores FK
  const sweepStart = new Date()
  const { data: sweep } = await supabase
    .from('sweeps')
    .insert({
      user_id: user.id,
      status: 'running',
      trigger_type: 'user_action',
      objectives_swept: [params.id],
      started_at: sweepStart.toISOString(),
    })
    .select('id')
    .single()

  if (!sweep) return NextResponse.json({ error: 'Failed to create sweep record' }, { status: 500 })

  // 2. Emit a signal row — user_action is first-party ground truth
  const { data: signal } = await supabase
    .from('signals')
    .insert({
      user_id: user.id,
      objective_ids: [params.id],
      sweep_id: sweep.id,
      title: description.slice(0, 120),
      body: description.length > 120 ? description : null,
      source: null,
      source_type: 'user_action',
      relevance: 'high',
      signal_type: 'user_action',
      signal_class: 'user_action',
      is_cross_dep: false,
    })
    .select('id')
    .single()

  if (!signal) return NextResponse.json({ error: 'Failed to emit signal' }, { status: 500 })

  // 3. Create the objective_actions row with the signal FK
  const { data: action, error: actionError } = await supabase
    .from('objective_actions')
    .insert({
      objective_id: params.id,
      user_id: user.id,
      source,
      description,
      action_date,
      status: 'done',
      action_class,
      signal_id: signal.id,
    })
    .select()
    .single()

  if (actionError) return NextResponse.json({ error: actionError.message }, { status: 500 })

  // FF-061: stamp last_user_action_at to reset the FAC activity gate
  await supabase.from('objectives')
    .update({ last_user_action_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('user_id', user.id)

  // 4. Lightweight confidence recompute — Haiku only, no external calls.
  // Runs for every action source. Provenance is passed through and weighted
  // inside the scoring prompt: completing an engine recommendation is real
  // evidence, but carries less weight than an unprompted first-party action,
  // because the engine already anticipated it as a possibility.
  let newConfidence: number = objective.confidence
  let reasoning: string | null = null

  try {
    const result = await recomputeConfidenceFromAction(
      { description, action_date, action_class, signal_id: signal.id, source },
      {
        id: objective.id,
        user_id: user.id,
        title: objective.title,
        outcome: objective.outcome,
        confidence: objective.confidence,
        deadline_type: (objective as { deadline_type?: string }).deadline_type ?? 'hard',
        reservation_price: (objective as { reservation_price?: number | null }).reservation_price ?? null,
        target_date: objective.target_date ?? null,
      },
      sweep.id
    )
    newConfidence = result.newConfidence
    reasoning = result.reasoning

    // Write back actual timing and signal count now that Haiku has returned
    await supabase.from('sweeps').update({
      status: 'complete',
      signal_count: 1,
      completed_at: new Date().toISOString(),
    }).eq('id', sweep.id)
  } catch (err) {
    console.error('[actions POST] recompute failed:', err)
    await supabase.from('sweeps').update({ status: 'failed' }).eq('id', sweep.id)
    // Non-fatal — the action is already logged
  }

  return NextResponse.json({
    action,
    signal_id: signal.id,
    new_confidence: newConfidence,
    confidence_reasoning: reasoning,
  })
}
