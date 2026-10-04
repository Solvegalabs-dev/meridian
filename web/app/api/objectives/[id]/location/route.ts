// PATCH /api/objectives/[id]/location — FF-074 hunt location entry
// FF-091: this edits the ACTIVE spot's coordinates (or creates the first spot if none),
// through the same path as the spot routes. The declared hunt unit is never overwritten.
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { requireObjectiveOwner, readJson, spotErrorResponse } from '@/lib/spots/access'
import { setActiveLocation } from '@/lib/spots/spotService'
import { validateCoordinates } from '@/lib/spots/coordinates'

export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const owner = await requireObjectiveOwner(params.id)
  if (owner instanceof NextResponse) return owner
  const body = await readJson(request)
  if (body instanceof NextResponse) return body

  const invalid = validateCoordinates(body.lat, body.lon)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 })

  try {
    const location = await setActiveLocation(createServiceClient(), {
      objectiveId: owner.objectiveId,
      userId: owner.userId,
      lat: body.lat,
      lon: body.lon,
    })
    if (!location) return NextResponse.json({ error: 'No objective profile found for this objective' }, { status: 404 })
    return NextResponse.json({ location })
  } catch (err) {
    return spotErrorResponse(err)
  }
}
