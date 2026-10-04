// POST /api/objectives/[id]/spots/[spotId]/activate — make this spot the strike focus.
// Applies its geography to the profile. Does not trigger a sweep; the next scheduled one uses it.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, spotErrorResponse } from '@/lib/spots/access'
import { activateSpot } from '@/lib/spots/spotService'

export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string; spotId: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    const { spotId, reused } = await activateSpot(createServiceClient(), owner.objectiveId, params.spotId)
    return NextResponse.json({ ok: true, active_spot_id: spotId, reused_snapshot: reused })
  } catch (err) {
    return spotErrorResponse(err)
  }
}
