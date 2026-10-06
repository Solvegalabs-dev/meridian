// GET /api/partner/objectives?partner_user_ref=... (FF-092 Part 3.5)
// Lists one customer's objectives for the calling partner. The key decides the partner, so there
// are no cross-partner reads. The result carries no geo, no coordinates and no agent detail.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { authenticatePartner } from '@/lib/auth/partnerAuth'
import { partnerRateLimitResponse } from '@/lib/auth/rateLimit'

export const dynamic = 'force-dynamic'

const MAX_PARTNER_REF = 128

export async function GET(request: NextRequest) {
  const partner = await authenticatePartner(request)
  if (!partner) {
    return NextResponse.json({ error: 'Invalid or revoked partner key' }, { status: 401 })
  }

  const limited = partnerRateLimitResponse(partner)
  if (limited) return limited

  const ref = request.nextUrl.searchParams.get('partner_user_ref')
  if (!ref || ref.trim() === '' || ref.length > MAX_PARTNER_REF) {
    return NextResponse.json(
      { error: `partner_user_ref is required (up to ${MAX_PARTNER_REF} characters)` },
      { status: 400 },
    )
  }

  const { data, error } = await createServiceClient()
    .from('objective_profiles')
    .select('id, objective_id, taxonomy_key, status, hunt_code, created_at')
    .eq('partner_id', partner.partnerId)
    .eq('partner_user_ref', ref.trim())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[partner/objectives] query failed:', partner.slug, error.message)
    return NextResponse.json({ error: 'Could not load objectives. Try again.' }, { status: 500 })
  }

  return NextResponse.json({
    objectives: (data ?? []).map(row => ({
      objective_profile_id: row.id,
      objective_id: row.objective_id,
      taxonomy_key: row.taxonomy_key,
      status: row.status,
      hunt_code: row.hunt_code ?? null,
      created_at: row.created_at,
    })),
  })
}
