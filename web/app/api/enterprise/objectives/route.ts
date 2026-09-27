// app/api/enterprise/objectives/route.ts
// FF-050: Enterprise Objective CRUD — list (with history) + create
// Admin-only. All state in enterprise_objectives.

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'

// ── GET /api/enterprise/objectives?institution_id=... ─────────────────────────
// Returns active objectives + historical (retired/dropped) objectives separately.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const institutionId = searchParams.get('institution_id')

  if (!institutionId) {
    return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
  }

  const check = await requireEnterpriseAdmin(institutionId)
  if (!check.ok) return check.response

  const supabase = createServiceClient()

  const [activeRes, historyRes] = await Promise.allSettled([
    supabase
      .from('enterprise_objectives')
      .select(
        'id, obj_id, title, statement, objective_state, objective_order, ' +
        'case_scope, lite_sweep_cadence_days, alert_threshold, status, ' +
        'lifecycle_state, lifecycle_changed_at, lifecycle_reason, lifecycle_notes, ' +
        'created_at, updated_at'
      )
      .eq('institution_id', institutionId)
      .eq('status', 'active')
      .order('objective_order', { ascending: true }),

    supabase
      .from('enterprise_objectives')
      .select(
        'id, obj_id, title, statement, objective_state, case_scope, status, ' +
        'lifecycle_state, lifecycle_changed_at, lifecycle_reason, lifecycle_notes, ' +
        'created_at, updated_at'
      )
      .eq('institution_id', institutionId)
      .neq('status', 'active')
      .order('lifecycle_changed_at', { ascending: false })
      .limit(50),
  ])

  const active =
    activeRes.status === 'fulfilled' ? (activeRes.value.data ?? []) : []
  const history =
    historyRes.status === 'fulfilled' ? (historyRes.value.data ?? []) : []

  return NextResponse.json({ active, history })
}

// ── POST /api/enterprise/objectives ──────────────────────────────────────────
// Create a new enterprise objective. Admin only.
export async function POST(request: NextRequest) {
  let body: {
    institution_id: string
    title: string
    statement: string
    objective_state?: 'focus' | 'monitoring_lite'
    case_scope?: string | null
    lite_sweep_cadence_days?: number | null
    alert_threshold?: Record<string, unknown> | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { institution_id: institutionId } = body

  if (!institutionId) {
    return NextResponse.json({ error: 'institution_id is required' }, { status: 400 })
  }

  const check = await requireEnterpriseAdmin(institutionId)
  if (!check.ok) return check.response

  if (!body.title?.trim() || !body.statement?.trim()) {
    return NextResponse.json(
      { error: 'title and statement are required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // Determine next obj_id (RE-NN or OBJ-NN pattern — detect from existing rows)
  const { data: existing } = await supabase
    .from('enterprise_objectives')
    .select('obj_id, objective_order')
    .eq('institution_id', institutionId)
    .order('objective_order', { ascending: false })
    .limit(1)

  const lastRow = existing?.[0]
  const lastOrder = (lastRow?.objective_order as number | null) ?? 0

  // Auto-increment obj_id: detect prefix from last row (RE-NN vs OBJ-NN)
  const lastObjId = (lastRow?.obj_id as string | null) ?? ''
  const reMatch = lastObjId.match(/^(RE|OBJ)-(\d+)$/)
  let nextObjId: string
  if (reMatch) {
    const prefix = reMatch[1]
    const num = parseInt(reMatch[2], 10) + 1
    nextObjId = `${prefix}-${String(num).padStart(2, '0')}`
  } else {
    // Count total existing to derive next number
    const { count } = await supabase
      .from('enterprise_objectives')
      .select('id', { count: 'exact', head: true })
      .eq('institution_id', institutionId)
    nextObjId = `OBJ-${String((count ?? 0) + 1).padStart(2, '0')}`
  }

  const { data: newObj, error } = await supabase
    .from('enterprise_objectives')
    .insert({
      institution_id: institutionId,
      obj_id: nextObjId,
      title: body.title.trim(),
      statement: body.statement.trim(),
      objective_state: body.objective_state ?? 'monitoring_lite',
      case_scope: body.case_scope ?? null,
      lite_sweep_cadence_days: body.lite_sweep_cadence_days ?? null,
      alert_threshold: body.alert_threshold ?? null,
      status: 'active',
      lifecycle_state: 'active',
      objective_order: lastOrder + 1,
    })
    .select('id, obj_id, title, statement, objective_state, objective_order, case_scope, lifecycle_state, status')
    .single()

  if (error) {
    console.error('[FF-050] objective create failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ objective: newObj }, { status: 201 })
}
