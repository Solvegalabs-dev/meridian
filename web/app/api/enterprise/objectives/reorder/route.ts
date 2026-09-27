// app/api/enterprise/objectives/reorder/route.ts
// FF-050: Bulk reorder active enterprise objectives.
// Accepts an ordered array of { id, objective_order } and writes all in parallel.
// Admin only.

import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireEnterpriseAdmin } from '@/lib/enterprise/requireEnterpriseAdmin'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let body: {
    institution_id: string
    order: Array<{ id: string; objective_order: number }>
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

  if (!Array.isArray(body.order) || body.order.length === 0) {
    return NextResponse.json({ error: 'order array is required and must not be empty' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // Write all order updates concurrently — one that fails doesn't abort the others
  const settled = await Promise.allSettled(
    body.order.map(({ id, objective_order }) =>
      supabase
        .from('enterprise_objectives')
        .update({ objective_order, updated_at: now })
        .eq('id', id)
        .eq('institution_id', institutionId) // extra safety: scope to institution
    )
  )

  const failed = settled
    .map((r, i) => ({ ...r, id: body.order[i].id }))
    .filter(r => r.status === 'rejected')

  if (failed.length > 0) {
    console.error('[FF-050/reorder] some updates failed:', failed.map(f => f.id))
    return NextResponse.json(
      {
        partial: true,
        succeeded: settled.length - failed.length,
        failed: failed.map(f => f.id),
      },
      { status: 207 }
    )
  }

  return NextResponse.json({ success: true, reordered: body.order.length })
}
