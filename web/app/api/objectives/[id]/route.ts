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

  const body = await request.json() as {
    title?: string
    target_date?: string | null
    deadline_type?: 'hard' | 'soft'
    reservation_price?: number | null
    context?: Record<string, unknown>
    notes?: string | null
    outcome?: string
    success_condition?: string | null
    // Status transition fields
    status?: string
    closure_type?: string | null
    paused_at?: string | null
    archive_reason?: string | null
    archive_date?: string | null
    estimated_reactivate_date?: string | null
  }

  // Reject a past target_date (same guard as POST)
  if (body.target_date) {
    const today = new Date().toISOString().split('T')[0]
    if (body.target_date < today) {
      return NextResponse.json({ error: 'past_target_date', target_date: body.target_date }, { status: 400 })
    }
  }

  // Fetch current row before updating — needed for change-log comparison (FF-032)
  const { data: current } = await supabase
    .from('objectives')
    .select('title, context, target_date, notes')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single()

  // Build update payload — only include fields that were actually sent
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('title' in body)                     update.title = body.title
  if ('target_date' in body)               update.target_date = body.target_date ?? null
  if ('deadline_type' in body)             update.deadline_type = body.deadline_type
  if ('reservation_price' in body)         update.reservation_price = body.reservation_price ?? null
  if ('context' in body)                   update.context = body.context ?? {}
  if ('notes' in body) {
    update.notes = body.notes ?? null
    // FF-061: notes edit counts as user activity — reset the FAC activity gate
    update.last_user_action_at = new Date().toISOString()
  }
  if ('outcome' in body)                   update.outcome = body.outcome
  if ('success_condition' in body)         update.success_condition = body.success_condition ?? null
  if ('status' in body)                    update.status = body.status
  if ('closure_type' in body)              update.closure_type = body.closure_type ?? null
  if ('paused_at' in body)                 update.paused_at = body.paused_at ?? null
  if ('archive_reason' in body)            update.archive_reason = body.archive_reason ?? null
  if ('archive_date' in body)              update.archive_date = body.archive_date ?? null
  if ('estimated_reactivate_date' in body) update.estimated_reactivate_date = body.estimated_reactivate_date ?? null

  // Build change-log rows for tracked fields (FF-032).
  // Only write a row when the value actually changed — trim before compare to
  // avoid phantom rows from trailing whitespace differences.
  const changeRows: {
    user_id: string
    objective_id: string
    changed_field: string
    old_value: string | null
    new_value: string | null
    change_source: string
  }[] = []

  if (current) {
    const tracked = [
      { field: 'title',       oldRaw: current.title,       newRaw: body.title },
      { field: 'context',     oldRaw: current.context,     newRaw: body.context },
      { field: 'target_date', oldRaw: current.target_date, newRaw: body.target_date },
      { field: 'notes',       oldRaw: current.notes,       newRaw: body.notes },
    ] as const

    for (const { field, oldRaw, newRaw } of tracked) {
      if (!(field in body)) continue // field not sent in this request
      const oldStr = oldRaw != null ? String(typeof oldRaw === 'object' ? JSON.stringify(oldRaw) : oldRaw).trim() : ''
      const newStr = newRaw != null ? String(typeof newRaw === 'object' ? JSON.stringify(newRaw) : newRaw).trim() : ''
      if (!oldStr && !newStr) continue // empty → empty, nothing to log
      if (oldStr === newStr) continue  // no actual change
      changeRows.push({
        user_id: user.id,
        objective_id: params.id,
        changed_field: field,
        old_value: oldRaw != null ? String(typeof oldRaw === 'object' ? JSON.stringify(oldRaw) : oldRaw) : null,
        new_value: newRaw != null ? String(typeof newRaw === 'object' ? JSON.stringify(newRaw) : newRaw) : null,
        change_source: 'user_edit',
      })
    }
  }

  // Write update and change-log rows in the same async block (FF-032 atomicity)
  const [{ data, error }, changeResult] = await Promise.all([
    supabase.from('objectives').update(update).eq('id', params.id).eq('user_id', user.id).select().single(),
    changeRows.length > 0
      ? supabase.from('objective_changes').insert(changeRows)
      : Promise.resolve({ data: null, error: null }),
  ])

  if (changeResult.error) {
    console.error('[objectives PATCH] change-log write failed:', changeResult.error.message)
    // Non-fatal — objective update is the primary operation
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ objective: data })
}
