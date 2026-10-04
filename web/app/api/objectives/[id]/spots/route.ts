// GET  /api/objectives/[id]/spots  — list spots, the limit and the active spot id
// POST /api/objectives/[id]/spots  — add a spot {name, lat, lon, makeActive?}
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, readJson, spotErrorResponse } from '@/lib/spots/access'
import { createSpot, listSpots, spotView } from '@/lib/spots/spotService'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  try {
    const { spots, limit, active_spot_id } = await listSpots(createServiceClient(), owner.objectiveId, owner.userId)
    return NextResponse.json({ spots: spots.map(spotView), limit, active_spot_id })
  } catch (err) {
    return spotErrorResponse(err)
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  const body = await readJson(request)
  if (body instanceof NextResponse) return body
  try {
    const { spot, location } = await createSpot(createServiceClient(), {
      objectiveId: owner.objectiveId,
      userId: owner.userId,
      name: body.name,
      lat: body.lat,
      lon: body.lon,
      makeActive: body.makeActive === true,
    })
    return NextResponse.json({ spot: spotView(spot), location }, { status: 201 })
  } catch (err) {
    return spotErrorResponse(err)
  }
}
